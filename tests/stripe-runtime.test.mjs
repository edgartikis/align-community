import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHmac, webcrypto } from "node:crypto";

globalThis.crypto ??= webcrypto;
import { stripeMode, stripeSecret, stripeWebhookSecret, qrSigningSecret, qrCutoverEnabled, qrVerificationSecrets, verifyQrHmac, subscriptionPeriod } from "../cloudflare/payments-worker/src/stripe-runtime.js";

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

const newQrKey = "align_64_random_characters_placeholder_but_not_an_actual_secret_ok12345";
const migrationNow = Date.parse("2026-10-10T13:00:00Z");
const migrationUntil = new Date(migrationNow + 13 * 60 * 60 * 1000).toISOString();
const stage = { ...env, QR_SIGNING_SECRET: newQrKey, QR_SIGNING_CUTOVER: "true", QR_LEGACY_ACCEPT_UNTIL: migrationUntil };
const mac = (key, value) => createHmac("sha256", key).update(value).digest("base64url");

test("Stage 1: adding new QR secret alone cannot change existing QR or ally signatures", () => {
  assert.equal(qrCutoverEnabled({ ...env, QR_SIGNING_SECRET: newQrKey }), false);
  assert.equal(qrSigningSecret({ ...env, QR_SIGNING_SECRET: newQrKey }), env.STRIPE_SECRET_KEY);
  assert.equal(qrSigningSecret(env), env.STRIPE_SECRET_KEY);
  assert.deepEqual(qrVerificationSecrets({ ...env, QR_SIGNING_SECRET: newQrKey }), [env.STRIPE_SECRET_KEY]);
});

test("Stage 2: QR cutover signs with new dedicated secret and resists Stripe key rotation", () => {
  assert.equal(qrCutoverEnabled(stage), true);
  assert.equal(qrSigningSecret(stage), newQrKey);
  assert.equal(qrSigningSecret({ ...stage, STRIPE_SECRET_KEY_LIVE: "sk_live_changed" }), newQrKey);
});

test("Fail closed if cutover is enabled before configuring a sufficiently long secret", () => {
  assert.throws(() => qrSigningSecret({ ...stage, QR_SIGNING_SECRET: "" }), /requiere/);
  assert.throws(() => qrSigningSecret({ ...stage, QR_SIGNING_SECRET: "short" }), /requiere/);
});

test("Legacy test and Live QR signatures verify ONLY inside the grace period", async () => {
  const message = "memberToken:2026-10-10T00:00:00Z|2026-11-10T00:00:00Z:123456";
  assert.equal(await verifyQrHmac(stage, message, mac(env.STRIPE_SECRET_KEY, message), { now: migrationNow }), true);
  assert.equal(await verifyQrHmac(stage, message, mac(env.STRIPE_SECRET_KEY_LIVE, message), { now: migrationNow }), true);
  assert.equal(await verifyQrHmac(stage, message, mac(newQrKey, message), { now: migrationNow }), true);
  assert.equal(await verifyQrHmac(stage, message, mac(env.STRIPE_SECRET_KEY, message), { now: migrationNow + 13 * 60 * 60 * 1000 }), false);
  assert.equal(await verifyQrHmac(stage, message, mac(env.STRIPE_SECRET_KEY_LIVE, message), { now: migrationNow + 13 * 60 * 60 * 1000 }), false);
  assert.equal(await verifyQrHmac(stage, message, mac(newQrKey, message), { now: migrationNow + 13 * 60 * 60 * 1000 }), true);
  assert.equal(await verifyQrHmac({ ...stage, QR_LEGACY_ACCEPT_UNTIL: "" }, message, mac(env.STRIPE_SECRET_KEY, message), { now: migrationNow }), false);
});

test("Short QR links, long QR links and ally sessions can migrate without new logins", async () => {
  const shortMessage = "short:token:2026-10-10|2026-11-10:12345";
  const sessionMessage = "ally-session:opaque_encoded_payload";
  const qrMessage = "token:2026-10-10|2026-11-10:12345";
  assert.equal(await verifyQrHmac(stage, shortMessage, mac(env.STRIPE_SECRET_KEY, shortMessage).slice(0, 22), { short: true, now: migrationNow }), true);
  assert.equal(await verifyQrHmac(stage, sessionMessage, mac(env.STRIPE_SECRET_KEY, sessionMessage), { now: migrationNow }), true);
  assert.equal(await verifyQrHmac(stage, qrMessage, mac(env.STRIPE_SECRET_KEY, qrMessage), { now: migrationNow }), true);
  assert.equal(await verifyQrHmac(stage, qrMessage, mac(env.STRIPE_SECRET_KEY, qrMessage).slice(1), { now: migrationNow }), false);
  assert.equal(await verifyQrHmac(stage, qrMessage, mac(env.STRIPE_SECRET_KEY, qrMessage), { now: migrationNow + 13 * 60 * 60 * 1000 }), false);
});

test("Invalid or changed QR payload and tampered ally sessions never validate", async () => {
  const message = "ally-session:payload";
  const oldSignature = mac(env.STRIPE_SECRET_KEY, message);
  assert.equal(await verifyQrHmac(stage, message + "-edited", oldSignature, { now: migrationNow }), false);
  assert.equal(await verifyQrHmac(stage, message, mac("unknown_key", message), { now: migrationNow }), false);
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
  for (const name of ["entry.js", "entry-visits.js", "entry-short-qr.js", "index.js"]) {
    assert.match(source(name), /verifyQrHmac/, `${name} must validate old and new QR signatures`);
  }
});
