import Stripe from "stripe";
import { membersFromMetadata, planFor } from "./_plans.mjs";

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
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "vary": "Origin",
  };
};

const json = (request, body, status = 200) => Response.json(body, {
  status,
  headers: { ...corsHeaders(request), "cache-control": "no-store" },
});

export default async (request) => {
  try {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
    if (request.method !== "POST") return json(request, { error: "Método no permitido." }, 405);

    const body = await request.json();
    const planKey = String(body.plan || "").toLowerCase();
    const plan = planFor(planKey);
    if (!plan) return json(request, { error: "Membresía no válida." }, 400);

    const secretKey = required("STRIPE_SECRET_KEY");
    if (/^sk_live_/i.test(secretKey) || /^rk_live_/i.test(secretKey)) {
      return json(request, { error: "El pago de prueba está bloqueado porque Stripe está en modo real. Configura una clave TEST/Sandbox." }, 503);
    }

    const metadata = {
      align_membership: planKey,
      align_amount_mxn: String(plan.amount / 100),
      align_seats: String(plan.seats),
      checkout_version: "v5-wallet-sandbox",
      test_only: "true",
      requested_wallet: String(body.paymentMethod || "wallet"),
    };

    (Array.isArray(body.members) ? body.members : []).forEach((member, index) => {
      const position = index + 1;
      metadata[`member_${position}_name`] = String(member.name || "").trim();
      metadata[`member_${position}_email`] = String(member.email || "").trim().toLowerCase();
      metadata[`member_${position}_phone`] = String(member.phone || "").replace(/[^0-9+]/g, "");
    });

    const members = membersFromMetadata(metadata, plan.seats);
    if (Array.isArray(body.members) && body.members.length !== plan.seats) {
      return json(request, { error: `Este plan requiere ${plan.seats} integrante(s).` }, 400);
    }

    const stripe = new Stripe(secretKey);
    const base = siteBase(request, body.returnOrigin);
    const successUrl = `${base}/pago.html?plan=${encodeURIComponent(planKey)}&sandbox=success&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${base}/pago.html?plan=${encodeURIComponent(planKey)}&sandbox=cancel`;

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
            description: `${plan.level} · Wallet Sandbox · No mueve dinero real`,
          },
        },
        quantity: 1,
      }],
      billing_address_collection: "auto",
      phone_number_collection: { enabled: true },
      customer_email: members[0].email,
      metadata,
      subscription_data: { metadata },
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    return json(request, { url: session.url, testMode: true });
  } catch (error) {
    console.error("checkout-v2", error);
    return json(request, { error: "No pudimos iniciar el pago Wallet Sandbox." }, 500);
  }
};