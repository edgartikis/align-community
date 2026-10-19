import test from "node:test";
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { handleMemberAccountDeletion } from "../src/member-account-deletion.js";
import { readFileSync } from "node:fs";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

function fixture({ owner = false, subStatus = "active", enabled = "true" } = {}) {
  const username = "apple.review.align", groupId = "review_group_123";
  const token = "A".repeat(32), sessionToken = "S".repeat(64);
  const pass = "review-example-Password123!";
  const passwordHash = createHash("sha256").update(pass).digest("hex");
  const group = { groupId, tokens: [token], ...(owner
    ? { membershipType: "owner_lifetime", ownerComplimentary: true }
    : {}) };
  const account = { username, groupId, primaryToken: token, tokens: [token], passwordHash };
  const records = new Map([
    [`group:${groupId}`, JSON.stringify(group)],
    [`account:${username}`, JSON.stringify(account)],
    [`member:${token}`, JSON.stringify({ groupId, token, memberCode: "REVIEW-APPLE", status: "Activa", name: "Apple Review" })],
    ["subscription:sub_review123", groupId],
    ["member-session:" + sessionToken, JSON.stringify({ groupId, username, primaryToken: token, expiresAt: Date.now() + 3600000 })],
    ["activation:cs_test_one", JSON.stringify({ groupId, subscriptionId: "sub_review123", sessionId: "cs_test_one" })],
    ["session:cs_test_one", "draft_example"],
    ["draft:draft_example", JSON.stringify({ username, groupId, draftId: "draft_example" })],
    ["visit:visit_1", JSON.stringify({ memberCode: "REVIEW-APPLE", visitorName: "Apple Review", saved: 20 })],
    ["visit:visit_other", JSON.stringify({ memberCode: "OTHER", visitorName: "Another Member", saved: 20 })],
  ]);
  const kv = {
    get: async key => records.get(key) ?? null,
    put: async (key, value) => { records.set(key, value); },
    delete: async key => { records.delete(key); },
    list: async ({prefix = ""} = {}) => ({ keys: [...records.keys()].filter(k => k.startsWith(prefix)).map(name => ({name})), list_complete: true }),
  };
  const stripeCalls = [];
  const stripeRequest = async (_, method, path, args) => {
    stripeCalls.push({ method, path, args });
    if (method === "GET") return { id: "sub_review123", status: subStatus };
    if (method === "DELETE") return { id: "sub_review123", status: "canceled" };
    throw new Error("Unexpected Stripe operation");
  };
  const readJson = async (_, key) => {
    try { return JSON.parse(records.get(key) || "null"); } catch { return null; }
  };
  const requireMemberSession = async () => JSON.parse(records.get("member-session:" + sessionToken));
  const deps = { stripeRequest, readJson, requireMemberSession };
  const env = { PAYMENT_STATE: kv, MEMBER_ACCOUNT_DELETION_ENABLED: enabled,
    MEMBER_PASSWORD_V2: "false", STRIPE_MODE: "test" };
  const request = (body) => new Request("https://api.alignmembers.com.mx/api/member-account/delete", {
    method: "POST", headers: { authorization: "Bearer " + sessionToken,
      "content-type": "application/json" }, body: JSON.stringify(body),
  });
  return { env, records, stripeCalls, deps, request, pass, username, groupId, token };
}

test("deletion is off by default and cannot affect live account records", async () => {
  const t = fixture({ enabled: "false" });
  const r = await handleMemberAccountDeletion(t.request({confirmation:"ELIMINAR",password:t.pass}), t.env, t.deps);
  assert.equal(r.status, 503);
  assert.ok(t.records.has("account:" + t.username));
  assert.equal(t.stripeCalls.length, 0);
});

test("deletion needs exact typed confirmation and password; errors do not touch Stripe", async () => {
  const t = fixture();
  for (const body of [
    { confirmation: "cancelar", password: t.pass },
    { confirmation: "ELIMINAR", password: "" },
    { confirmation: "ELIMINAR", password: "bad-password" },
  ]) {
    const r = await handleMemberAccountDeletion(t.request(body), t.env, t.deps);
    assert.ok(r.status >= 400);
  }
  assert.equal(t.stripeCalls.length, 0);
  assert.ok(t.records.has("account:" + t.username));
  assert.ok(t.records.has("member:" + t.token));
});

test("founder lifetime cannot be erased using subscription account deletion", async () => {
  const t = fixture({ owner: true });
  const r = await handleMemberAccountDeletion(t.request({ confirmation: "ELIMINAR", password: t.pass }), t.env, t.deps);
  assert.equal(r.status, 403);
  assert.equal(t.stripeCalls.length, 0);
  assert.ok(t.records.has("account:" + t.username));
});

test("deleting active review account cancels Stripe, wipes login/cards/activation and redacts visits", async () => {
  const t = fixture();
  const r = await handleMemberAccountDeletion(t.request({ confirmation: "ELIMINAR", password: t.pass }), t.env, t.deps);
  assert.equal(r.status, 200, await r.text().catch(()=>""));
  assert.equal(t.stripeCalls.length, 2);
  assert.deepEqual(t.stripeCalls.map(x => x.method), ["GET", "DELETE"]);
  for (const key of [
    "account:" + t.username, "group:" + t.groupId, "member:" + t.token,
    "subscription:sub_review123", "activation:cs_test_one", "member-session:" + "S".repeat(64),
    "session:cs_test_one", "draft:draft_example",
  ]) assert.equal(t.records.has(key), false, "not deleted: " + key);
  const visit = JSON.parse(t.records.get("visit:visit_1"));
  assert.equal(visit.visitorName, "Cuenta eliminada");
  assert.equal(visit.memberCode, "");
  assert.equal(JSON.parse(t.records.get("visit:visit_other")).visitorName, "Another Member");
  assert.equal(JSON.parse(t.records.get("deleted-group:" + t.groupId)).status, "complete");
});

test("deletion succeeds even if review membership is active but its Stripe subscription was already canceled", async () => {
  const t = fixture({ subStatus: "canceled" });
  const r = await handleMemberAccountDeletion(t.request({ confirmation: "ELIMINAR", password: t.pass }), t.env, t.deps);
  assert.equal(r.status, 200);
  assert.deepEqual(t.stripeCalls.map(x => x.method), ["GET"]);
  assert.equal(t.records.has("member:" + t.token), false);
});

test("Stripe failure leaves the account active and does not store a deletion tombstone", async () => {
  const t = fixture();
  t.deps.stripeRequest = async () => { throw new Error("Stripe offline"); };
  const r = await handleMemberAccountDeletion(t.request({ confirmation: "ELIMINAR", password: t.pass }), t.env, t.deps);
  assert.equal(r.status, 503);
  assert.ok(t.records.has("account:" + t.username));
  assert.ok(t.records.has("member:" + t.token));
  assert.equal(t.records.has("deleted-group:" + t.groupId), false);
});

test("native UI always provides a separate account deletion path, not just cancellation", () => {
  const native = readFileSync(new URL("../../../ios/ALIGN/Sources/AccountScreen.swift", import.meta.url), "utf8");
  const api = readFileSync(new URL("../../../ios/ALIGN/Sources/ALIGNAPI.swift", import.meta.url), "utf8");
  const router = readFileSync(new URL("../src/entry-member-login.js", import.meta.url), "utf8");
  assert.match(native, /Label\("Eliminar cuenta"/);
  assert.match(native, /account\.delete\.entry/);
  assert.match(native, /confirmation == "ELIMINAR"/);
  assert.match(native, /SecureField\("Confirma tu contraseña"/);
  assert.match(native, /confirmationDialog\(/);
  assert.match(api, /request\(path: "\/api\/member-account\/delete"\)/);
  assert.match(router, /handleMemberAccountDeletion\(request, env/);
  assert.match(router, /deleted-group:/);
});
