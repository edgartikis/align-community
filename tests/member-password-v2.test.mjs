import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import worker from "../cloudflare/payments-worker/src/entry-member-login.js";
import {
  makeV2Verifier, isV2Verifier, previewPasswordV2Enabled,
} from "../cloudflare/payments-worker/src/member-password-v2.js";

const username = "previewv2test";
const password = "PruebaSegura!123";
const digest = createHash("sha256").update(password).digest("hex");
const token = "a".repeat(64);

function fixture({ v2 = true, mode = "test" } = {}) {
  const map = new Map([
    ["account:" + username, JSON.stringify({
      version: 1, username, passwordHash: digest,
      groupId: "grp_preview_v2", primaryToken: token, tokens: [token],
    })],
    ["group:grp_preview_v2", JSON.stringify({ tokens: [token] })],
    ["member:" + token, JSON.stringify({
      token, name: "Test sintético", memberCode: "PREVIEW-ONLY",
      groupId: "grp_preview_v2", status: "Activa",
      planKey: "brotherhood", position: 1,
    })],
  ]);
  const env = {
    STRIPE_MODE: mode,
    MEMBER_PASSWORD_V2: v2 ? "true" : "false",
    MEMBER_LOGIN_GUARD: v2 ? "true" : "false",
    ALIGN_APP_QR_ROTATION_ENABLED: v2 ? "true" : "false",
    ALIGN_APP_QR_SECRET: "p".repeat(48),
    PAYMENT_STATE: {
      async get(key) { return map.get(key) ?? null; },
      async put(key, val) { map.set(key, val); },
      async delete(key) { map.delete(key); },
      async list() { return { keys: [], list_complete: true }; },
    },
  };
  return { env, map };
}

function request(route = "/api/member-login-v2", credential = { username, password },
  ip = "203.0.113.10") {
  return new Request("https://align-qr-pilot-align-payments.alignservice18.workers.dev" + route, {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": ip },
    body: JSON.stringify(credential),
  });
}

test("V2 feature gate requires isolated Preview flags and Stripe test mode", () => {
  const { env } = fixture();
  assert.equal(previewPasswordV2Enabled(env), true);
  for (const key of ["MEMBER_PASSWORD_V2", "MEMBER_LOGIN_GUARD", "ALIGN_APP_QR_ROTATION_ENABLED"]) {
    assert.equal(previewPasswordV2Enabled({ ...env, [key]: "false" }), false);
  }
  assert.equal(previewPasswordV2Enabled({ ...env, STRIPE_MODE: "live" }), false);
});

test("production stays on the unchanged legacy login; the V2 route is absent", async () => {
  const { env, map } = fixture({ v2: false, mode: "live" });
  assert.equal((await worker.fetch(request(), env)).status, 404);
  assert.equal((await worker.fetch(request("/api/member-login", { username, passwordHash: digest }), env)).status, 200);
  assert.equal(JSON.parse(map.get("account:" + username)).passwordHash, digest);
});

test("V2 upgrades only after a correct raw password and cannot replay SHA-256", async () => {
  const { env, map } = fixture();
  const legacy = request("/api/member-login", { username, passwordHash: digest });
  assert.equal((await worker.fetch(legacy, env)).status, 426);

  // Do not accept the V1 digest as either a V2 field or a password.
  assert.equal((await worker.fetch(request("/api/member-login-v2", { username, passwordHash: digest }), env)).status, 401);
  assert.equal((await worker.fetch(request("/api/member-login-v2", { username, password: digest }), env)).status, 401);
  assert.equal(JSON.parse(map.get("account:" + username)).version, 1);

  const response = await worker.fetch(request(), env);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.ok(data.sessionToken);
  assert.equal(data.primary.memberCode, "PREVIEW-ONLY");

  const saved = JSON.parse(map.get("account:" + username));
  assert.equal(saved.version, 2);
  assert.equal(Object.hasOwn(saved, "passwordHash"), false);
  assert.equal(isV2Verifier(saved.passwordVerifier), true);
  assert.equal(map.get("account:" + username).includes(password), false);
  assert.equal(map.get("account:" + username).includes(digest), false);

  // Subsequent V2 logins use PBKDF2, never the original legacy hash.
  assert.equal((await worker.fetch(request(), env)).status, 200);
  assert.equal((await worker.fetch(request("/api/member-login-v2", { username, password: digest }), env)).status, 401);
  assert.equal((await worker.fetch(request("/api/member-login", { username, passwordHash: digest }), env)).status, 426);
});

test("wrong V2 password retains 401/429 Preview guard and generic errors", async () => {
  const { env } = fixture();
  for (let i = 0; i < 5; i++) {
    const response = await worker.fetch(request("/api/member-login-v2", {
      username, password: "NoEsCorrecta!123",
    }), env);
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, "Usuario o contraseña incorrectos.");
  }
  assert.equal((await worker.fetch(request(), env)).status, 429);
});

test("each new PBKDF2 record has a distinct 128-bit salt", async () => {
  const first = await makeV2Verifier(password);
  const second = await makeV2Verifier(password);
  assert.equal(isV2Verifier(first), true);
  assert.equal(isV2Verifier(second), true);
  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.hash, second.hash);
});
