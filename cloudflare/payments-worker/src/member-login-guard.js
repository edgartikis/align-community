// Preview-only, best-effort login throttling for the existing member login.
// Cloudflare KV is eventually consistent, so this is NOT sufficient as the
// sole production brute-force control. Production flag remains disabled.
// No raw IP address, username or password is stored in the KV key.
const MAX_FAILED_ATTEMPTS = 5;
const WINDOW_SECONDS = 15 * 60;
const PREFIX = "preview-member-login-fail:v1:";

export function previewLoginGuardEnabled(env) {
  return env.MEMBER_LOGIN_GUARD === "true" &&
    env.ALIGN_APP_QR_ROTATION_ENABLED === "true";
}

async function counterKey(env, request, username) {
  const secret = String(env.ALIGN_APP_QR_SECRET || "");
  if (secret.length < 32) throw new Error("No se configuró el control de acceso Preview.");
  const ip = String(request.headers.get("cf-connecting-ip") || "unknown").slice(0, 128);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key,
    new TextEncoder().encode("member-login:v1:" + username + ":" + ip)));
  return PREFIX + [...bytes].map((n) => n.toString(16).padStart(2, "0")).join("");
}

export async function checkPreviewLoginAttempts(env, request, username) {
  if (!previewLoginGuardEnabled(env)) return { enabled: false, blocked: false, key: "" };
  if (!env.PAYMENT_STATE) throw new Error("Falta KV Preview.");
  const key = await counterKey(env, request, username);
  const count = Math.max(0, Number(await env.PAYMENT_STATE.get(key) || 0));
  return { enabled: true, blocked: count >= MAX_FAILED_ATTEMPTS, key };
}

export async function recordPreviewLoginFailure(env, result) {
  if (!result.enabled) return;
  const current = Math.max(0, Number(await env.PAYMENT_STATE.get(result.key) || 0));
  await env.PAYMENT_STATE.put(result.key, String(Math.min(MAX_FAILED_ATTEMPTS, current + 1)), {
    expirationTtl: WINDOW_SECONDS,
  });
}

export async function clearPreviewLoginFailures(env, result) {
  if (result.enabled) await env.PAYMENT_STATE.delete(result.key);
}
