import Stripe from "stripe";
import { planFor } from "./_plans.mjs";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable ${name}.`);
  return value;
};

const allowedOrigins = new Set([
  "https://alignmembership.netlify.app",
  "https://aligncommunity.netlify.app",
  "https://edgartikis.github.io",
]);

const siteBase = (request, requestedBase) => {
  const cleanRequested = String(requestedBase || "").trim().replace(/\/$/, "");
  if (cleanRequested) {
    try {
      const parsed = new URL(cleanRequested);
      if (allowedOrigins.has(parsed.origin)) return cleanRequested;
    } catch (_) {}
  }
  const configured = process.env.MEMBER_BASE_URL?.trim().replace(/\/$/, "");
  if (configured) {
    try {
      const parsed = new URL(configured);
      if (allowedOrigins.has(parsed.origin)) return configured;
    } catch (_) {}
  }
  return new URL(request.url).origin.replace(/\/$/, "");
};

const corsHeaders = (request) => {
  const origin = request.headers.get("origin") || "";
  return {
    "access-control-allow-origin": allowedOrigins.has(origin) ? origin : "https://aligncommunity.netlify.app",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "vary": "Origin",
  };
};

const json = (request, body, status = 200) => Response.json(body, {
  status,
  headers: { ...corsHeaders(request), "cache-control": "no-store" },
});

const createTestSession = async ({ request, planKey, email, returnBase, paymentMethod }) => {
  const plan = planFor(planKey);
  if (!plan) throw new Error("Membresía no válida.");

  const secretKey = required("STRIPE_SECRET_KEY");
  if (/^sk_live_/i.test(secretKey) || /^rk_live_/i.test(secretKey)) {
    throw new Error("El pago de prueba está bloqueado porque Stripe está en modo real.");
  }
  if (!/^sk_test_/i.test(secretKey) && !/^rk_test_/i.test(secretKey)) {
    throw new Error("Stripe debe estar configurado con una clave TEST/Sandbox.");
  }

  const base = siteBase(request, returnBase);
  const successUrl = `${base}/pago.html?plan=${encodeURIComponent(planKey)}&sandbox=success&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${base}/pago.html?plan=${encodeURIComponent(planKey)}&sandbox=cancel`;
  const stripe = new Stripe(secretKey);

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    payment_method_types: ["card"],
    line_items: [{
      price_data: {
        currency: "mxn",
        unit_amount: plan.amount,
        recurring: { interval: "month" },
        product_data: {
          name: `${plan.name} · PRUEBA`,
          description: `${plan.level} · Apple Pay / Wallet Sandbox · No mueve dinero real`,
        },
      },
      quantity: 1,
    }],
    billing_address_collection: "auto",
    phone_number_collection: { enabled: true },
    ...(email ? { customer_email: email } : {}),
    metadata: {
      align_membership: planKey,
      align_amount_mxn: String(plan.amount / 100),
      align_seats: String(plan.seats),
      checkout_version: "v6-wallet-get-handoff",
      test_only: "true",
      requested_wallet: String(paymentMethod || "apple"),
    },
    subscription_data: {
      metadata: {
        align_membership: planKey,
        test_only: "true",
      },
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });

  return session;
};

export default async (request) => {
  try {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });

    if (request.method === "GET") {
      const url = new URL(request.url);
      const planKey = String(url.searchParams.get("plan") || "").toLowerCase();
      const email = String(url.searchParams.get("email") || "").trim().toLowerCase();
      const returnBase = url.searchParams.get("returnBase") || "";
      const paymentMethod = url.searchParams.get("paymentMethod") || "apple";
      const session = await createTestSession({ request, planKey, email, returnBase, paymentMethod });
      return Response.redirect(session.url, 303);
    }

    if (request.method !== "POST") return json(request, { error: "Método no permitido." }, 405);

    const body = await request.json();
    const planKey = String(body.plan || "").toLowerCase();
    const firstMember = Array.isArray(body.members) ? body.members[0] : null;
    const email = String(firstMember?.email || body.email || "").trim().toLowerCase();
    const returnBase = body.returnOrigin || body.returnBase || "";
    const paymentMethod = body.paymentMethod || "apple";
    const session = await createTestSession({ request, planKey, email, returnBase, paymentMethod });
    return json(request, { url: session.url, testMode: true });
  } catch (error) {
    console.error("checkout-v2", error);
    const message = error?.message || "No pudimos iniciar Apple Pay Sandbox.";
    const wantsHtml = request.method === "GET";
    if (wantsHtml) {
      const safe = String(message).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
      return new Response(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>ALIGN · Apple Pay TEST</title><body style="margin:0;background:#07111f;color:#f4f0e8;font-family:system-ui;display:grid;place-items:center;min-height:100vh"><main style="max-width:560px;padding:32px;text-align:center"><h1>Apple Pay TEST</h1><p>${safe}</p><p style="opacity:.7">No se realizó ningún cargo.</p><button onclick="history.back()" style="padding:12px 18px">Volver</button></main></body>`, { status: 503, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    }
    return json(request, { error: message }, 500);
  }
};
