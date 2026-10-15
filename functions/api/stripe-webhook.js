import { memberCode, randomToken } from '../_shared/security.js';
import { isoFromUnix } from '../_shared/http.js';
import { planFor } from '../_shared/plans.js';
import { stripeFor } from '../_shared/stripe.js';

const membershipStatus = stripeStatus => {
  if (['active', 'trialing'].includes(stripeStatus)) return 'active';
  if (['past_due', 'unpaid'].includes(stripeStatus)) return 'past_due';
  if (['canceled', 'incomplete_expired', 'paused'].includes(stripeStatus)) return 'inactive';
  return 'pending';
};

const findGroupBySubscription = (env, subscriptionId) => env.DB.prepare('SELECT * FROM membership_groups WHERE stripe_subscription_id = ? LIMIT 1').bind(String(subscriptionId || '')).first();

const activateCheckout = async (env, stripe, session) => {
  if (session.mode !== 'subscription' || !['paid', 'no_payment_required'].includes(session.payment_status)) return;
  const registrationId = String(session.metadata?.registration_id || session.client_reference_id || '');
  if (!registrationId) throw new Error('Checkout sin registration_id.');
  const pending = await env.DB.prepare('SELECT * FROM pending_registrations WHERE id = ? LIMIT 1').bind(registrationId).first();
  if (!pending) throw new Error('Registro pendiente no encontrado.');
  if (pending.status === 'consumed') return;

  const plan = planFor(pending.plan_key);
  if (!plan) throw new Error('Plan desconocido en registro pendiente.');
  const members = JSON.parse(pending.members_json || '[]');
  if (!Array.isArray(members) || members.length !== Number(pending.seats)) throw new Error('Integrantes inválidos en registro pendiente.');

  let subscription = null;
  if (session.subscription) subscription = await stripe.subscriptions.retrieve(String(session.subscription));
  const now = new Date().toISOString();
  const groupId = `grp_${crypto.randomUUID()}`;
  const accountId = `acct_${crypto.randomUUID()}`;

  const statements = [
    env.DB.prepare(`INSERT INTO membership_groups
      (id, plan_key, level, status, founder_rate, monthly_amount_cents, stripe_customer_id, stripe_subscription_id, current_period_end, cancel_at_period_end, created_at, updated_at)
      VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(groupId, pending.plan_key, pending.level, Number(pending.founder_rate || 0), Number(pending.amount_cents), String(session.customer || ''), String(session.subscription || ''), isoFromUnix(subscription?.current_period_end), subscription?.cancel_at_period_end ? 1 : 0, now, now),
    env.DB.prepare(`INSERT INTO accounts (id, group_id, username, password_salt, password_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(accountId, groupId, pending.username, pending.password_salt, pending.password_hash, now, now),
  ];

  members.forEach((person, index) => {
    statements.push(env.DB.prepare(`INSERT INTO members
      (id, group_id, position, member_code, token, name, email, phone, status, joined_at, photo_url, savings_cents)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Activa', ?, '', 0)`)
      .bind(`mem_${crypto.randomUUID()}`, groupId, index + 1, memberCode(plan.prefix), randomToken(), person.name, person.email, person.phone, now));
  });

  statements.push(env.DB.prepare(`INSERT OR IGNORE INTO payments
    (id, group_id, stripe_checkout_session_id, amount_cents, currency, status, paid_at, created_at)
    VALUES (?, ?, ?, ?, ?, 'paid', ?, ?)`)
    .bind(`pay_${crypto.randomUUID()}`, groupId, session.id, Number(session.amount_total || pending.amount_cents || 0), String(session.currency || 'mxn'), now, now));
  statements.push(env.DB.prepare("UPDATE pending_registrations SET status = 'consumed', updated_at = ? WHERE id = ?").bind(now, registrationId));

  await env.DB.batch(statements);
};

const invoicePaid = async (env, invoice) => {
  const group = await findGroupBySubscription(env, invoice.subscription);
  if (!group) return;
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE membership_groups SET status = 'active', current_period_end = COALESCE(?, current_period_end), updated_at = ? WHERE id = ?")
      .bind(isoFromUnix(invoice.period_end), now, group.id),
    env.DB.prepare(`INSERT OR IGNORE INTO payments
      (id, group_id, stripe_invoice_id, amount_cents, currency, status, paid_at, created_at)
      VALUES (?, ?, ?, ?, ?, 'paid', ?, ?)`)
      .bind(`pay_${crypto.randomUUID()}`, group.id, invoice.id, Number(invoice.amount_paid || 0), String(invoice.currency || 'mxn'), now, now),
  ]);
};

const syncSubscription = async (env, subscription, forcedStatus = null) => {
  const group = await findGroupBySubscription(env, subscription.id);
  if (!group) return;
  const now = new Date().toISOString();
  const status = forcedStatus || membershipStatus(subscription.status);
  await env.DB.prepare(`UPDATE membership_groups
    SET status = ?, current_period_end = ?, cancel_at_period_end = ?, updated_at = ? WHERE id = ?`)
    .bind(status, isoFromUnix(subscription.current_period_end), subscription.cancel_at_period_end ? 1 : 0, now, group.id)
    .run();
  await env.DB.prepare("UPDATE members SET status = ? WHERE group_id = ?")
    .bind(status === 'active' || status === 'past_due' ? 'Activa' : 'Inactiva', group.id)
    .run();
};

export const onRequestPost = async ({ request, env }) => {
  try {
    if (!env.DB) return new Response('D1 no configurado.', { status: 503 });
    const { stripe } = stripeFor(env);
    const signature = request.headers.get('stripe-signature');
    if (!signature) return new Response('Firma Stripe ausente.', { status: 400 });
    const raw = await request.text();
    const webhookSecret = String(env.STRIPE_WEBHOOK_SECRET || '').trim();
    if (!webhookSecret) throw new Error('Falta STRIPE_WEBHOOK_SECRET.');
    const event = stripe.webhooks.constructEvent(raw, signature, webhookSecret);

    const already = await env.DB.prepare('SELECT stripe_event_id FROM webhook_events WHERE stripe_event_id = ? LIMIT 1').bind(event.id).first();
    if (already) return Response.json({ received: true, duplicate: true });

    if (event.type === 'checkout.session.completed') await activateCheckout(env, stripe, event.data.object);
    else if (event.type === 'checkout.session.expired') {
      const registrationId = String(event.data.object?.metadata?.registration_id || event.data.object?.client_reference_id || '');
      if (registrationId) await env.DB.prepare("UPDATE pending_registrations SET status = 'expired', updated_at = ? WHERE id = ? AND status != 'consumed'").bind(new Date().toISOString(), registrationId).run();
    }
    else if (event.type === 'invoice.paid') await invoicePaid(env, event.data.object);
    else if (event.type === 'invoice.payment_failed') {
      const group = await findGroupBySubscription(env, event.data.object?.subscription);
      if (group) await env.DB.prepare("UPDATE membership_groups SET status = 'past_due', updated_at = ? WHERE id = ?").bind(new Date().toISOString(), group.id).run();
    }
    else if (event.type === 'customer.subscription.updated') await syncSubscription(env, event.data.object);
    else if (event.type === 'customer.subscription.deleted') await syncSubscription(env, event.data.object, 'inactive');

    await env.DB.prepare('INSERT INTO webhook_events (stripe_event_id, event_type, processed_at) VALUES (?, ?, ?)')
      .bind(event.id, event.type, new Date().toISOString())
      .run();
    return Response.json({ received: true });
  } catch (error) {
    console.error('stripe-webhook', error);
    return new Response('Webhook no procesado.', { status: 400 });
  }
};
