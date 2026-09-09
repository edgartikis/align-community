const PLANS = Object.freeze({
  brotherhood: { name: "The Brotherhood", seats: 1, prefix: "BRO", founderPriceEnv: "STRIPE_PRICE_BROTHERHOOD_FOUNDER", regularPriceEnv: "STRIPE_PRICE_BROTHERHOOD_REGULAR" },
  girls: { name: "Girls Club", seats: 1, prefix: "GIR", founderPriceEnv: "STRIPE_PRICE_GIRLS_FOUNDER", regularPriceEnv: "STRIPE_PRICE_GIRLS_REGULAR" },
  ranch: { name: "Cowboys", seats: 1, prefix: "COW", founderPriceEnv: "STRIPE_PRICE_RANCH_FOUNDER", regularPriceEnv: "STRIPE_PRICE_RANCH_REGULAR" },
  duo: { name: "Duo Club", seats: 2, prefix: "DUO", standardPriceEnv: "STRIPE_PRICE_DUO" },
  circle: { name: "Private Circle", seats: 3, prefix: "CIR", standardPriceEnv: "STRIPE_PRICE_CIRCLE" },
});

const FOUNDER_LIMIT = 150;
const FOUNDER_PRICE_ENVS = ["STRIPE_PRICE_BROTHERHOOD_FOUNDER", "STRIPE_PRICE_GIRLS_FOUNDER", "STRIPE_PRICE_RANCH_FOUNDER"];
const ALLOWED_ORIGINS = new Set(["https://alignmembers.com.mx", "https://www.alignmembers.com.mx", "https://edgartikis.github.io"]);
const encoder = new TextEncoder();

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

function required(env, name) {
  const value = String(env[name] || "").trim();
  if (!value) throw new Error(`Falta la variable ${name}.`);
  return value;
}

function clean(value, max = 200) {
  return String(value == null ? "" : value).replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, max);
}

function normalizeMembers(value, seats) {
  if (!Array.isArray(value) || value.length !== seats) throw new Error(`Este plan requiere ${seats} integrante${seats === 1 ? "" : "s"}.`);
  return value.map((member, index) => {
    const name = clean(member?.name, 100);
    const email = clean(member?.email, 120).toLowerCase();
    const phone = clean(member?.phone, 30).replace(/[^0-9+ ()-]/g, "");
    if (!name || !/^\S+@\S+\.\S+$/.test(email) || phone.replace(/\D/g, "").length < 8) throw new Error(`Revisa los datos del integrante ${index + 1}.`);
    return { name, email, phone };
  });
}

function validPasswordHash(value) {
  const hash = clean(value, 64).toLowerCase();
  return /^[a-f0-9]{64}$/.test(hash) ? hash : "";
}

function randomId(prefix = "draft") { return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`; }
function randomToken() { return `${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`; }
function siteOrigin(env) { return String(env.SITE_ORIGIN || "https://alignmembers.com.mx").replace(/\/$/, ""); }
function apiOrigin(request) { return new URL(request.url).origin; }
function memberCode(prefix, index) { return `AL-${prefix}-${crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}${index || ""}`; }

function stripeSecret(env) {
  const secret = required(env, "STRIPE_SECRET_KEY");
  if (!/^sk_(test|live)_/.test(secret) && !/^rk_(test|live)_/.test(secret)) throw new Error("La clave privada de Stripe no tiene un formato válido.");
  return secret;
}

async function stripePost(env, path, params) {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${stripeSecret(env)}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || "Stripe rechazó la solicitud.");
  return payload;
}

async function stripeGet(env, path, params = {}) {
  const url = new URL(`https://api.stripe.com/v1/${path}`);
  Object.entries(params).forEach(([key, value]) => { if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value)); });
  const response = await fetch(url, { headers: { authorization: `Bearer ${stripeSecret(env)}` } });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || "Stripe rechazó la solicitud.");
  return payload;
}

async function countSubscriptionsForPrice(env, priceId, stopAt) {
  let total = 0, startingAfter = "";
  do {
    const page = await stripeGet(env, "subscriptions", { price: priceId, status: "all", limit: 100, starting_after: startingAfter || undefined });
    total += Array.isArray(page.data) ? page.data.length : 0;
    if (total >= stopAt || !page.has_more || !page.data?.length) return total;
    startingAfter = page.data[page.data.length - 1].id;
  } while (startingAfter);
  return total;
}

async function founderCount(env) {
  let total = 0;
  for (const envName of FOUNDER_PRICE_ENVS) {
    const priceId = required(env, envName);
    total += await countSubscriptionsForPrice(env, priceId, FOUNDER_LIMIT - total);
    if (total >= FOUNDER_LIMIT) return total;
  }
  return total;
}

async function resolvePrice(env, plan) {
  if (plan.standardPriceEnv) return { priceId: required(env, plan.standardPriceEnv), tier: "standard", founderCount: null };
  const used = await founderCount(env);
  const founder = used < FOUNDER_LIMIT;
  return { priceId: required(env, founder ? plan.founderPriceEnv : plan.regularPriceEnv), tier: founder ? "founder" : "regular", founderCount: used };
}

async function createCheckout(request, env) {
  const origin = request.headers.get("origin") || "";
  const body = await request.json();
  const planKey = clean(body.plan, 30).toLowerCase();
  const plan = PLANS[planKey];
  if (!plan) return json({ error: "Membresía no válida." }, 400, origin);
  if (!env.PAYMENT_STATE) throw new Error("Falta conectar el binding PAYMENT_STATE de Cloudflare KV.");

  const members = normalizeMembers(body.members, plan.seats);
  const username = clean(body.username, 24).toLowerCase();
  const passwordHash = validPasswordHash(body.passwordHash);
  if (!/^[a-z0-9._-]{4,24}$/i.test(username)) return json({ error: "El usuario debe tener de 4 a 24 caracteres." }, 400, origin);
  if (!passwordHash) return json({ error: "No se recibió una contraseña segura." }, 400, origin);

  const price = await resolvePrice(env, plan);
  if (!/^price_/.test(price.priceId)) throw new Error("El Price ID de Stripe no es válido.");

  const draftId = randomId();
  const draft = { version: 3, draftId, plan: planKey, planName: plan.name, seats: plan.seats, stripePriceId: price.priceId, pricingTier: price.tier, founderCountAtCheckout: price.founderCount, username, passwordHash, members, createdAt: new Date().toISOString() };
  await env.PAYMENT_STATE.put(`draft:${draftId}`, JSON.stringify(draft), { expirationTtl: 60 * 60 * 48 });

  const base = siteOrigin(env);
  const session = await stripePost(env, "checkout/sessions", {
    mode: "subscription",
    "line_items[0][price]": price.priceId,
    "line_items[0][quantity]": "1",
    customer_email: members[0].email,
    client_reference_id: draftId,
    success_url: `${base}/payment-success.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/pago.html?plan=${encodeURIComponent(planKey)}&cancel=1`,
    locale: "es",
    billing_address_collection: "auto",
    "phone_number_collection[enabled]": "true",
    "automatic_tax[enabled]": "true",
    "tax_id_collection[enabled]": "true",
    "metadata[align_draft_id]": draftId,
    "metadata[align_plan]": planKey,
    "metadata[align_pricing_tier]": price.tier,
    "subscription_data[metadata][align_draft_id]": draftId,
    "subscription_data[metadata][align_plan]": planKey,
    "subscription_data[metadata][align_pricing_tier]": price.tier,
  });

  await env.PAYMENT_STATE.put(`session:${session.id}`, draftId, { expirationTtl: 60 * 60 * 48 });
  return json({ url: session.url, sessionId: session.id, pricingTier: price.tier, founderSpotsUsed: price.founderCount, founderLimit: FOUNDER_LIMIT }, 200, origin);
}

function parseStripeSignature(header) {
  const out = { t: "", v1: [] };
  for (const part of String(header || "").split(",")) {
    const [key, value] = part.split("=", 2);
    if (key === "t") out.t = value || "";
    if (key === "v1" && value) out.v1.push(value);
  }
  return out;
}

async function hmacHex(secret, value) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacBase64Url(secret, value) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
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

async function verifyWebhook(rawBody, header, secret) {
  const sig = parseStripeSignature(header), timestamp = Number(sig.t);
  if (!timestamp || Math.abs(Date.now() / 1000 - timestamp) > 300) return false;
  const expected = await hmacHex(secret, `${sig.t}.${rawBody}`);
  return sig.v1.some((candidate) => constantTimeEqual(expected, candidate));
}

async function postDatabase(env, payload) {
  const url = required(env, "ALIGN_DB_URL"), secret = required(env, "ALIGN_DB_SECRET");
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...payload, mode: "ALIGN_PROD_2026", secret }),
  });
  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch (_) {}
  if (!response.ok || !data?.ok) {
    console.error("ALIGN database sync failed", {
      status: response.status,
      contentType: response.headers.get("content-type") || "",
      preview: text.slice(0, 180),
    });
    throw new Error("La base de ALIGN no respondió correctamente.");
  }
  return data;
}

function activationDatabasePayload(session, draftId, draft, members) {
  return {
    action: "register_payment",
    paymentId: session.id,
    reference: session.id,
    stripeCustomerId: session.customer || "",
    stripeSubscriptionId: session.subscription || "",
    socioId: `STRIPE-${session.customer || draftId}`,
    username: draft.username,
    passwordHash: draft.passwordHash,
    planKey: draft.plan,
    planName: draft.planName,
    pricingTier: draft.pricingTier,
    amount: Number(session.amount_total || 0) / 100,
    currency: String(session.currency || "mxn").toUpperCase(),
    members,
  };
}

async function retryActivationDatabaseSync(env, session, record) {
  if (record.dbSynced !== false) return record;
  const draftId = clean(session.metadata?.align_draft_id || session.client_reference_id, 80);
  if (!draftId) return record;
  const raw = await env.PAYMENT_STATE.get(`draft:${draftId}`);
  if (!raw) return record;
  const draft = JSON.parse(raw);
  try {
    await postDatabase(env, activationDatabasePayload(session, draftId, draft, record.members));
    record.dbSynced = true;
    record.dbSyncError = "";
    await env.PAYMENT_STATE.put(`activation:${session.id}`, JSON.stringify(record), { expirationTtl: 60 * 60 * 24 * 365 });
  } catch (error) {
    record.dbSynced = false;
    record.dbSyncError = "pending";
  }
  return record;
}

async function activationRecord(env, session) {
  const key = `activation:${session.id}`;
  const existing = await env.PAYMENT_STATE.get(key);
  if (existing) return retryActivationDatabaseSync(env, session, JSON.parse(existing));

  const draftId = clean(session.metadata?.align_draft_id || session.client_reference_id, 80);
  if (!draftId) throw new Error("Stripe no devolvió el identificador del registro.");
  const raw = await env.PAYMENT_STATE.get(`draft:${draftId}`);
  if (!raw) throw new Error("El registro previo al pago expiró o no existe.");
  const draft = JSON.parse(raw), plan = PLANS[draft.plan];
  if (!plan) throw new Error("El plan de la compra no es válido.");

  const groupId = randomId("grp"), joinedAt = new Date().toISOString();
  const members = draft.members.map((member, index) => ({
    integranteId: `${session.customer || draftId}-P${index + 1}`,
    token: randomToken(),
    memberCode: memberCode(plan.prefix, index + 1),
    name: member.name,
    email: member.email,
    phone: member.phone,
    level: draft.planName,
    planKey: draft.plan,
    status: "Activa",
    position: index + 1,
    groupId,
    joinedAt,
    savings: 0,
    photoUrl: "",
  }));

  const record = {
    version: 2,
    sessionId: session.id,
    subscriptionId: session.subscription || "",
    customerId: session.customer || "",
    groupId,
    planKey: draft.plan,
    level: draft.planName,
    username: draft.username,
    members,
    dbSynced: false,
    dbSyncError: "pending",
  };

  // Cloudflare KV is the operational source for the member card. Save the verified
  // Stripe membership first so a reporting-sheet outage can never block access.
  for (const member of members) await env.PAYMENT_STATE.put(`member:${member.token}`, JSON.stringify(member));
  await env.PAYMENT_STATE.put(`group:${groupId}`, JSON.stringify({ groupId, tokens: members.map((m) => m.token) }));
  if (session.subscription) await env.PAYMENT_STATE.put(`subscription:${session.subscription}`, groupId);
  await env.PAYMENT_STATE.put(key, JSON.stringify(record), { expirationTtl: 60 * 60 * 24 * 365 });

  return retryActivationDatabaseSync(env, session, record);
}

async function registerCheckout(env, session) { return activationRecord(env, session); }

async function updateGroupStatus(env, subscriptionId, status) {
  if (!subscriptionId) return;
  const groupId = await env.PAYMENT_STATE.get(`subscription:${subscriptionId}`);
  if (!groupId) return;
  const groupRaw = await env.PAYMENT_STATE.get(`group:${groupId}`);
  if (!groupRaw) return;
  const group = JSON.parse(groupRaw);
  for (const token of group.tokens || []) {
    const raw = await env.PAYMENT_STATE.get(`member:${token}`);
    if (!raw) continue;
    const member = JSON.parse(raw);
    member.status = status;
    await env.PAYMENT_STATE.put(`member:${token}`, JSON.stringify(member));
  }
}

async function processEvent(env, event) {
  const object = event?.data?.object || {};
  switch (event.type) {
    case "checkout.session.completed": {
      if (object.mode === "subscription" && ["paid", "no_payment_required"].includes(object.payment_status)) {
        const record = await registerCheckout(env, object);
        if (record.dbSynced === false) throw new Error("Sincronización con la base pendiente.");
      }
      break;
    }
    case "invoice.paid": {
      const subscriptionId = object.subscription || object.parent?.subscription_details?.subscription || "";
      await updateGroupStatus(env, subscriptionId, "Activa");
      await postDatabase(env, { action: "subscription_renewed", invoiceId: object.id || "", stripeCustomerId: object.customer || "", stripeSubscriptionId: subscriptionId, amount: Number(object.amount_paid || 0) / 100, currency: String(object.currency || "mxn").toUpperCase() });
      break;
    }
    case "invoice.payment_failed": {
      const subscriptionId = object.subscription || object.parent?.subscription_details?.subscription || "";
      await updateGroupStatus(env, subscriptionId, "Pago pendiente");
      await postDatabase(env, { action: "subscription_payment_failed", invoiceId: object.id || "", stripeCustomerId: object.customer || "", stripeSubscriptionId: subscriptionId });
      break;
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const stripeStatus = object.status || (event.type.endsWith("deleted") ? "canceled" : "unknown");
      const active = ["active", "trialing"].includes(String(stripeStatus).toLowerCase());
      const pending = ["past_due", "unpaid", "incomplete"].includes(String(stripeStatus).toLowerCase());
      await updateGroupStatus(env, object.id || "", active ? "Activa" : pending ? "Pago pendiente" : "Inactiva");
      await postDatabase(env, { action: "subscription_status", stripeCustomerId: object.customer || "", stripeSubscriptionId: object.id || "", status: stripeStatus, cancelAtPeriodEnd: Boolean(object.cancel_at_period_end), currentPeriodEnd: object.current_period_end || null });
      break;
    }
    default: break;
  }
}

async function stripeWebhook(request, env) {
  if (!env.PAYMENT_STATE) throw new Error("Falta conectar el binding PAYMENT_STATE de Cloudflare KV.");
  const rawBody = await request.text(), secret = required(env, "STRIPE_WEBHOOK_SECRET");
  const valid = await verifyWebhook(rawBody, request.headers.get("stripe-signature"), secret);
  if (!valid) return new Response("Firma inválida.", { status: 400 });
  const event = JSON.parse(rawBody), eventKey = `event:${event.id}`;
  if (await env.PAYMENT_STATE.get(eventKey)) return Response.json({ received: true, duplicate: true });
  await processEvent(env, event);
  await env.PAYMENT_STATE.put(eventKey, "1", { expirationTtl: 60 * 60 * 24 * 30 });
  return Response.json({ received: true });
}

async function activateMembership(request, env) {
  const origin = request.headers.get("origin") || "", url = new URL(request.url), sessionId = clean(url.searchParams.get("session_id"), 160);
  if (!/^cs_(test_|live_)?[A-Za-z0-9_]+$/.test(sessionId)) return json({ error: "Sesión no válida." }, 400, origin);
  const session = await stripeGet(env, `checkout/sessions/${encodeURIComponent(sessionId)}`);
  if (session.mode !== "subscription" || !["paid", "no_payment_required"].includes(session.payment_status)) return json({ pending: true }, 202, origin);
  const record = await activationRecord(env, session);
  return json({
    level: record.level,
    databaseSync: record.dbSynced ? "ok" : "pending",
    members: record.members.map(({ token, name, memberCode }) => ({ token, name, memberCode, memberUrl: `${siteOrigin(env)}/member.html?token=${encodeURIComponent(token)}` })),
  }, 200, origin);
}

async function memberCard(request, env) {
  const origin = request.headers.get("origin") || "", token = clean(new URL(request.url).searchParams.get("token"), 140);
  if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) return json({ error: "Tarjeta no encontrada." }, 404, origin);
  const raw = await env.PAYMENT_STATE.get(`member:${token}`);
  if (!raw) return json({ error: "Tarjeta no encontrada." }, 404, origin);
  const member = JSON.parse(raw);
  return json({ active: member.status === "Activa", name: member.name, level: member.level, planKey: member.planKey, memberCode: member.memberCode, joinedAt: member.joinedAt, savings: Number(member.savings || 0), photoUrl: member.photoUrl || "", needsPhoto: !member.photoUrl, status: member.status }, 200, origin);
}

async function uploadProfilePhoto(request, env) {
  const origin = request.headers.get("origin") || "", body = await request.json(), token = clean(body.token, 140), photo = String(body.photo || "");
  if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) return json({ error: "Cuenta no válida." }, 400, origin);
  if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(photo)) return json({ error: "Formato de foto no válido." }, 400, origin);
  if (photo.length > 45000) return json({ error: "La foto es demasiado pesada. Intenta nuevamente." }, 413, origin);
  const raw = await env.PAYMENT_STATE.get(`member:${token}`);
  if (!raw) return json({ error: "Miembro no encontrado." }, 404, origin);
  const member = JSON.parse(raw);
  if (member.status !== "Activa") return json({ error: "La membresía no está activa." }, 403, origin);
  member.photoUrl = photo;
  await env.PAYMENT_STATE.put(`member:${token}`, JSON.stringify(member));
  return json({ ok: true, memberUrl: `${siteOrigin(env)}/member.html?token=${encodeURIComponent(token)}` }, 200, origin);
}

function periodFor(date = new Date()) { return date.toISOString().slice(0, 7); }
async function qrSignature(env, token, period) { return hmacBase64Url(env.QR_SIGNING_SECRET || stripeSecret(env), `${token}:${period}`); }

async function monthlyQr(request, env) {
  const origin = request.headers.get("origin") || "", url = new URL(request.url), token = clean(url.searchParams.get("token"), 140);
  if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) return json({ error: "Token no válido." }, 400, origin);
  const raw = await env.PAYMENT_STATE.get(`member:${token}`);
  if (!raw) return json({ error: "Miembro no encontrado." }, 404, origin);
  const period = periodFor(), sig = await qrSignature(env, token, period);
  const validationUrl = new URL("/api/validate-member", apiOrigin(request));
  validationUrl.searchParams.set("token", token);
  validationUrl.searchParams.set("period", period);
  validationUrl.searchParams.set("sig", sig);
  return json({ validationUrl: validationUrl.toString(), period }, 200, origin);
}

function escapeHtml(value) { return String(value || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]); }

async function validateMember(request, env) {
  const url = new URL(request.url), token = clean(url.searchParams.get("token"), 140), period = clean(url.searchParams.get("period"), 20), sig = clean(url.searchParams.get("sig"), 200), current = periodFor();
  const expected = /^[A-Za-z0-9_-]{20,}$/.test(token) && period === current ? await qrSignature(env, token, period) : "";
  const validSig = expected && constantTimeEqual(expected, sig);
  const raw = validSig ? await env.PAYMENT_STATE.get(`member:${token}`) : null;
  const member = raw ? JSON.parse(raw) : null;
  const ok = Boolean(member && member.status === "Activa");
  const bg = ok ? "radial-gradient(circle at top,#245b43,#09130f 65%)" : "radial-gradient(circle at top,#653030,#160909 65%)";
  const body = ok
    ? `<span class="status">Miembro activo</span>${member.photoUrl ? `<img class="photo" src="${escapeHtml(member.photoUrl)}" alt="Foto del socio">` : `<div class="photo fallback">${escapeHtml(member.name.charAt(0))}</div>`}<h1>${escapeHtml(member.name)}</h1><p class="level">ALIGN ${escapeHtml(member.level)}</p><p class="code">${escapeHtml(member.memberCode)}</p><p class="note">Verifica que la persona coincida con la foto antes de aplicar el beneficio.</p><p class="period">Vigencia ${escapeHtml(period)}</p>`
    : `<span class="status">No válido</span><h1>QR no válido</h1><p class="note">Solicita al miembro abrir su tarjeta digital actual. Si el problema continúa, contacta a ALIGN.</p>`;
  return new Response(`<!doctype html><html lang="es-MX"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Validación ALIGN</title><style>*{box-sizing:border-box}body{min-height:100vh;margin:0;display:grid;place-items:center;padding:24px;background:${bg};color:#f5f2ec;font-family:Arial,sans-serif}.card{width:min(100%,460px);padding:32px;border:1px solid rgba(255,255,255,.25);border-radius:24px;background:rgba(5,8,7,.72);text-align:center}.status{display:inline-block;padding:8px 12px;border:1px solid currentColor;border-radius:999px;text-transform:uppercase;letter-spacing:.12em;font-size:12px}h1{margin:22px 0 8px;font:500 42px Georgia,serif}.level{color:#d9c6a5;font-size:22px}.code{font-family:monospace;letter-spacing:.12em}.photo{width:132px;height:132px;margin:24px auto 0;border-radius:50%;object-fit:cover;border:3px solid #d9c6a5;background:#222}.fallback{display:grid;place-items:center;font-size:42px}.note{color:#c7c7c7;line-height:1.55}.period{color:#999;font-family:monospace;font-size:12px}</style></head><body><main class="card">${body}</main></body></html>`, { status: ok ? 200 : 403, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url), origin = request.headers.get("origin") || "";
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
      if (url.pathname === "/api/health" && request.method === "GET") return json({ ok: true, service: "ALIGN payments", founderLimit: FOUNDER_LIMIT }, 200, origin);
      if (url.pathname === "/api/checkout" && request.method === "POST") return await createCheckout(request, env);
      if (url.pathname === "/api/stripe/webhook" && request.method === "POST") return await stripeWebhook(request, env);
      if (url.pathname === "/api/activate-membership" && request.method === "GET") return await activateMembership(request, env);
      if (url.pathname === "/api/member-card" && request.method === "GET") return await memberCard(request, env);
      if (url.pathname === "/api/upload-profile-photo" && request.method === "POST") return await uploadProfilePhoto(request, env);
      if (url.pathname === "/api/monthly-qr" && request.method === "GET") return await monthlyQr(request, env);
      if (url.pathname === "/api/validate-member" && request.method === "GET") return await validateMember(request, env);
      return json({ error: "Ruta no encontrada." }, 404, origin);
    } catch (error) {
      console.error("ALIGN payments worker", error);
      return json({ error: error?.message || "Error interno de pagos." }, 500, request.headers.get("origin") || "");
    }
  },
};