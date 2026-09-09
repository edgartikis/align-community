import apiWorker from "./entry-member-login.js";

const BACKEND_VERSION = "2026-09-08-canonical-v1";

function stripeMode(env) {
  const key = String(env.STRIPE_SECRET_KEY || "").trim();
  if (/^(sk|rk)_live_/.test(key)) return "live";
  if (/^(sk|rk)_test_/.test(key)) return "test";
  return "unconfigured";
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
  const mode = stripeMode(env);
  const stripeReady = mode !== "unconfigured";
  const ready = storageReady && stripeReady;

  return Response.json(
    {
      ok: ready,
      service: "ALIGN API",
      backendVersion: BACKEND_VERSION,
      architecture: "cloudflare-worker-kv",
      storage: storageReady ? "kv-ready" : "kv-missing",
      stripeMode: mode,
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
