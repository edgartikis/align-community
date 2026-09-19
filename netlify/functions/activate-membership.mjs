import Stripe from "stripe";
import { registerSessionMembers } from "./_register-members.mjs";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable ${name}.`);
  return value;
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const siteOrigin = (request) => (process.env.MEMBER_BASE_URL?.trim() || new URL(request.url).origin).replace(/\/$/, "");

export default async (request) => {
  try {
    const sessionId = new URL(request.url).searchParams.get("session_id");
    if (!sessionId || !/^cs_(test_|live_)?[A-Za-z0-9_]+$/.test(sessionId)) return json({ error: "Sesión no válida." }, 400);
    const stripe = new Stripe(required("STRIPE_SECRET_KEY"));
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.mode !== "subscription" || !["paid", "no_payment_required"].includes(session.payment_status)) return json({ pending: true }, 202);
    const members = await registerSessionMembers(session, siteOrigin(request));
    return json({ level: members[0].level, members, memberUrl: members[0].memberUrl });
  } catch (error) {
    console.error("activate-membership", error);
    return json({ error: "No pudimos activar la membresía." }, 500);
  }
};
