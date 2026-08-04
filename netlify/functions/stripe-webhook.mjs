import Stripe from "stripe";
import { registerSessionMembers } from "./_register-members.mjs";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable ${name}.`);
  return value;
};

export default async (request) => {
  try {
    const stripe = new Stripe(required("STRIPE_SECRET_KEY"));
    const signature = request.headers.get("stripe-signature");
    if (!signature) return new Response("Firma de Stripe ausente.", { status: 400 });
    const event = stripe.webhooks.constructEvent(await request.text(), signature, required("STRIPE_WEBHOOK_SECRET"));
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      if (session.mode === "subscription" && ["paid", "no_payment_required"].includes(session.payment_status)) {
        await registerSessionMembers(session, required("MEMBER_BASE_URL").replace(/\/$/, ""));
      }
    }
    return Response.json({ received: true });
  } catch (error) {
    console.error("stripe-webhook", error);
    return new Response("Webhook no procesado.", { status: 400 });
  }
};
