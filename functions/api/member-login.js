import { cleanText, json, sameOriginOnly } from '../_shared/http.js';
import { verifyPassword } from '../_shared/security.js';

export const onRequestPost = async ({ request, env }) => {
  try {
    sameOriginOnly(request);
    if (!env.DB) return json({ error: 'La base de miembros todavía no está conectada.' }, 503);
    const body = await request.json();
    const username = cleanText(body?.username, 24).toLowerCase();
    const password = String(body?.password || '');
    if (!username || !password) return json({ error: 'Escribe usuario y contraseña.' }, 400);

    const account = await env.DB.prepare(`SELECT a.id, a.group_id, a.password_salt, a.password_hash,
      g.plan_key, g.level, g.status, g.current_period_end, g.cancel_at_period_end
      FROM accounts a JOIN membership_groups g ON g.id = a.group_id
      WHERE a.username = ? COLLATE NOCASE LIMIT 1`).bind(username).first();
    if (!account || !verifyPassword(password, account.password_salt, account.password_hash)) return json({ error: 'Usuario o contraseña incorrectos.' }, 401);

    const result = await env.DB.prepare(`SELECT id, token, member_code, name, email, phone, status, joined_at, photo_url, savings_cents, position
      FROM members WHERE group_id = ? ORDER BY position`).bind(account.group_id).all();
    const cards = (result.results || []).map(row => ({
      id: row.id,
      token: row.token,
      memberCode: row.member_code,
      name: row.name,
      email: row.email,
      phone: row.phone,
      status: row.status,
      joinedAt: row.joined_at,
      photoUrl: row.photo_url,
      savings: Number(row.savings_cents || 0) / 100,
      position: Number(row.position || 1),
      level: account.level,
      planKey: account.plan_key,
      groupId: account.group_id,
    }));

    return json({ ok: true, username, groupId: account.group_id, planKey: account.plan_key, planName: account.level, membershipStatus: account.status, currentPeriodEnd: account.current_period_end, cancelAtPeriodEnd: Boolean(account.cancel_at_period_end), cards });
  } catch (error) {
    console.error('member-login', error);
    return json({ error: 'No pudimos iniciar sesión.' }, 500);
  }
};
