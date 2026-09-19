import { json } from '../_shared/http.js';

export const onRequestGet = async ({ env }) => {
  let database = false;
  try {
    if (env.DB) {
      await env.DB.prepare('SELECT 1 AS ok').first();
      database = true;
    }
  } catch (_) {}
  return json({ ok: true, service: 'ALIGN Cloudflare API', database, paymentsMode: String(env.PAYMENTS_MODE || 'test') });
};
