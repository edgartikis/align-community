import Stripe from "stripe";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable ${name}.`);
  return value;
};

const baseUrl = () => required("MEMBER_BASE_URL").replace(/\/$/, "");

export default async (request) => {
  try {
    const url = new URL(request.url);
    const plan = (url.searchParams.get("plan") || "").toLowerCase();
    const priceId =
      plan === "black"
        ? required("STRIPE_BLACK_PRICE_ID")
        : plan === "society"
          ? required("STRIPE_SOCIETY_PRICE_ID")
          : "";

    if (!priceId) return new Response("Membresía no válida.", { status: 400 });

    const stripe = new Stripe(required("STRIPE_SECRET_KEY"));
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      billing_address_collection: "auto",
      customer_creation: "always",
      metadata: { align_membership: plan },
      subscription_data: { metadata: { align_membership: plan } },
      success_url: `${baseUrl()}/payment-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl()}/#membresias`,
    });

    return Response.redirect(session.url, 303);
  } catch (error) {
    console.error(error);
    return new Response("No pudimos iniciar el pago.", { status: 500 });
  }
};
