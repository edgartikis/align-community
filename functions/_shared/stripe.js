import Stripe from 'stripe';

export const stripeFor = env => {
  const key = String(env.STRIPE_SECRET_KEY || '').trim();
  if (!key) throw new Error('Falta STRIPE_SECRET_KEY.');
  const mode = String(env.PAYMENTS_MODE || 'test').trim().toLowerCase();
  if (mode === 'live' && !/^sk_live_|^rk_live_/i.test(key)) throw new Error('PAYMENTS_MODE=live requiere una clave Stripe LIVE.');
  if (mode !== 'live' && /^sk_live_|^rk_live_/i.test(key)) throw new Error('Stripe LIVE está bloqueado mientras PAYMENTS_MODE no sea live.');
  return { stripe: new Stripe(key), mode };
};
