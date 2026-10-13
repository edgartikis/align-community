// Preview-only iOS QR codes. Independent from the existing 15-minute web
// QR and any historical Wallet experiments. Production feature is OFF.
//
// IMPORTANT: Cloudflare KV is eventually consistent across regions. A rotate
// write can take time to propagate: this module is NOT suitable for promises
// of instantaneous global revocation. Upgrade the active-code authority to a
// strongly consistent Durable Object before a production release.
const ROTATION_MS = 15 * 60 * 1000;
const CODE_PATTERN = /^A[A-Za-z0-9_-]{31}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,}$/;
const SESSION_PATTERN = /^[A-Za-z0-9_-]{40,}$/;

export function appQrEnabled(env) {
  return String(env.ALIGN_APP_QR_ROTATION_ENABLED || "").toLowerCase() === "true";
}
function currentKey(token) { return `qr-app-current:${token}`; }
function codeKey(code) { return `qr-app-code:${code}`; }
function json(body, status = 200, origin = "") {
  const permitted = ["https://alignmembers.com.mx", "https://www.alignmembers.com.mx", "https://edgartikis.github.io"];
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "access-control-allow-origin": permitted.includes(origin) ? origin : "https://alignmembers.com.mx",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "authorization,content-type",
      vary: "Origin",
    },
  });
}
function clean(value, max = 140) {
  return String(value ?? "").trim().slice(0, max);
}
function qrSlot(now = Date.now()) { return Math.floor(now / ROTATION_MS); }
function validity(member) {
  const from = member.validFrom || member.joinedAt;
  const until = member.validUntil || (from ? (() => {
    const date = new Date(from);
    if (!Number.isFinite(date.getTime())) return "";
    const day = date.getUTCDate();
    const end = new Date(date.getTime());
    end.setUTCDate(1);
    end.setUTCMonth(end.getUTCMonth() + 1);
    const max = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
    end.setUTCDate(Math.min(day, max));
    return end.toISOString();
  })() : "");
  return { validFrom: from, validUntil: until };
}
function memberActive(member, now = Date.now()) {
  const period = validity(member);
  const start = Date.parse(period.validFrom);
  const end = Date.parse(period.validUntil);
  return member.status === "Activa" &&
    Number.isFinite(start) && Number.isFinite(end) &&
    start <= now && now < end;
}
async function readJson(env, key) {
  const raw = await env.PAYMENT_STATE.get(key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
async function requireMember(request, env, token) {
  if (!TOKEN_PATTERN.test(token)) return { error: "Token de miembro no válido.", status: 400 };
  const header = request.headers.get("authorization") || "";
  const match = /^Bearer\s+([A-Za-z0-9_-]{40,})$/i.exec(header);
  if (!match || !SESSION_PATTERN.test(match[1])) return { error: "Debes iniciar sesión en ALIGN.", status: 401 };
  const session = await readJson(env, `member-session:${match[1]}`);
  if (!session?.groupId || Date.now() >= Number(session.expiresAt || 0))
    return { error: "Tu sesión ha expirado. Inicia sesión nuevamente.", status: 401 };
  const member = await readJson(env, `member:${token}`);
  if (!member || member.groupId !== session.groupId)
    return { error: "No tienes acceso a esta tarjeta.", status: 403 };
  if (!memberActive(member)) return { error: "La membresía no está vigente.", status: 403 };
  return { member };
}
function isCurrent(record, now = Date.now()) {
  return Boolean(record && CODE_PATTERN.test(String(record.code || "")) &&
    Number(record.slot) === qrSlot(now) &&
    Number(record.createdAt) <= now);
}
function timeToExpiry(now = Date.now()) {
  return (qrSlot(now) + 1) * ROTATION_MS - now;
}
function ttlSeconds() { return Math.max(60, Math.ceil(timeToExpiry() / 1000) + 120); }
function randomCode() {
  const random = new Uint8Array(23);
  crypto.getRandomValues(random);
  return "A" + btoa(String.fromCharCode(...random))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function issueNewCode(env, token, period) {
  const code = randomCode();
  const state = { code, slot: qrSlot(), createdAt: Date.now(),
    validFrom: period.validFrom, validUntil: period.validUntil };
  const ttl = ttlSeconds();
  await env.PAYMENT_STATE.put(codeKey(code), JSON.stringify({ token, ...state }), { expirationTtl: ttl });
  await env.PAYMENT_STATE.put(currentKey(token), JSON.stringify(state), { expirationTtl: ttl });
  return state;
}
async function ensureCode(env, token, member) {
  const prior = await readJson(env, currentKey(token));
  const period = validity(member);
  if (isCurrent(prior) && prior.validFrom === period.validFrom && prior.validUntil === period.validUntil)
    return prior;
  return issueNewCode(env, token, period);
}
function responseFor(request, state) {
  return json({
    validationUrl: new URL(`/q/${state.code}`, request.url).toString(),
    qrValidUntil: new Date((Number(state.slot) + 1) * ROTATION_MS).toISOString(),
    refreshAfterMs: Math.max(1000, timeToExpiry()),
    appRotationEnabled: true,
  }, 200, request.headers.get("origin") || "");
}
export async function handleAppQr(request, env) {
  const origin = request.headers.get("origin") || "";
  if (!appQrEnabled(env)) return json({ error: "El QR protegido de la app todavía está en pruebas." }, 404, origin);
  if (!env.PAYMENT_STATE) return json({ error: "Servicio temporalmente no disponible." }, 503, origin);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: json({}, 200, origin).headers });
  if (!["GET", "POST"].includes(request.method)) return json({ error: "Método no permitido." }, 405, origin);

  const body = request.method === "POST" ? await request.json().catch(() => null) : null;
  const token = clean(request.method === "GET" ? new URL(request.url).searchParams.get("token") : body?.token);
  const verified = await requireMember(request, env, token);
  if (verified.error) return json({ error: verified.error }, verified.status, origin);

  if (request.method === "GET") {
    return responseFor(request, await ensureCode(env, token, verified.member));
  }
  const previousCode = clean(body?.previousCode, 70);
  if (!CODE_PATTERN.test(previousCode)) return json({ error: "Falta el QR anterior para reemplazarlo." }, 400, origin);
  const state = await readJson(env, currentKey(token));
  if (!isCurrent(state) || state.code !== previousCode)
    return json({ error: "El QR ya fue renovado. Actualiza tu tarjeta." }, 409, origin);
  return responseFor(request, await issueNewCode(env, token, validity(verified.member)));
}
export async function currentAppQrMapping(env, code) {
  if (!appQrEnabled(env) || !env.PAYMENT_STATE || !CODE_PATTERN.test(code)) return null;
  const mapping = await readJson(env, codeKey(code));
  if (!mapping?.token || !TOKEN_PATTERN.test(mapping.token) || mapping.code !== code) return null;
  const latest = await readJson(env, currentKey(mapping.token));
  const member = await readJson(env, `member:${mapping.token}`);
  if (!member || !memberActive(member) || !isCurrent(latest)) return null;
  const period = validity(member);
  if (latest.code !== code || latest.slot !== mapping.slot ||
      latest.validFrom !== mapping.validFrom || latest.validUntil !== mapping.validUntil ||
      period.validFrom !== mapping.validFrom || period.validUntil !== mapping.validUntil) return null;
  return { code, token: mapping.token, member, period, slot: mapping.slot,
    qrValidUntil: new Date((Number(latest.slot) + 1) * ROTATION_MS).toISOString() };
}
export async function verifyAppQrRevision(env, token, code, slot) {
  const mapping = await currentAppQrMapping(env, code);
  return Boolean(mapping && mapping.token === token && mapping.slot === slot);
}
