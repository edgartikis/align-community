const PLANS = Object.freeze({
  brotherhood: {
    name: "The Brotherhood",
    seats: 1,
    founderPriceEnv: "STRIPE_PRICE_BROTHERHOOD_FOUNDER",
    regularPriceEnv: "STRIPE_PRICE_BROTHERHOOD_REGULAR",
  },
  girls: {
    name: "Girls Club",
    seats: 1,
    founderPriceEnv: "STRIPE_PRICE_GIRLS_FOUNDER",
    regularPriceEnv: "STRIPE_PRICE_GIRLS_REGULAR",
  },
  ranch: {
    name: "Cowboys",
    seats: 1,
    founderPriceEnv: "STRIPE_PRICE_RANCH_FOUNDER",
    regularPriceEnv: "STRIPE_PRICE_RANCH_REGULAR",
  },
  duo: {
    name: "Duo Club",
    seats: 2,
    standardPriceEnv: "STRIPE_PRICE_DUO",
  },
  circle: {
    name: "Private Circle",
    seats: 3,
    standardPriceEnv: "STRIPE_PRICE_CIRCLE",
  },
});

const FOUNDER_LIMIT = 150;
const FOUNDER_PRICE_ENVS = [
  "STRIPE_PRICE_BROTHERHOOD_FOUNDER",
  "STRIPE_PRICE_GIRLS_FOUNDER",
  "STRIPE_PRICE_RANCH_FOUNDER",
];

const ALLOWED_ORIGINS = new Set([
  "https://alignmembers.com.mx",
  "https://www.alignmembers.com.mx",
  "https://edgartikis.github.io",
]);

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
  return Response.json(body, {
    status,
    headers: { ...cors(origin), "cache-control": "no-store" },
  });
}

function required(env, name) {
  const value = String(env[name] || "").trim();
  if (!value) throw new Error(`Falta la variable ${name}.`);
  return value;
}

function clean(value, max = 200) {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .trim()
    .slice(0, max);
}

function normalizeMembers(value, seats) {
  if (!Array.isArray(value) || value.length !== seats) {
    throw new Error(`Este plan requiere ${seats} integrante${seats === 1 ? "" : "s"}.`);
  }
  return value.map((member, index) => {
    const name = clean(member?.name, 100);
    const email = clean(member?.email, 120).toLowerCase();
    const phone = clean(member?.phone, 30).replace(/[^0-9+ ()-]/g, "");
    if (!name || !/^\S+@\S+\.\S+$/.test(email) || phone.replace(/\D/g, "").length < 8) {
      throw new Error(`Revisa los datos del integrante ${index + 1}.`);
    }
    return { name, email, phone };
  });
}

function validPasswordHash(value) {
  const hash = clean(value, 64).toLowerCase();
  return /^[a-f0-9]{64}$/.test(hash) ? hash : "";
}

function randomId(prefix = "draft") {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

function siteOrigin(env) {
  return String(env.SITE_ORIGIN || "https://alignmembers.com.mx").replace(/\/$/, "");
}

function stripeSecret(env) {
  const secret = required(env, "STRIPE_SECRET_KEY");
  if (!/^sk_(test|live)_/.test(secret) && !/^rk_(test|live)_/.test(secret)) {
    throw new Error("La clave privada de Stripe no tiene un formato válido.");
  }
  return secret;
}

async function stripePost(env, path, params) {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${stripeSecret(env)}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || "Stripe rechazó la solicitud.");
  return payload;
}

async function stripeGet(env, path, params = {}) {
  const url = new URL(`https://api.stripe.com/v1/${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  });
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${stripeSecret(env)}` },
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || "Stripe rechazó la solicitud.");
  return payload;
}

async function countSubscriptionsForPrice(env, priceId, stopAt) {
  let total = 0;
  let startingAfter = "";
  do {
    const page = await stripeGet(env, "subscriptions", {
      price: priceId,
      status: "all",
      limit: 100,
      starting_after: startingAfter || undefined,
    });
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
  if (plan.standardPriceEnv) {
    return {
      priceId: required(env, plan.standardPriceEnv),
      tier: "standard",
      founderCount: null,
    };
  }

  const used = await founderCount(env);
  const founder = used < FOUNDER_LIMIT;
  return {
    priceId: required(env, founder ? plan.founderPriceEnv : plan.regularPriceEnv),
    tier: founder ? "founder" : "regular",
    founderCount: used,
  };
}

async function createCheckout(request, env) {
  const origin = request.headers.get("origin") || "";
  const body = await request.json();
  const planKey = clean(body.plan, 30).toLowerCase();
  const plan = PLANS[planKey];
  if (!plan) return json({ error: "Membresía no válida." }, 400, origin);

  if (!env.PAYMENT_STATE) {
    throw new Error("Falta conectar el binding PAYMENT_STATE de Cloudflare KV.");
  }

  const members = normalizeMembers(body.members, plan.seats);
  const username = clean(body.username, 24).toLowerCase();
  const passwordHash = validPasswordHash(body.passwordHash);
  if (!/^[a-z0-9._-]{4,24}$/i.test(username)) {
    return json({ error: "El usuario debe tener de 4 a 24 caracteres." }, 400, origin);
  }
  if (!passwordHash) return json({ error: "No se recibió una contraseña segura." }, 400, origin);

  const price = await resolvePrice(env, plan);
  if (!/^price_/.test(price.priceId)) throw new Error("El Price ID de Stripe no es válido.");

  const draftId = randomId();
  const draft = {
    version: 2,
    draftId,
    plan: planKey,
    planName: plan.name,
    seats: plan.seats,
    stripePriceId: price.priceId,
    pricingTier: price.tier,
    founderCountAtCheckout: price.founderCount,
    username,
    passwordHash,
    members,
    createdAt: new Date().toISOString(),
  };
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
  return json({
    url: session.url,
    sessionId: session.id,
    pricingTier: price.tier,
    founderSpotsUsed: price.founderCount,
    founderLimit: FOUNDER_LIMIT,
  }, 200, origin);
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
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifyWebhook(rawBody, header, secret) {
  const sig = parseStripeSignature(header);
  const timestamp = Number(sig.t);
  if (!timestamp || Math.abs(Date.now() / 1000 - timestamp) > 300) return false;
  const expected = await hmacHex(secret, `${sig.t}.${rawBody}`);
  return sig.v1.some((candidate) => constantTimeEqual(expected, candidate));
}

async function postDatabase(env, payload) {
  const url = required(env, "ALIGN_DB_URL");
  const secret = required(env, "ALIGN_DB_SECRET");
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...payload, mode: "ALIGN_PROD_2026", secret }),
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch (_) { data = { ok: false, error: text }; }
  if (!response.ok || !data?.ok) throw new Error(data?.error || "La base de ALIGN no confirmó la operación.");
  return data;
}

async function registerCheckout(env, session) {
  const draftId = clean(session.metadata?.align_draft_id || session.client_reference_id, 80);
  if (!draftId) throw new Error("Stripe no devolvió el identificador del registro.");
  const raw = await env.PAYMENT_STATE.get(`draft:${draftId}`);
  if (!raw) throw new Error("El registro previo al pago expiró o no existe.");
  const draft = JSON.parse(raw);

  await postDatabase(env, {
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
    members: draft.members,
  });
}

async function processEvent(env, event) {
  const object = event?.data?.object || {};
  switch (event.type) {
    case "checkout.session.completed":
      if (object.mode === "subscription" && ["paid", "no_payment_required"].includes(object.payment_status)) {
        await registerCheckout(env, object);
      }
      break;
    case "invoice.paid":
      await postDatabase(env, {
        action: "subscription_renewed",
        invoiceId: object.id || "",
        stripeCustomerId: object.customer || "",
        stripeSubscriptionId: object.subscription || object.parent?.subscription_details?.subscription || "",
        amount: Number(object.amount_paid || 0) / 100,
        currency: String(object.currency || "mxn").toUpperCase(),
      });
      break;
    case "invoice.payment_failed":
      await postDatabase(env, {
        action: "subscription_payment_failed",
        invoiceId: object.id || "",
        stripeCustomerId: object.customer || "",
        stripeSubscriptionId: object.subscription || object.parent?.subscription_details?.subscription || "",
      });
      break;
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await postDatabase(env, {
        action: "subscription_status",
        stripeCustomerId: object.customer || "",
        stripeSubscriptionId: object.id || "",
        status: object.status || (event.type.endsWith("deleted") ? "canceled" : "unknown"),
        cancelAtPeriodEnd: Boolean(object.cancel_at_period_end),
        currentPeriodEnd: object.current_period_end || null,
      });
      break;
    default:
      break;
  }
}

async function stripeWebhook(request, env) {
  if (!env.PAYMENT_STATE) throw new Error("Falta conectar el binding PAYMENT_STATE de Cloudflare KV.");
  const rawBody = await request.text();
  const secret = required(env, "STRIPE_WEBHOOK_SECRET");
  const valid = await verifyWebhook(rawBody, request.headers.get("stripe-signature"), secret);
  if (!valid) return new Response("Firma inválida.", { status: 400 });

  const event = JSON.parse(rawBody);
  const eventKey = `event:${event.id}`;
  if (await env.PAYMENT_STATE.get(eventKey)) return Response.json({ received: true, duplicate: true });

  await processEvent(env, event);
  await env.PAYMENT_STATE.put(eventKey, "1", { expirationTtl: 60 * 60 * 24 * 30 });
  return Response.json({ received: true });
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const origin = request.headers.get("origin") || "";
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
      if (url.pathname === "/api/health" && request.method === "GET") {
        return json({ ok: true, service: "ALIGN payments", founderLimit: FOUNDER_LIMIT }, 200, origin);
      }
      if (url.pathname === "/api/checkout" && request.method === "POST") return await createCheckout(request, env);
      if (url.pathname === "/api/stripe/webhook" && request.method === "POST") return await stripeWebhook(request, env);
      return json({ error: "Ruta no encontrada." }, 404, origin);
    } catch (error) {
      console.error("ALIGN payments worker", error);
      return json({ error: error?.message || "Error interno de pagos." }, 500, request.headers.get("origin") || "");
    }
  },
};
