import Stripe from "stripe";
import { membersFromMetadata, planFor } from "./_plans.mjs";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable ${name}.`);
  return value;
};

const siteOrigin = (request) => {
  const configured = process.env.MEMBER_BASE_URL?.trim();
  return (configured || new URL(request.url).origin).replace(/\/$/, "");
};

export default async (request) => {
  try {
    if (request.method !== "POST") return new Response("Método no permitido.", { status: 405 });
    const body = await request.json();
    const planKey = String(body.plan || "").toLowerCase();
    const plan = planFor(planKey);
    if (!plan) return new Response("Membresía no válida.", { status: 400 });

    const metadata = {
      align_membership: planKey,
      align_amount_mxn: String(plan.amount / 100),
      align_seats: String(plan.seats),
      checkout_version: "v3-community-plans",
    };
    (Array.isArray(body.members) ? body.members : []).forEach((member, index) => {
      const position = index + 1;
      metadata[`member_${position}_name`] = String(member.name || "").trim();
      metadata[`member_${position}_email`] = String(member.email || "").trim().toLowerCase();
      metadata[`member_${position}_phone`] = String(member.phone || "").replace(/[^0-9+]/g, "");
    });
    const members = membersFromMetadata(metadata, plan.seats);
    if (Array.isArray(body.members) && body.members.length !== plan.seats) {
      return new Response(`Este plan requiere ${plan.seats} integrante(s).`, { status: 400 });
    }

    const stripe = new Stripe(required("STRIPE_SECRET_KEY"));
    const origin = siteOrigin(request);
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{
        price_data: {
          currency: "mxn",
          unit_amount: plan.amount,
          recurring: { interval: "month" },
          product_data: {
            name: plan.name,
            description: `${plan.level} · Membresía mensual ALIGN COMMUNITY · IVA incluido`,
          },
        },
        quantity: 1,
      }],
      allow_promotion_codes: true,
      billing_address_collection: "auto",
      phone_number_collection: { enabled: true },
      customer_email: members[0].email,
      metadata,
      subscription_data: {
        metadata,
      },
      success_url: `${origin}/payment-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/#membresias`,
    });

    return Response.json({ url: session.url }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("checkout-v2", error);
    return new Response("No pudimos iniciar el pago.", { status: 500 });
  }
};
