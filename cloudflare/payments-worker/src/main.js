import apiWorker from "./entry-member-login.js";

const BACKEND_VERSION = "2026-09-14-ally-auth-v2";

const PRICE_ENV_NAMES = [
  "STRIPE_PRICE_BROTHERHOOD_FOUNDER",
  "STRIPE_PRICE_BROTHERHOOD_REGULAR",
  "STRIPE_PRICE_GIRLS_FOUNDER",
  "STRIPE_PRICE_GIRLS_REGULAR",
  "STRIPE_PRICE_RANCH_FOUNDER",
  "STRIPE_PRICE_RANCH_REGULAR",
  "STRIPE_PRICE_DUO",
  "STRIPE_PRICE_CIRCLE",
];

function requestedStripeMode(env) {
  return String(env.STRIPE_MODE || "test").trim().toLowerCase() === "live" ? "live" : "test";
}

function stripeReadiness(env) {
  const mode = requestedStripeMode(env);
  const live = mode === "live";
  const key = String(env[live ? "STRIPE_SECRET_KEY_LIVE" : "STRIPE_SECRET_KEY"] || "").trim();
  const webhook = String(env[live ? "STRIPE_WEBHOOK_SECRET_LIVE" : "STRIPE_WEBHOOK_SECRET"] || "").trim();
  const keyReady = live ? /^(sk|rk)_live_/.test(key) : /^(sk|rk)_test_/.test(key);
  const webhookReady = /^whsec_/.test(webhook);
  const suffix = live ? "_LIVE" : "";
  const pricesReady = PRICE_ENV_NAMES.every((name) => /^price_/.test(String(env[`${name}${suffix}`] || "").trim()));
  return { mode, keyReady, webhookReady, pricesReady };
}

function health(request, env) {
  const origin = request.headers.get("origin") || "";
  const allowedOrigins = new Set([
    "https://alignmembers.com.mx",
    "https://www.alignmembers.com.mx",
    "https://edgartikis.github.io",
  ]);
  const allowOrigin = allowedOrigins.has(origin) ? origin : "https://alignmembers.com.mx";
  const storageReady = Boolean(env.PAYMENT_STATE);
  const stripe = stripeReadiness(env);
  const ready = storageReady && stripe.keyReady && stripe.webhookReady && stripe.pricesReady;

  return Response.json(
    {
      ok: ready,
      service: "ALIGN API",
      backendVersion: BACKEND_VERSION,
      architecture: "cloudflare-worker-kv",
      storage: storageReady ? "kv-ready" : "kv-missing",
      stripeMode: stripe.mode,
      stripeApi: stripe.keyReady ? "configured" : "missing-or-wrong-mode",
      stripeWebhook: stripe.webhookReady ? "configured" : "missing",
      stripePrices: stripe.pricesReady ? "configured" : "missing",
      reportingDb: env.ALIGN_DB_URL && env.ALIGN_DB_SECRET ? "configured" : "optional-unconfigured",
    },
    {
      status: ready ? 200 : 503,
      headers: {
        "access-control-allow-origin": allowOrigin,
        vary: "Origin",
        "cache-control": "no-store",
      },
    },
  );
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health" && request.method === "GET") {
      return health(request, env);
    }
    return apiWorker.fetch(request, env, ctx);
  },
};
