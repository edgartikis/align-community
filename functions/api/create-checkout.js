import { planFor } from '../_shared/plans.js';
import { cleanEmail, cleanPhone, cleanText, json, requirePost, sameOriginOnly } from '../_shared/http.js';
import { hashPassword } from '../_shared/security.js';
import { stripeFor } from '../_shared/stripe.js';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

const normalizeMembers = (input, seats) => {
  if (!Array.isArray(input) || input.length !== seats) throw fail(`Este plan requiere ${seats} integrante(s).`);
  return input.map((item, index) => {
    const name = cleanText(item?.name, 100);
    const email = cleanEmail(item?.email);
    const phone = cleanPhone(item?.phone);
    if (!name || !/^\S+@\S+\.\S+$/.test(email) || phone.length < 8) throw fail(`Revisa los datos del integrante ${index + 1}.`);
    return { name, email, phone };
  });
};

const founderPricing = async (env, plan) => {
  if (!plan.founderEligible) return { founderRate: false, amount: plan.regularAmount };
  const row = await env.DB.prepare('SELECT COUNT(*) AS total FROM membership_groups WHERE founder_rate = 1').first();
  const total = Number(row?.total || 0);
  return total < 150
    ? { founderRate: true, amount: plan.founderAmount }
    : { founderRate: false, amount: plan.regularAmount };
};

export const onRequestPost = async ({ request, env }) => {
  try {
    requirePost(request);
    sameOriginOnly(request);
    if (!env.DB) throw fail('La base D1 todavía no está conectada.', 503);

    const body = await request.json();
    const planKey = String(body?.plan || '').trim().toLowerCase();
    const plan = planFor(planKey);
    if (!plan) throw fail('Membresía no válida.');

    const username = cleanText(body?.account?.username, 24).toLowerCase();
    const password = String(body?.account?.password || '');
    if (!/^[a-z0-9._]{4,24}$/.test(username)) throw fail('El usuario debe tener de 4 a 24 caracteres y usar letras, números, punto o guion bajo.');
    if (password.length < 8 || !/[a-záéíóúñ]/i.test(password) || !/\d/.test(password)) throw fail('La contraseña debe tener mínimo 8 caracteres, una letra y un número.');

    const members = normalizeMembers(body?.members, plan.seats);
    const existingUser = await env.DB.prepare('SELECT id FROM accounts WHERE username = ? COLLATE NOCASE LIMIT 1').bind(username).first();
    if (existingUser) throw fail('Ese nombre de usuario ya está registrado.', 409);
    for (const member of members) {
      const existingEmail = await env.DB.prepare('SELECT id FROM members WHERE email = ? COLLATE NOCASE LIMIT 1').bind(member.email).first();
      if (existingEmail) throw fail(`Ya existe una membresía asociada a ${member.email}.`, 409);
    }

    const pricing = await founderPricing(env, plan);
    const { salt, hash } = hashPassword(password);
    const registrationId = `reg_${crypto.randomUUID()}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();

    await env.DB.prepare(`INSERT INTO pending_registrations
      (id, plan_key, level, seats, founder_rate, amount_cents, username, password_salt, password_hash, members_json, status, created_at, updated_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'created', ?, ?, ?)`)
      .bind(registrationId, planKey, plan.level, plan.seats, pricing.founderRate ? 1 : 0, pricing.amount, username, salt, hash, JSON.stringify(members), now.toISOString(), now.toISOString(), expiresAt)
      .run();

    const { stripe, mode } = stripeFor(env);
    const origin = new URL(request.url).origin;
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'mxn',
          unit_amount: pricing.amount,
          recurring: { interval: 'month' },
          product_data: {
            name: plan.name,
            description: pricing.founderRate ? 'Tarifa Fundador ALIGN' : `${plan.seats} integrante(s)`,
          },
        },
        quantity: 1,
      }],
      customer_email: members[0].email,
      client_reference_id: registrationId,
      metadata: {
        registration_id: registrationId,
        align_membership: planKey,
        founder_rate: pricing.founderRate ? 'true' : 'false',
      },
      subscription_data: {
        metadata: {
          registration_id: registrationId,
          align_membership: planKey,
          founder_rate: pricing.founderRate ? 'true' : 'false',
        },
      },
      success_url: `${origin}/payment-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/pago.html?plan=${encodeURIComponent(planKey)}&cancel=1`,
    });

    await env.DB.prepare("UPDATE pending_registrations SET stripe_session_id = ?, status = 'checkout_created', updated_at = ? WHERE id = ?")
      .bind(session.id, new Date().toISOString(), registrationId)
      .run();

    return json({ ok: true, url: session.url, mode, founderRate: pricing.founderRate, amountCents: pricing.amount });
  } catch (error) {
    console.error('create-checkout', error);
    return json({ error: error?.message || 'No pudimos iniciar el pago.' }, Number(error?.status || 500));
  }
};
