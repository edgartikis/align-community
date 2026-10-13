import test from "node:test";
import assert from "node:assert/strict";
import worker from "../cloudflare/payments-worker/src/entry-member-login.js";
import { checkPreviewLoginAttempts } from "../cloudflare/payments-worker/src/member-login-guard.js";

const MEMBER = "e".repeat(64);
const RIGHT = "a".repeat(64);
const WRONG = "b".repeat(64);
const username = "pruebalogin";

function fakeEnv({ preview = true } = {}) {
  const map = new Map([
    ["account:" + username, JSON.stringify({ username, passwordHash: RIGHT,
      groupId: "grp-test-login", primaryToken: MEMBER, tokens: [MEMBER] })],
    ["group:grp-test-login", JSON.stringify({ tokens: [MEMBER] })],
    ["member:" + MEMBER, JSON.stringify({ token: MEMBER, name: "Prueba", status: "Activa",
      memberCode: "TEST", groupId: "grp-test-login", position: 1, planKey: "brotherhood" })],
  ]);
  const logs = [];
  return {
    MEMBER_LOGIN_GUARD: preview ? "true" : "false",
    ALIGN_APP_QR_ROTATION_ENABLED: preview ? "true" : "false",
    ALIGN_APP_QR_SECRET: "P".repeat(48),
    PAYMENT_STATE: {
      async get(key) { return map.get(key) ?? null; },
      async put(key, value, opts) {
        logs.push({ key, expirationTtl: opts?.expirationTtl });
        map.set(key, value);
      },
      async delete(key) { map.delete(key); },
      async list() { return { keys: [], list_complete: true }; },
    },
    logs,
    map,
  };
}
function req(passwordHash, ip = "203.0.113.1", user = username) {
  return new Request("https://align-qr-pilot-align-payments.alignservice18.workers.dev/api/member-login", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": ip },
    body: JSON.stringify({ username: user, passwordHash }),
  });
}
test("Preview blocks sixth incorrect password and never writes cleartext IP or username to KV keys", async () => {
  const env = fakeEnv();
  for (let n = 0; n < 5; n++) {
    const res = await worker.fetch(req(WRONG), env);
    assert.equal(res.status, 401);
  }
  assert.equal((await worker.fetch(req(WRONG), env)).status, 429);
  assert.equal((await worker.fetch(req(RIGHT), env)).status, 429);
  const key = env.logs[0].key;
  assert.ok(key.startsWith("preview-member-login-fail:v1:"));
  assert.equal(key.includes("203.0.113.1"), false);
  assert.equal(key.includes(username), false);
  assert.equal(env.logs[0].expirationTtl, 900);
});
test("another source IP may still sign in; valid login resets its own failed counter", async () => {
  const env = fakeEnv();
  assert.equal((await worker.fetch(req(WRONG), env)).status, 401);
  assert.equal((await worker.fetch(req(RIGHT), env)).status, 200);
  const check = await checkPreviewLoginAttempts(env, req(RIGHT), username);
  assert.equal(check.blocked, false);
  assert.equal(env.map.has(check.key), false);
  assert.equal((await worker.fetch(req(RIGHT, "198.51.100.2"), env)).status, 200);
});
test("production flag disabled: no Preview login guard is applied", async () => {
  const env = fakeEnv({ preview: false });
  for (let n = 0; n < 7; n++) assert.equal((await worker.fetch(req(WRONG), env)).status, 401);
  assert.equal((await worker.fetch(req(RIGHT), env)).status, 200);
  assert.equal(env.logs.filter(({key}) => key.startsWith("preview-member-login-fail")).length, 0);
});
test("unrecognized usernames get generic error, even with Preview throttle", async () => {
  const env = fakeEnv();
  const r = await worker.fetch(req(WRONG, "192.0.2.9", "nouser98765"), env);
  assert.equal(r.status, 401);
  assert.equal((await r.json()).error, "Usuario o contraseña incorrectos.");
});
