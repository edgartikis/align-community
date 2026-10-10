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

// Migration is deliberately TWO STAGE. Adding QR_SIGNING_SECRET alone does
// not change existing QR signatures or ally sessions. After an approved deploy,
// operators enable QR_SIGNING_CUTOVER=true along with a limited legacy grace.
export function qrCutoverEnabled(env) {
  return String(env.QR_SIGNING_CUTOVER || "").trim().toLowerCase() === "true";
}

function legacyQrSigningSecret(env) {
  // The previously deployed short QR, member-validation and ally modules used
  // the un-suffixed Stripe key even with STRIPE_MODE=live. Retain its exact
  // signatures until the explicit cutover. Do not rotate that key mid-migration.
  const legacy = String(env.STRIPE_SECRET_KEY || "").trim();
  return /^(sk|rk)_(test|live)_/.test(legacy) ? legacy : stripeSecret(env);
}

export function qrSigningSecret(env) {
  if (!qrCutoverEnabled(env)) return legacyQrSigningSecret(env);
  const secret = String(env.QR_SIGNING_SECRET || "").trim();
  if (secret.length < 32) {
    throw new Error("QR_SIGNING_CUTOVER requiere QR_SIGNING_SECRET de al menos 32 caracteres.");
  }
  return secret;
}

// Legacy signatures are accepted only for a manually approved, expiring
// migration window. No grandfathered key can verify signatures indefinitely.
export function qrVerificationSecrets(env, now = Date.now()) {
  const primary = qrSigningSecret(env);
  const keys = [primary];
  if (!qrCutoverEnabled(env)) return keys;
  const until = Date.parse(String(env.QR_LEGACY_ACCEPT_UNTIL || ""));
  if (!Number.isFinite(until) || now >= until) return keys;

  // The previous deployed validator used the unsuffixed key; the earlier
  // checkout/QR variant could also use the active Stripe key.
  for (const secret of [String(env.STRIPE_SECRET_KEY || "").trim(), stripeSecret(env)]) {
    if (/^(sk|rk)_(test|live)_/.test(secret) && !keys.includes(secret)) keys.push(secret);
  }
  return keys;
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

async function signedHmacBase64url(secret, message) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

// Supports normal 43-character QR signatures and truncated 22-character
// short-code hashes. Membership, current cycle and 15-minute slot checks
// remain mandatory at call sites; a valid HMAC alone never authorizes access.
export async function verifyQrHmac(env, message, supplied, { short = false, now = Date.now() } = {}) {
  const value = String(supplied || "");
  const expectedLength = short ? 22 : 43;
  if (value.length !== expectedLength || !/^[A-Za-z0-9_-]+$/.test(value)) return false;
  let matched = false;
  for (const secret of qrVerificationSecrets(env, now)) {
    const digest = await signedHmacBase64url(secret, message);
    const signature = short ? digest.slice(0, 22) : digest;
    matched = constantTimeEqual(signature, value) || matched;
  }
  return matched;
}

export function subscriptionPeriod(subscription) {
  // Newer Stripe API versions expose the subscription cycle on its items.
  // Never invent a new paid period when Stripe did not provide valid dates.
  const item = subscription?.items?.data?.[0] || {};
  const hasItemPeriod = item.current_period_start != null || item.current_period_end != null;
  const start = Number(hasItemPeriod ? item.current_period_start : subscription?.current_period_start);
  const end = Number(hasItemPeriod ? item.current_period_end : subscription?.current_period_end);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start <= 0 || end <= start) return null;
  return { validFrom: new Date(start * 1000).toISOString(), validUntil: new Date(end * 1000).toISOString() };
}
