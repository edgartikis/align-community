import Stripe from "stripe";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable ${name}.`);
  return value;
};

const PLANS = Object.freeze({
  society: { level: "Society", name: "ALIGN Society", amount: 24900 },
  black: { level: "Black", name: "ALIGN Black", amount: 49900 },
});

const siteOrigin = (request) => {
  const configured = process.env.MEMBER_BASE_URL?.trim();
  return (configured || new URL(request.url).origin).replace(/\/$/, "");
};

export default async (request) => {
  try {
    const planKey = (new URL(request.url).searchParams.get("plan") || "").toLowerCase();
    const plan = PLANS[planKey];
    if (!plan) return new Response("Membresía no válida.", { status: 400 });

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
      metadata: {
        align_membership: planKey,
        align_amount_mxn: String(plan.amount / 100),
        checkout_version: "v2-249-499",
      },
      subscription_data: {
        metadata: {
          align_membership: planKey,
          align_amount_mxn: String(plan.amount / 100),
          checkout_version: "v2-249-499",
        },
      },
      success_url: `${origin}/payment-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/#membresias`,
    });

    return Response.redirect(session.url, 303);
  } catch (error) {
    console.error("checkout-v2", error);
    return new Response("No pudimos iniciar el pago.", { status: 500 });
  }
};
