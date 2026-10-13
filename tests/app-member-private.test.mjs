import test from "node:test";
import assert from "node:assert/strict";
import { handleAppMemberPrivate } from "../cloudflare/payments-worker/src/entry-app-member-private.js";

const preview = "https://align-qr-pilot-align-payments.alignservice18.workers.dev";
const sessionToken = "s".repeat(64);
const cardToken = "c".repeat(64);
const secondToken = "d".repeat(64);
const now = Date.now();

function mockEnv(opts = {}) {
  const entries = new Map([
    ["member-session:" + sessionToken, {
      groupId: "grp_preview_one", primaryToken: cardToken,
      expiresAt: now + 60_000,
    }],
    ["member:" + cardToken, {
      token: cardToken, groupId: "grp_preview_one",
      memberCode: "PREVIEW-TEST-001", integranteId: "TEST-001",
      status: "Activa", name: "Prueba aislada", level: "Brotherhood",
      planKey: "brotherhood", position: 1, savings: 0,
      validFrom: new Date(now - 60_000).toISOString(),
      validUntil: new Date(now + 60 * 60_000).toISOString(),
    }],
    ["member:" + secondToken, {
      token: secondToken, groupId: "grp_preview_two",
      memberCode: "PREVIEW-TEST-002", status: "Activa",
    }],
    ["group:grp_preview_one", { tokens: [cardToken] }],
    ["group:grp_preview_two", { tokens: [secondToken] }],
  ]);
  if (opts.expired) entries.get("member-session:" + sessionToken).expiresAt = now - 60_000;
  if (opts.orphaned) entries.delete("group:grp_preview_one");
  return {
    ALIGN_APP_QR_ROTATION_ENABLED: opts.disabled ? "false" : "true",
    PAYMENT_STATE: {
      async get(key) {
        const record = entries.get(key);
        return record === undefined ? null : JSON.stringify(record);
      },
      async list() { return { keys: [], list_complete: true }; },
    },
  };
}
function request(path, body = { token: cardToken }, opts = {}) {
  const headers = { "content-type": "application/json" };
  if (!opts.anonymous) headers.authorization = "Bearer " + (opts.session || sessionToken);
  if (opts.origin) headers.origin = opts.origin;
  return new Request(preview + path, {
    method: opts.method || "POST",
    headers,
    ...(opts.method === "GET" ? {} : { body: JSON.stringify(body) }),
  });
}
test("production disabled: no native member-private routes", async () => {
  const response = await handleAppMemberPrivate(request("/api/app-member-card"), mockEnv({ disabled: true }));
  assert.equal(response.status, 404);
});
test("rejects anonymous and expired bearer sessions", async () => {
  const anonymous = await handleAppMemberPrivate(request("/api/app-member-card", undefined, { anonymous: true }), mockEnv());
  assert.equal(anonymous.status, 401);
  const expired = await handleAppMemberPrivate(request("/api/app-member-card"), mockEnv({ expired: true }));
  assert.equal(expired.status, 401);
});
test("rejects tokens for a different member group and orphaned groups", async () => {
  const other = await handleAppMemberPrivate(request("/api/app-member-card", { token: secondToken }), mockEnv());
  assert.equal(other.status, 403);
  const orphaned = await handleAppMemberPrivate(request("/api/app-member-card"), mockEnv({ orphaned: true }));
  assert.equal(orphaned.status, 403);
});
test("rejects external token-in-URL GET and malformed input", async () => {
  const get = await handleAppMemberPrivate(request("/api/app-member-card?token=" + cardToken, null, { method: "GET" }), mockEnv());
  assert.equal(get.status, 405);
  const invalid = await handleAppMemberPrivate(request("/api/app-member-card", { token: "short" }), mockEnv());
  assert.equal(invalid.status, 400);
});
test("authorized preview card uses existing canonical status and no-store", async () => {
  const response = await handleAppMemberPrivate(request("/api/app-member-card"), mockEnv());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const json = await response.json();
  assert.equal(json.active, true);
  assert.equal(json.memberCode, "PREVIEW-TEST-001");
  assert.equal(json.name, "Prueba aislada");
  assert.equal(JSON.stringify(json).includes(cardToken), false);
});
test("authorized preview activity requires same bearer and member group", async () => {
  const response = await handleAppMemberPrivate(request("/api/app-member-activity"), mockEnv());
  assert.equal(response.status, 200);
  const json = await response.json();
  assert.equal(json.ok, true);
  assert.equal(json.member.memberCode, "PREVIEW-TEST-001");
  assert.equal(json.activity.visits, 0);
});
