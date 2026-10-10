import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripeMode, stripeSecret, stripeWebhookSecret, qrSigningSecret, subscriptionPeriod } from "../cloudflare/payments-worker/src/stripe-runtime.js";

const env = {
  STRIPE_MODE: "live",
  STRIPE_SECRET_KEY: "sk_test_example_not_real",
  STRIPE_SECRET_KEY_LIVE: "sk_live_example_not_real",
  STRIPE_WEBHOOK_SECRET: "whsec_test_example",
  STRIPE_WEBHOOK_SECRET_LIVE: "whsec_live_example",
};
const source = (name) => readFileSync(new URL(`../cloudflare/payments-worker/src/${name}`, import.meta.url), "utf8");

test("Live mode uses only Live Stripe credentials", () => {
  assert.equal(stripeMode(env), "live");
  assert.equal(stripeSecret(env), env.STRIPE_SECRET_KEY_LIVE);
  assert.equal(stripeWebhookSecret(env), env.STRIPE_WEBHOOK_SECRET_LIVE);
});

test("Test mode uses only test Stripe credentials", () => {
  const testEnv = { ...env, STRIPE_MODE: "test" };
  assert.equal(stripeMode(testEnv), "test");
  assert.equal(stripeSecret(testEnv), testEnv.STRIPE_SECRET_KEY);
  assert.equal(stripeWebhookSecret(testEnv), testEnv.STRIPE_WEBHOOK_SECRET);
});

test("Fail closed when the selected mode has no matching key", () => {
  assert.throws(() => stripeSecret({ ...env, STRIPE_SECRET_KEY_LIVE: "" }), /LIVE/);
  assert.throws(() => stripeSecret({ ...env, STRIPE_SECRET_KEY_LIVE: env.STRIPE_SECRET_KEY }), /LIVE/);
  assert.throws(() => stripeSecret({ ...env, STRIPE_MODE: "test", STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY_LIVE }), /TEST/);
  assert.throws(() => stripeWebhookSecret({ ...env, STRIPE_WEBHOOK_SECRET_LIVE: "" }), /webhook/);
});

test("QR signatures use a stable dedicated secret when configured", () => {
  const dedicated = { ...env, QR_SIGNING_SECRET: "qr-secret-kept-across-payment-key-rotation" };
  assert.equal(qrSigningSecret(dedicated), dedicated.QR_SIGNING_SECRET);
  assert.equal(qrSigningSecret({ ...dedicated, STRIPE_SECRET_KEY_LIVE: "sk_live_changed" }), dedicated.QR_SIGNING_SECRET);
});

test("QR signature fallback uses the active Stripe mode, never the other mode", () => {
  assert.equal(qrSigningSecret(env), env.STRIPE_SECRET_KEY_LIVE);
  assert.equal(qrSigningSecret({ ...env, STRIPE_MODE: "test" }), env.STRIPE_SECRET_KEY);
});

test("Current Stripe subscription item dates control the paid period", () => {
  const subscription = {
    items: { data: [{ current_period_start: 1790000000, current_period_end: 1792678400 }] },
  };
  assert.deepEqual(subscriptionPeriod(subscription), {
    validFrom: new Date(1790000000 * 1000).toISOString(),
    validUntil: new Date(1792678400 * 1000).toISOString(),
  });
});

test("Item dates take precedence over legacy root dates", () => {
  const subscription = {
    current_period_start: 1780000000,
    current_period_end: 1782678400,
    items: { data: [{ current_period_start: 1790000000, current_period_end: 1792678400 }] },
  };
  assert.equal(subscriptionPeriod(subscription).validFrom, new Date(1790000000 * 1000).toISOString());
});

test("Legacy subscription dates remain compatible", () => {
  const legacy = { current_period_start: 1790000000, current_period_end: 1792678400 };
  assert.equal(subscriptionPeriod(legacy).validUntil, new Date(1792678400 * 1000).toISOString());
});

test("Missing, incomplete or reversed periods do not extend a membership", () => {
  assert.equal(subscriptionPeriod(null), null);
  assert.equal(subscriptionPeriod({ items: { data: [{}] } }), null);
  assert.equal(subscriptionPeriod({ current_period_start: 1790000000, current_period_end: 1780000000 }), null);
  assert.equal(subscriptionPeriod({ current_period_start: 1780000000, current_period_end: 1792678400, items: { data: [{ current_period_start: 1790000000 }] } }), null);
});

test("Live billing, checkout, renewal and QR portals share the runtime", () => {
  for (const name of ["index.js", "entry.js", "entry-member-login.js", "entry-short-qr.js", "entry-visits.js", "main.js"]) {
    const content = source(name);
    assert.match(content, /from "\.\/stripe-runtime\.js"/, `${name} must use the shared Stripe runtime`);
  }
  for (const name of ["entry.js", "entry-member-login.js", "entry-short-qr.js", "entry-visits.js"]) {
    assert.doesNotMatch(source(name), /env\.STRIPE_SECRET_KEY\b/, `${name} must not silently reuse the test key in Live mode`);
  }
  assert.match(source("entry.js"), /const period = subscriptionPeriod\(subscription\);\s*if \(!period\) return null;/);
});
