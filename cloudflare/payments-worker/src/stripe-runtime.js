// Shared Stripe configuration for checkout, member billing, QR validation and renewals.
// Keep signing credentials in Cloudflare secrets; never commit real secret values.
export function stripeMode(env) {
  return String(env.STRIPE_MODE || "test").trim().toLowerCase() === "live" ? "live" : "test";
}

export function stripeSecret(env) {
  const mode = stripeMode(env);
  const name = mode === "live" ? "STRIPE_SECRET_KEY_LIVE" : "STRIPE_SECRET_KEY";
  const key = String(env[name] || "").trim();
  const expected = mode === "live" ? /^(sk|rk)_live_/ : /^(sk|rk)_test_/;
  if (!expected.test(key)) {
    throw new Error(`La clave privada de Stripe no corresponde al modo ${mode.toUpperCase()}.`);
  }
  return key;
}

export function stripeWebhookSecret(env) {
  const name = stripeMode(env) === "live" ? "STRIPE_WEBHOOK_SECRET_LIVE" : "STRIPE_WEBHOOK_SECRET";
  const secret = String(env[name] || "").trim();
  if (!/^whsec_/.test(secret)) throw new Error("La firma del webhook de Stripe no está configurada.");
  return secret;
}

export function qrSigningSecret(env) {
  // A dedicated secret keeps member QR codes and ally sessions stable across
  // Stripe key rotations and prevents test/live signing-key confusion.
  const signingSecret = String(env.QR_SIGNING_SECRET || "").trim();
  return signingSecret || stripeSecret(env);
}

export function subscriptionPeriod(subscription) {
  // Newer Stripe API versions expose the subscription cycle on its items.
  // Never invent a new paid period when Stripe did not provide valid dates.
  const item = subscription?.items?.data?.[0] || {};
  const start = Number(item.current_period_start || subscription?.current_period_start || 0);
  const end = Number(item.current_period_end || subscription?.current_period_end || 0);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start <= 0 || end <= start) return null;
  return { validFrom: new Date(start * 1000).toISOString(), validUntil: new Date(end * 1000).toISOString() };
}
