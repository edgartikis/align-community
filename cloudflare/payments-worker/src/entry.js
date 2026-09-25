import baseWorker from "./index.js";

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
  return Response.json(body, {
    status,
    headers: { ...cors(origin), "cache-control": "no-store" },
  });
}

function clean(value, max = 200) {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .trim()
    .slice(0, max);
}

function stripeSecret(env) {
  const secret = String(env.STRIPE_SECRET_KEY || "").trim();
  if (!/^sk_(test|live)_/.test(secret) && !/^rk_(test|live)_/.test(secret)) {
    throw new Error("La clave privada de Stripe no tiene un formato válido.");
  }
  return secret;
}

async function stripeGet(env, path) {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { authorization: `Bearer ${stripeSecret(env)}` },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || "Stripe rechazó la solicitud.");
  return data;
}

function addCalendarMonth(iso) {
  const source = new Date(iso);
  if (Number.isNaN(source.getTime())) return new Date(Date.now() + 30 * 86400000).toISOString();
  const year = source.getUTCFullYear();
  const month = source.getUTCMonth();
  const day = source.getUTCDate();
  const hour = source.getUTCHours();
  const minute = source.getUTCMinutes();
  const second = source.getUTCSeconds();
  const ms = source.getUTCMilliseconds();
  const targetMonth = month + 1;
  const lastDay = new Date(Date.UTC(year, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, targetMonth, Math.min(day, lastDay), hour, minute, second, ms)).toISOString();
}

function fallbackPeriod(member) {
  const validFrom = member.validFrom || member.joinedAt || new Date().toISOString();
  const validUntil = member.validUntil || addCalendarMonth(validFrom);
  return { validFrom, validUntil };
}

function periodFromSubscription(subscription, fallbackIso = new Date().toISOString()) {
  const start = Number(subscription?.current_period_start || 0);
  const end = Number(subscription?.current_period_end || 0);
  if (start > 0 && end > start) {
    return {
      validFrom: new Date(start * 1000).toISOString(),
      validUntil: new Date(end * 1000).toISOString(),
    };
  }
  return { validFrom: fallbackIso, validUntil: addCalendarMonth(fallbackIso) };
}

async function putMemberPeriod(env, token, period) {
  const raw = await env.PAYMENT_STATE.get(`member:${token}`);
  if (!raw) return;
  const member = JSON.parse(raw);
  member.validFrom = period.validFrom;
  member.validUntil = period.validUntil;
  await env.PAYMENT_STATE.put(`member:${token}`, JSON.stringify(member));
}

async function updateTokensPeriod(env, tokens, period) {
  await Promise.all((tokens || []).map((token) => putMemberPeriod(env, token, period)));
}

async function syncSubscriptionPeriod(env, subscriptionId, directTokens = []) {
  if (!subscriptionId) return null;
  const subscription = await stripeGet(env, `subscriptions/${encodeURIComponent(subscriptionId)}`);
  const period = periodFromSubscription(subscription);

  if (directTokens.length) {
    await updateTokensPeriod(env, directTokens, period);
    return period;
  }

  const groupId = await env.PAYMENT_STATE.get(`subscription:${subscriptionId}`);
  if (!groupId) return period;
  const groupRaw = await env.PAYMENT_STATE.get(`group:${groupId}`);
  if (!groupRaw) return period;
  const group = JSON.parse(groupRaw);
  await updateTokensPeriod(env, group.tokens || [], period);
  return period;
}

async function hmacBase64Url(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))
  );
  let binary = "";
  signature.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function qrSecret(env) {
  return String(env.QR_SIGNING_SECRET || env.STRIPE_SECRET_KEY || "");
}

function cycleKey(period) {
  return `${period.validFrom}|${period.validUntil}`;
}

async function qrSignature(env, token, period) {
  return hmacBase64Url(qrSecret(env), `${token}:${cycleKey(period)}`);
}

function isWithinPeriod(period, now = Date.now()) {
  const from = new Date(period.validFrom).getTime();
  const until = new Date(period.validUntil).getTime();
  return Number.isFinite(from) && Number.isFinite(until) && now >= from && now < until;
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

async function handleActivation(request, env) {
  const response = await baseWorker.fetch(request, env);
  if (!response.ok) return response;

  const data = await response.clone().json().catch(() => null);
  const sessionId = clean(new URL(request.url).searchParams.get("session_id"), 160);
  if (!data?.members?.length || !sessionId) return response;

  try {
    const session = await stripeGet(env, `checkout/sessions/${encodeURIComponent(sessionId)}`);
    const subscriptionId = typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id || "";
    const tokens = data.members.map((member) => member.token).filter(Boolean);
    const period = await syncSubscriptionPeriod(env, subscriptionId, tokens);
    if (!period) return response;
    return json({ ...data, validFrom: period.validFrom, validUntil: period.validUntil }, 200, request.headers.get("origin") || "");
  } catch (error) {
    console.error("ALIGN billing period sync", error);
    return response;
  }
}

async function handleWebhook(request, env) {
  const rawPromise = request.clone().text();
  const response = await baseWorker.fetch(request, env);
  if (!response.ok) return response;

  try {
    const event = JSON.parse(await rawPromise);
    const object = event?.data?.object || {};
    let subscriptionId = "";
    if (event.type === "checkout.session.completed") {
      subscriptionId = typeof object.subscription === "string" ? object.subscription : object.subscription?.id || "";
    } else if (event.type === "invoice.paid") {
      subscriptionId = object.subscription || object.parent?.subscription_details?.subscription || "";
    } else if (event.type === "customer.subscription.updated") {
      subscriptionId = object.id || "";
    }
    if (subscriptionId) await syncSubscriptionPeriod(env, subscriptionId);
  } catch (error) {
    console.error("ALIGN renewal period sync", error);
  }
  return response;
}

async function handleMemberCard(request, env) {
  const origin = request.headers.get("origin") || "";
  const token = clean(new URL(request.url).searchParams.get("token"), 140);
  if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) return json({ error: "Tarjeta no encontrada." }, 404, origin);
  const raw = await env.PAYMENT_STATE.get(`member:${token}`);
  if (!raw) return json({ error: "Tarjeta no encontrada." }, 404, origin);
  const member = JSON.parse(raw);
  const period = fallbackPeriod(member);
  const active = member.status === "Activa" && isWithinPeriod(period);
  return json({
    active,
    name: member.name,
    level: member.level,
    planKey: member.planKey,
    memberCode: member.memberCode,
    joinedAt: member.joinedAt,
    validFrom: period.validFrom,
    validUntil: period.validUntil,
    savings: Number(member.savings || 0),
    photoUrl: member.photoUrl || "",
    needsPhoto: !member.photoUrl,
    status: active ? "Activa" : member.status === "Activa" ? "Vencida" : member.status,
  }, 200, origin);
}

async function handleCycleQr(request, env) {
  const origin = request.headers.get("origin") || "";
  const url = new URL(request.url);
  const token = clean(url.searchParams.get("token"), 140);
  if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) return json({ error: "Token no válido." }, 400, origin);
  const raw = await env.PAYMENT_STATE.get(`member:${token}`);
  if (!raw) return json({ error: "Miembro no encontrado." }, 404, origin);
  const member = JSON.parse(raw);
  const period = fallbackPeriod(member);
  if (member.status !== "Activa" || !isWithinPeriod(period)) {
    return json({ error: "La membresía no está vigente." }, 403, origin);
  }
  const sig = await qrSignature(env, token, period);
  const validationUrl = new URL("/api/validate-member", url.origin);
  validationUrl.searchParams.set("token", token);
  validationUrl.searchParams.set("from", period.validFrom);
  validationUrl.searchParams.set("until", period.validUntil);
  validationUrl.searchParams.set("sig", sig);
  return json({
    validationUrl: validationUrl.toString(),
    validFrom: period.validFrom,
    validUntil: period.validUntil,
  }, 200, origin);
}

async function handleValidation(request, env) {
  const url = new URL(request.url);
  const token = clean(url.searchParams.get("token"), 140);
  const from = clean(url.searchParams.get("from"), 60);
  const until = clean(url.searchParams.get("until"), 60);
  const sig = clean(url.searchParams.get("sig"), 200);
  const raw = /^[A-Za-z0-9_-]{20,}$/.test(token) ? await env.PAYMENT_STATE.get(`member:${token}`) : null;
  const member = raw ? JSON.parse(raw) : null;
  const currentPeriod = member ? fallbackPeriod(member) : null;
  const suppliedPeriod = { validFrom: from, validUntil: until };
  const sameCycle = Boolean(currentPeriod && from === currentPeriod.validFrom && until === currentPeriod.validUntil);
  const expected = sameCycle ? await qrSignature(env, token, suppliedPeriod) : "";
  const validSig = Boolean(expected && constantTimeEqual(expected, sig));
  const ok = Boolean(member && member.status === "Activa" && validSig && isWithinPeriod(suppliedPeriod));
  const bg = ok
    ? "radial-gradient(circle at top,#245b43,#09130f 65%)"
    : "radial-gradient(circle at top,#653030,#160909 65%)";
  const validity = `${formatDateEs(from)} — ${formatDateEs(until)}`;
  const body = ok
    ? `<span class="status">Miembro activo</span>${member.photoUrl ? `<img class="photo" src="${escapeHtml(member.photoUrl)}" alt="Foto del socio">` : `<div class="photo fallback">${escapeHtml(member.name.charAt(0))}</div>`}<h1>${escapeHtml(member.name)}</h1><p class="level">ALIGN ${escapeHtml(member.level)}</p><p class="code">${escapeHtml(member.memberCode)}</p><p class="note">Verifica que la persona coincida con la foto antes de aplicar el beneficio.</p><p class="period">Vigencia ${escapeHtml(validity)}</p>`
    : `<span class="status">No válido</span><h1>QR no válido o vencido</h1><p class="note">Solicita al miembro abrir su tarjeta digital actual. El QR se renueva únicamente cuando la mensualidad está vigente.</p>`;

  return new Response(
    `<!doctype html><html lang="es-MX"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Validación ALIGN</title><style>*{box-sizing:border-box}body{min-height:100vh;margin:0;display:grid;place-items:center;padding:24px;background:${bg};color:#f5f2ec;font-family:Arial,sans-serif}.card{width:min(100%,460px);padding:32px;border:1px solid rgba(255,255,255,.25);border-radius:24px;background:rgba(5,8,7,.72);text-align:center}.status{display:inline-block;padding:8px 12px;border:1px solid currentColor;border-radius:999px;text-transform:uppercase;letter-spacing:.12em;font-size:12px}h1{margin:22px 0 8px;font:500 42px Georgia,serif}.level{color:#d9c6a5;font-size:22px}.code{font-family:monospace;letter-spacing:.12em}.photo{width:132px;height:132px;margin:24px auto 0;border-radius:50%;object-fit:cover;border:3px solid #d9c6a5;background:#222}.fallback{display:grid;place-items:center;font-size:42px}.note{color:#c7c7c7;line-height:1.55}.period{color:#999;font-family:monospace;font-size:12px}</style></head><body><main class="card">${body}</main></body></html>`,
    { status: ok ? 200 : 403, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return baseWorker.fetch(request, env);
    if (url.pathname === "/api/activate-membership" && request.method === "GET") return handleActivation(request, env);
    if (url.pathname === "/api/stripe/webhook" && request.method === "POST") return handleWebhook(request, env);
    if (url.pathname === "/api/member-card" && request.method === "GET") return handleMemberCard(request, env);
    if (url.pathname === "/api/monthly-qr" && request.method === "GET") return handleCycleQr(request, env);
    if (url.pathname === "/api/validate-member" && request.method === "GET") return handleValidation(request, env);
    return baseWorker.fetch(request, env);
  },
};
