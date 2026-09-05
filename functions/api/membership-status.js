import { json } from '../_shared/http.js';

export const onRequestGet = async ({ request, env }) => {
  try {
    if (!env.DB) return json({ error: 'D1 no configurado.' }, 503);
    const token = String(new URL(request.url).searchParams.get('token') || '').trim();
    if (!token) return json({ error: 'Token requerido.' }, 400);
    const row = await env.DB.prepare(`SELECT m.member_code, m.name, m.status AS card_status, m.photo_url,
      g.plan_key, g.level, g.status AS membership_status, g.current_period_end, g.cancel_at_period_end
      FROM members m JOIN membership_groups g ON g.id = m.group_id WHERE m.token = ? LIMIT 1`).bind(token).first();
    if (!row) return json({ error: 'Membresía no encontrada.' }, 404);
    return json({ ok: true, memberCode: row.member_code, name: row.name, cardStatus: row.card_status, planKey: row.plan_key, planName: row.level, membershipStatus: row.membership_status, currentPeriodEnd: row.current_period_end, cancelAtPeriodEnd: Boolean(row.cancel_at_period_end), photoUrl: row.photo_url });
  } catch (error) {
    console.error('membership-status', error);
    return json({ error: 'No pudimos consultar la membresía.' }, 500);
  }
};
