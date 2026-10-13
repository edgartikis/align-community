// Authenticated native-app QR. DO is the sole source of truth for the live
// code. The QR link exposes no membership token and needs no KV lookup to
// locate its Durable Object. Production feature remains OFF by default.
const CODE_PATTERN = /^A[A-Za-z0-9_-]{31}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,}$/;
const SESSION_PATTERN = /^[A-Za-z0-9_-]{40,}$/;
const WINDOW_MS = 15 * 60 * 1000;

export function appQrEnabled(env) {
  return String(env.ALIGN_APP_QR_ROTATION_ENABLED || "").toLowerCase() === "true";
}
function available(env) {
  return Boolean(env.APP_QR_AUTHORITY &&
    typeof env.APP_QR_AUTHORITY.idFromName === "function" &&
    typeof env.APP_QR_AUTHORITY.get === "function" &&
    String(env.ALIGN_APP_QR_SECRET || "").length >= 32);
}
function json(body, status = 200, origin = "") {
  const allowed = ["https://alignmembers.com.mx", "https://www.alignmembers.com.mx", "https://edgartikis.github.io"];
  return Response.json(body, { status, headers: {
    "cache-control": "no-store",
    "access-control-allow-origin": allowed.includes(origin) ? origin : "https://alignmembers.com.mx",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "authorization,content-type",
    vary: "Origin",
  } });
}
function clean(value, max = 140) { return String(value ?? "").trim().slice(0, max); }
function addCalendarMonth(iso) {
  const source = new Date(iso);
  if (!Number.isFinite(source.getTime())) return "";
  const year = source.getUTCFullYear();
  const month = source.getUTCMonth();
  const day = source.getUTCDate();
  const end = new Date(Date.UTC(year, month + 1, 1, source.getUTCHours(), source.getUTCMinutes(), source.getUTCSeconds(), source.getUTCMilliseconds()));
  const lastDay = new Date(Date.UTC(year, month + 2, 0)).getUTCDate();
  end.setUTCDate(Math.min(day, lastDay));
  return end.toISOString();
}
function validity(member) {
  const validFrom = member.validFrom || member.joinedAt || "";
  return { validFrom, validUntil: member.validUntil || addCalendarMonth(validFrom) };
}
function memberActive(member, now = Date.now()) {
  const period = validity(member);
  return member.status === "Activa" &&
    Number.isFinite(Date.parse(period.validFrom)) &&
    Number.isFinite(Date.parse(period.validUntil)) &&
    Date.parse(period.validFrom) <= now && now < Date.parse(period.validUntil);
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
  if (!match || !SESSION_PATTERN.test(match[1]))
    return { error: "Debes iniciar sesión en ALIGN.", status: 401 };
  const session = await readJson(env, `member-session:${match[1]}`);
  if (!session?.groupId || Date.now() >= Number(session.expiresAt || 0))
    return { error: "Tu sesión ha expirado. Inicia sesión nuevamente.", status: 401 };
  const member = await readJson(env, `member:${token}`);
  if (!member || member.groupId !== session.groupId)
    return { error: "No tienes acceso a esta tarjeta.", status: 403 };
  if (!memberActive(member)) return { error: "La membresía no está vigente.", status: 403 };
  return { member };
}
async function routeFor(env, token, period) {
  const key = await crypto.subtle.importKey("raw",
    new TextEncoder().encode(env.ALIGN_APP_QR_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key,
    new TextEncoder().encode(`app-qr:v1:${token}:${period.validFrom}:${period.validUntil}`)));
  return btoa(String.fromCharCode(...bytes.slice(0, 12)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function authority(env, route) {
  return env.APP_QR_AUTHORITY.get(env.APP_QR_AUTHORITY.idFromName(`align-app-qr:v1:${route}`));
}
async function invoke(env, route, operation) {
  const response = await authority(env, route).fetch("https://align-app-qr.internal/authority", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...operation, route }),
  });
  const result = await response.json().catch(() => ({}));
  return { status: response.status, ...result };
}
function appResponse(request, state) {
  return json({
    validationUrl: new URL(`/q/${state.code}`, request.url).toString(),
    qrValidUntil: new Date((state.slot + 1) * WINDOW_MS).toISOString(),
    refreshAfterMs: Math.max(1000, (state.slot + 1) * WINDOW_MS - Date.now()),
    appRotationEnabled: true,
  }, 200, request.headers.get("origin") || "");
}
export async function handleAppQr(request, env) {
  const origin = request.headers.get("origin") || "";
  if (!appQrEnabled(env))
    return json({ error: "El QR protegido de la app todavía está en pruebas." }, 404, origin);
  if (!available(env) || !env.PAYMENT_STATE)
    return json({ error: "El QR protegido aún no está configurado." }, 503, origin);
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: json({}, 200, origin).headers });
  if (!["GET", "POST"].includes(request.method))
    return json({ error: "Método no permitido." }, 405, origin);

  const body = request.method === "POST" ? await request.json().catch(() => null) : null;
  const token = clean(request.method === "GET" ? new URL(request.url).searchParams.get("token") : body?.token);
  const verified = await requireMember(request, env, token);
  if (verified.error) return json({ error: verified.error }, verified.status, origin);

  const period = validity(verified.member);
  const route = await routeFor(env, token, period);
  const action = request.method === "GET" ? "current" : "rotate";
  const previousCode = clean(body?.previousCode, 70);
  if (action === "rotate" && !CODE_PATTERN.test(previousCode))
    return json({ error: "Falta el QR anterior para reemplazarlo." }, 400, origin);
  const result = await invoke(env, route, {
    op: action, token, ...period, ...(action === "rotate" ? { previousCode } : {}),
  });
  if (!result.ok) return json({ error: result.error || "No se pudo generar el QR." }, result.status, origin);
  return appResponse(request, result.record);
}
export async function currentAppQrMapping(env, code) {
  if (!appQrEnabled(env) || !available(env) || !env.PAYMENT_STATE || !CODE_PATTERN.test(code))
    return null;
  const route = code.slice(1, 17);
  const result = await invoke(env, route, { op: "validate", code });
  if (!result.ok || !result.record?.token) return null;
  const { token } = result.record;
  if (!TOKEN_PATTERN.test(token)) return null;
  const member = await readJson(env, `member:${token}`);
  if (!member || !memberActive(member)) return null;
  const period = validity(member);
  if (period.validFrom !== result.record.validFrom ||
      period.validUntil !== result.record.validUntil) return null;
  // HMAC route binds the opaque code's authority to this member and period.
  if (await routeFor(env, token, period) !== route) return null;
  return { code, token, member, period, slot: result.record.slot,
    qrValidUntil: new Date((result.record.slot + 1) * WINDOW_MS).toISOString() };
}
export async function verifyAppQrRevision(env, token, code, slot) {
  const result = await currentAppQrMapping(env, code);
  return Boolean(result && result.token === token && result.slot === slot);
}
