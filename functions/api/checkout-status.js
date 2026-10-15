import { json } from '../_shared/http.js';
import { stripeFor } from '../_shared/stripe.js';

export const onRequestGet = async ({ request, env }) => {
  try {
    if (!env.DB) return json({ error: 'D1 no configurado.' }, 503);
    const sessionId = String(new URL(request.url).searchParams.get('session_id') || '').trim();
    if (!/^cs_(test_|live_)?[A-Za-z0-9_]+$/.test(sessionId)) return json({ error: 'Sesión no válida.' }, 400);

    const pending = await env.DB.prepare('SELECT id, level, status FROM pending_registrations WHERE stripe_session_id = ? LIMIT 1').bind(sessionId).first();
    if (!pending) return json({ error: 'Registro no encontrado.' }, 404);

    if (pending.status === 'consumed') {
      const payment = await env.DB.prepare('SELECT group_id FROM payments WHERE stripe_checkout_session_id = ? LIMIT 1').bind(sessionId).first();
      if (!payment) return json({ pending: true }, 202);
      const group = await env.DB.prepare('SELECT level, status FROM membership_groups WHERE id = ? LIMIT 1').bind(payment.group_id).first();
      const rows = await env.DB.prepare('SELECT name, token, member_code FROM members WHERE group_id = ? ORDER BY position').bind(payment.group_id).all();
      return json({ ready: true, level: group?.level || pending.level, membershipStatus: group?.status || 'active', members: (rows.results || []).map(row => ({ name: row.name, token: row.token, memberCode: row.member_code })) });
    }

    const { stripe } = stripeFor(env);
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.mode !== 'subscription' || !['paid', 'no_payment_required'].includes(session.payment_status)) return json({ pending: true, paymentStatus: session.payment_status }, 202);

    return json({ pending: true, paymentStatus: session.payment_status, message: 'Pago confirmado. Esperando activación segura por webhook.' }, 202);
  } catch (error) {
    console.error('checkout-status', error);
    return json({ error: 'No pudimos consultar el estado del pago.' }, 500);
  }
};
