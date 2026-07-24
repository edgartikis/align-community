import Stripe from "stripe";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable ${name}.`);
  return value;
};

const siteOrigin = (request) => {
  const requestUrl = new URL(request.url);
  const configured = process.env.MEMBER_BASE_URL?.trim();
  return (configured || requestUrl.origin).replace(/\/$/, "");
};

const plans = {
  society: {
    name: "ALIGN Society",
    amount: 24900,
  },
  black: {
    name: "ALIGN Black",
    amount: 49900,
  },
};

export default async (request) => {
  try {
    const url = new URL(request.url);
    const plan = (url.searchParams.get("plan") || "").toLowerCase();
    const selectedPlan = plans[plan];

    if (!selectedPlan) {
      return new Response("Membresía no válida.", { status: 400 });
    }

    const stripe = new Stripe(required("STRIPE_SECRET_KEY"));
    const origin = siteOrigin(request);
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [
        {
          price_data: {
            currency: "mxn",
            unit_amount: selectedPlan.amount,
            recurring: { interval: "month" },
            product_data: {
              name: selectedPlan.name,
              description: "Membresía mensual ALIGN COMMUNITY · IVA incluido",
            },
          },
          quantity: 1,
        },
      ],
      allow_promotion_codes: true,
      billing_address_collection: "auto",
      phone_number_collection: { enabled: true },
      metadata: { align_membership: plan },
      subscription_data: { metadata: { align_membership: plan } },
      success_url: `${origin}/payment-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/#membresias`,
    });

    return Response.redirect(session.url, 303);
  } catch (error) {
    console.error(error);
    return new Response("No pudimos iniciar el pago.", { status: 500 });
  }
};