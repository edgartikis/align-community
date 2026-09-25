import syncWorker from "./entry-sync.js";

const ALLOWED_ORIGINS = new Set([
  "https://alignmembers.com.mx",
  "https://www.alignmembers.com.mx",
  "https://edgartikis.github.io",
]);

function cors(origin = "") {
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : "https://alignmembers.com.mx";
  return {
    "access-control-allow-origin": allowed,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    vary: "Origin",
  };
}

function json(body, status = 200, origin = "") {
  return Response.json(body, { status, headers: { ...cors(origin), "cache-control": "no-store" } });
}

function clean(value, max = 200) {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .trim()
    .slice(0, max);
}

function addCalendarMonth(iso) {
  const source = new Date(iso);
  if (Number.isNaN(source.getTime())) return new Date(Date.now() + 30 * 86400000).toISOString();
  const y = source.getUTCFullYear(), m = source.getUTCMonth(), d = source.getUTCDate();
  const targetMonth = m + 1;
  const lastDay = new Date(Date.UTC(y, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, targetMonth, Math.min(d, lastDay), source.getUTCHours(), source.getUTCMinutes(), source.getUTCSeconds(), source.getUTCMilliseconds())).toISOString();
}

function periodForMember(member) {
  const validFrom = member.validFrom || member.joinedAt || new Date().toISOString();
  return { validFrom, validUntil: member.validUntil || addCalendarMonth(validFrom) };
}

function isWithinPeriod(period, now = Date.now()) {
  const from = new Date(period.validFrom).getTime();
  const until = new Date(period.validUntil).getTime();
  return Number.isFinite(from) && Number.isFinite(until) && now >= from && now < until;
}

async function hmacBase64Url(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
  let binary = "";
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function qrSecret(env) {
  const secret = String(env.QR_SIGNING_SECRET || env.STRIPE_SECRET_KEY || "").trim();
  if (!secret) throw new Error("No está configurada la firma de QR.");
  return secret;
}

function cycleKey(period) { return `${period.validFrom}|${period.validUntil}`; }

async function shortCode(env, token, period) {
  const digest = await hmacBase64Url(qrSecret(env), `short:${token}:${cycleKey(period)}`);
  return digest.slice(0, 22);
}

async function legacySignature(env, token, period) {
  return hmacBase64Url(qrSecret(env), `${token}:${cycleKey(period)}`);
}

function constantTimeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function shortPathCode(pathname) {
  const match = /^\/q\/([A-Za-z0-9_-]{16,64})$/.exec(pathname);
  return match ? match[1] : "";
}

function mappingTtl(period) {
  const until = new Date(period.validUntil).getTime();
  const seconds = Math.floor((until - Date.now()) / 1000) + 86400;
  return Math.max(60, Math.min(60 * 60 * 24 * 62, Number.isFinite(seconds) ? seconds : 86400));
}

function formatDateEs(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "America/Monterrey",
  }).format(date);
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[c]);
}

async function memberFromToken(env, token) {
  const raw = await env.PAYMENT_STATE.get(`member:${token}`);
  return raw ? JSON.parse(raw) : null;
}

async function handleShortQr(request, env) {
  const origin = request.headers.get("origin") || "";
  if (!env.PAYMENT_STATE) throw new Error("PAYMENT_STATE no está conectado.");
  const url = new URL(request.url);
  const token = clean(url.searchParams.get("token"), 140);
  if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) return json({ error: "Token no válido." }, 400, origin);

  const member = await memberFromToken(env, token);
  if (!member) return json({ error: "Miembro no encontrado." }, 404, origin);
  const period = periodForMember(member);
  if (member.status !== "Activa" || !isWithinPeriod(period)) {
    return json({ error: "La membresía no está vigente." }, 403, origin);
  }

  const code = await shortCode(env, token, period);
  await env.PAYMENT_STATE.put(`qr-short:${code}`, JSON.stringify({
    token,
    validFrom: period.validFrom,
    validUntil: period.validUntil,
  }), { expirationTtl: mappingTtl(period) });

  return json({
    validationUrl: `${url.origin}/q/${code}`,
    validFrom: period.validFrom,
    validUntil: period.validUntil,
  }, 200, origin);
}

async function resolveShortCode(env, code) {
  if (!env.PAYMENT_STATE || !code) return { ok: false, member: null, period: null, token: "" };
  const raw = await env.PAYMENT_STATE.get(`qr-short:${code}`);
  if (!raw) return { ok: false, member: null, period: null, token: "" };

  let mapping;
  try { mapping = JSON.parse(raw); } catch (_) { return { ok: false, member: null, period: null, token: "" }; }
  const token = clean(mapping.token, 140);
  const supplied = { validFrom: clean(mapping.validFrom, 60), validUntil: clean(mapping.validUntil, 60) };
  const member = /^[A-Za-z0-9_-]{20,}$/.test(token) ? await memberFromToken(env, token) : null;
  if (!member) return { ok: false, member: null, period: supplied, token };

  const current = periodForMember(member);
  const expectedCode = await shortCode(env, token, supplied);
  const sameCycle = supplied.validFrom === current.validFrom && supplied.validUntil === current.validUntil;
  const ok = Boolean(
    constantTimeEqual(expectedCode, code) &&
    sameCycle &&
    member.status === "Activa" &&
    isWithinPeriod(supplied)
  );
  return { ok, member, period: supplied, token };
}

function validationPage(result) {
  const ok = Boolean(result?.ok && result.member && result.period);
  const member = result?.member || {};
  const period = result?.period || { validFrom: "", validUntil: "" };
  const bg = ok
    ? "radial-gradient(circle at top,#245b43,#09130f 65%)"
    : "radial-gradient(circle at top,#653030,#160909 65%)";
  const validity = `${formatDateEs(period.validFrom)} — ${formatDateEs(period.validUntil)}`;
  const body = ok
    ? `<span class="status">Miembro activo</span>${member.photoUrl ? `<img class="photo" src="${escapeHtml(member.photoUrl)}" alt="Foto del socio">` : `<div class="photo fallback">${escapeHtml(String(member.name || "").charAt(0))}</div>`}<h1>${escapeHtml(member.name)}</h1><p class="level">ALIGN ${escapeHtml(member.level)}</p><p class="code">${escapeHtml(member.memberCode)}</p><p class="note">Verifica que la persona coincida con la foto antes de aplicar el beneficio.</p><p class="period">Vigencia ${escapeHtml(validity)}</p>`
    : `<span class="status">No válido</span><h1>QR no válido o vencido</h1><p class="note">Solicita al miembro abrir su tarjeta digital actual. El QR se renueva únicamente cuando la mensualidad está vigente.</p>`;

  return new Response(
    `<!doctype html><html lang="es-MX"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Validación ALIGN</title><style>*{box-sizing:border-box}body{min-height:100vh;margin:0;display:grid;place-items:center;padding:24px;background:${bg};color:#f5f2ec;font-family:Arial,sans-serif}.card{width:min(100%,460px);padding:32px;border:1px solid rgba(255,255,255,.25);border-radius:24px;background:rgba(5,8,7,.72);text-align:center}.status{display:inline-block;padding:8px 12px;border:1px solid currentColor;border-radius:999px;text-transform:uppercase;letter-spacing:.12em;font-size:12px}h1{margin:22px 0 8px;font:500 42px Georgia,serif}.level{color:#d9c6a5;font-size:22px}.code{font-family:monospace;letter-spacing:.12em}.photo{width:132px;height:132px;margin:24px auto 0;border-radius:50%;object-fit:cover;border:3px solid #d9c6a5;background:#222}.fallback{display:grid;place-items:center;font-size:42px}.note{color:#c7c7c7;line-height:1.55}.period{color:#999;font-family:monospace;font-size:12px}</style></head><body><main class="card">${body}</main></body></html>`,
    { status: ok ? 200 : 403, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }
  );
}

async function expandShortQr(env, rawQr) {
  let url;
  try { url = new URL(String(rawQr || "").trim()); } catch (_) { return rawQr; }
  const code = shortPathCode(url.pathname);
  const allowedHost = url.hostname === "api.alignmembers.com.mx" || url.hostname.endsWith(".workers.dev");
  if (!code || !allowedHost) return rawQr;

  const raw = await env.PAYMENT_STATE.get(`qr-short:${code}`);
  if (!raw) return rawQr;
  let mapping;
  try { mapping = JSON.parse(raw); } catch (_) { return rawQr; }

  const token = clean(mapping.token, 140);
  const period = { validFrom: clean(mapping.validFrom, 60), validUntil: clean(mapping.validUntil, 60) };
  const expectedCode = await shortCode(env, token, period);
  if (!constantTimeEqual(expectedCode, code)) return rawQr;

  const sig = await legacySignature(env, token, period);
  const legacy = new URL("/api/validate-member", url.origin);
  legacy.searchParams.set("token", token);
  legacy.searchParams.set("from", period.validFrom);
  legacy.searchParams.set("until", period.validUntil);
  legacy.searchParams.set("sig", sig);
  return legacy.toString();
}

async function rewriteAllyRequest(request, env) {
  const body = await request.clone().json().catch(() => null);
  if (!body || typeof body !== "object" || !body.qr) return request;
  const expanded = await expandShortQr(env, body.qr);
  if (expanded === body.qr) return request;
  const headers = new Headers(request.headers);
  headers.set("content-type", "application/json");
  headers.delete("content-length");
  return new Request(request.url, {
    method: request.method,
    headers,
    body: JSON.stringify({ ...body, qr: expanded }),
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (request.method === "GET" && url.pathname === "/api/monthly-qr") {
        return await handleShortQr(request, env);
      }

      const code = request.method === "GET" ? shortPathCode(url.pathname) : "";
      if (code) {
        return validationPage(await resolveShortCode(env, code));
      }

      if (request.method === "POST" && (url.pathname === "/api/ally/scan" || url.pathname === "/api/ally/visit")) {
        return syncWorker.fetch(await rewriteAllyRequest(request, env), env);
      }
    } catch (error) {
      console.error("ALIGN short QR wrapper", error);
      if (url.pathname.startsWith("/q/")) return validationPage({ ok: false });
      return json({ error: error?.message || "No fue posible generar el QR." }, 500, request.headers.get("origin") || "");
    }

    return syncWorker.fetch(request, env);
  },
};
