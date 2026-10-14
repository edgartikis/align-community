// Isolated Preview-only V2 password verification. Never deploy to production
// without an explicit migration plan. Raw passwords are accepted over HTTPS
// only for /api/member-login-v2; they are never persisted or logged.
// Existing V1 records are upgraded after a successful plaintext login.
const ITERATIONS = 600_000;
const SCHEME = "pbkdf2-sha256";
const encoder = new TextEncoder();

export function previewPasswordV2Enabled(env) {
  return env.MEMBER_PASSWORD_V2 === "true" &&
    env.MEMBER_LOGIN_GUARD === "true" &&
    env.ALIGN_APP_QR_ROTATION_ENABLED === "true" &&
    env.STRIPE_MODE === "test";
}

export function validPlaintextPassword(value) {
  return typeof value === "string" && value.length > 0 &&
    encoder.encode(value).length <= 256;
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64url(value, expectedLength) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const chars = atob(value.replace(/-/g, "+").replace(/_/g, "/")
      .padEnd(Math.ceil(value.length / 4) * 4, "="));
    if (chars.length !== expectedLength) return null;
    return Uint8Array.from(chars, (ch) => ch.charCodeAt(0));
  } catch {
    return null;
  }
}

function equalBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function isV2Verifier(value) {
  return value?.scheme === SCHEME &&
    value.iterations === ITERATIONS &&
    fromBase64url(value.salt, 16) !== null &&
    fromBase64url(value.hash, 32) !== null;
}

async function derive(password, salt) {
  const material = await crypto.subtle.importKey("raw", encoder.encode(password),
    "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({
    name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS,
  }, material, 256));
}

export async function makeV2Verifier(password) {
  if (!validPlaintextPassword(password)) throw new Error("Contraseña no válida.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt);
  return {
    scheme: SCHEME, iterations: ITERATIONS,
    salt: base64url(salt), hash: base64url(hash),
  };
}

export async function authenticatePreviewPassword(account, password) {
  if (!validPlaintextPassword(password) || !account) {
    return { ok: false, upgradedAccount: null };
  }

  // Once migrated, NEVER fall back to a legacy reusable SHA-256 credential.
  if (Object.prototype.hasOwnProperty.call(account, "passwordVerifier")) {
    if (!isV2Verifier(account.passwordVerifier)) {
      return { ok: false, upgradedAccount: null };
    }
    const hash = await derive(password, fromBase64url(account.passwordVerifier.salt, 16));
    return {
      ok: equalBytes(hash, fromBase64url(account.passwordVerifier.hash, 32)),
      upgradedAccount: null,
    };
  }

  const stored = account.passwordHash;
  if (typeof stored !== "string" || !/^[a-f0-9]{64}$/.test(stored)) {
    return { ok: false, upgradedAccount: null };
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(password)));
  const candidate = [...digest].map((n) => n.toString(16).padStart(2, "0")).join("");
  // Constant time for fixed-length digests.
  let diff = 0;
  for (let i = 0; i < 64; i++) diff |= stored.charCodeAt(i) ^ candidate.charCodeAt(i);
  if (diff !== 0) return { ok: false, upgradedAccount: null };

  const { passwordHash: _discardLegacyHash, ...remaining } = account;
  return {
    ok: true,
    upgradedAccount: {
      ...remaining, version: 2, passwordVerifier: await makeV2Verifier(password),
    },
  };
}
