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
    ["legal-consent:" + groupId, JSON.stringify({ accepted: true, ip: "203.0.113.21", userAgent: "Tester" })],
    ["pending:invoice-paid:sub_review123", JSON.stringify({ invoiceId: "in_test123", customerId: "cus_test123" })],
    ["visit-client:qa_test_1", "visit_1"],
    ["visit:visit_1", JSON.stringify({ visitId: "visit_1", memberCode: "REVIEW-APPLE", visitorName: "Apple Review", saved: 20 })],
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
    MEMBER_PASSWORD_V2: "true", MEMBER_LOGIN_GUARD: "true", ALIGN_APP_QR_ROTATION_ENABLED: "true",
    MEMBER_ACCOUNT_DELETION_TEST_USERNAME: username, STRIPE_MODE: "test" };
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
    "session:cs_test_one", "draft:draft_example", "legal-consent:" + t.groupId,
    "pending:invoice-paid:sub_review123", "visit-client:qa_test_1",
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

test("Duo/Circle deletion revokes every card in the shared account, not unrelated members", async () => {
  const t = fixture({ subStatus: "canceled" });
  const second = "B".repeat(32);
  const g = JSON.parse(t.records.get("group:" + t.groupId));
  const a = JSON.parse(t.records.get("account:" + t.username));
  g.tokens.push(second);
  a.tokens.push(second);
  t.records.set("group:" + t.groupId, JSON.stringify(g));
  t.records.set("account:" + t.username, JSON.stringify(a));
  t.records.set("member:" + second, JSON.stringify({ groupId: t.groupId, status: "Activa", memberCode: "REVIEW-SECOND" }));
  const r = await handleMemberAccountDeletion(t.request({ confirmation: "ELIMINAR", password: t.pass }), t.env, t.deps);
  assert.equal(r.status, 200);
  assert.equal(t.records.has("member:" + second), false);
  assert.equal(t.records.has("member:" + t.token), false);
  assert.equal(t.records.has("visit:visit_other"), true);
});

test("five incorrect re-authentication attempts block the sixth attempt without cancelling Stripe", async () => {
  const t = fixture();
  for (let i = 0; i < 5; i++) {
    const response = await handleMemberAccountDeletion(
      t.request({confirmation: "ELIMINAR", password: "invalid" }), t.env, t.deps);
    assert.equal(response.status, 401);
  }
  const sixth = await handleMemberAccountDeletion(
    t.request({ confirmation: "ELIMINAR", password: t.pass }), t.env, t.deps);
  assert.equal(sixth.status, 429);
  assert.equal(t.stripeCalls.length, 0);
  assert.ok(t.records.has("account:" + t.username));
});

test("cannot enable deletion in production even if feature flag was accidentally turned on", async () => {
  const t = fixture();
  t.env.STRIPE_MODE = "live";
  const r = await handleMemberAccountDeletion(t.request({confirmation:"ELIMINAR",password:t.pass}),t.env,t.deps);
  assert.equal(r.status,503);
  assert.equal(t.stripeCalls.length,0);
  assert.ok(t.records.has("account:" + t.username));
});

test("Preview deletion is restricted to the explicitly authorized disposable account", async () => {
  const t = fixture();
  t.env.MEMBER_ACCOUNT_DELETION_TEST_USERNAME = "qa.delete.other";
  const r = await handleMemberAccountDeletion(t.request({confirmation:"ELIMINAR",password:t.pass}),t.env,t.deps);
  assert.equal(r.status,403);
  assert.equal(t.stripeCalls.length,0);
  assert.ok(t.records.has("account:" + t.username));
});

test("Founder Lifetime wallet revocation needs explicit flag, owner identity and canonical marker", async () => {
  const t = fixture({ owner:true,subStatus:"canceled" });
  const ownerName = "edgar.cordero";
  const oldAccount = JSON.parse(t.records.get("account:" + t.username));
  t.records.delete("account:" + t.username);
  t.records.set("account:" + ownerName, JSON.stringify({...oldAccount,username:ownerName}));
  const sessionKey="member-session:"+"S".repeat(64);
  t.records.set(sessionKey,JSON.stringify({
    groupId:t.groupId,username:ownerName,primaryToken:t.token,expiresAt:Date.now()+3600000
  }));
  t.env.MEMBER_ACCOUNT_DELETION_TEST_USERNAME=ownerName;
  const marker={username:ownerName,groupId:t.groupId,memberCode:"AL-FOUNDER-001"};
  t.records.set("owner-lifetime:primary",JSON.stringify(marker));
  t.records.set("member:"+t.token,JSON.stringify({
    groupId:t.groupId,token:t.token,memberCode:"AL-FOUNDER-001",
    membershipType:"owner_lifetime",ownerComplimentary:true,status:"Activa"
  }));
  t.records.set("wallet:member:AL-FOUNDER-001",JSON.stringify({memberCode:"AL-FOUNDER-001"}));

  let response=await handleMemberAccountDeletion(t.request({confirmation:"ELIMINAR",password:t.pass}),t.env,t.deps);
  assert.equal(response.status,403);
  assert.equal(t.records.has("owner-lifetime:primary"),true);

  t.env.MEMBER_ACCOUNT_DELETION_FOUNDER_ENABLED="true";
  t.records.set("owner-lifetime:primary",JSON.stringify({...marker,username:"attacker"}));
  response=await handleMemberAccountDeletion(t.request({confirmation:"ELIMINAR",password:t.pass}),t.env,t.deps);
  assert.equal(response.status,403);
  assert.equal(t.records.has("owner-lifetime:primary"),true);

  t.records.set("owner-lifetime:primary",JSON.stringify(marker));
  response=await handleMemberAccountDeletion(t.request({confirmation:"ELIMINAR",password:t.pass}),t.env,t.deps);
  assert.equal(response.status,200);
  assert.equal(t.records.has("owner-lifetime:primary"),false);
  assert.equal(t.records.has("wallet:member:AL-FOUNDER-001"),false);
  assert.equal(t.records.has("account:"+ownerName),false);
  assert.equal(t.records.has("member:"+t.token),false);
});


test("Preview deletion requires Google reporting confirmation before erasing member data", async () => {
  const t=fixture();
  const activation=JSON.parse(t.records.get("activation:cs_test_one"));
  activation.customerId="cus_fakeqa1";
  t.records.set("activation:cs_test_one",JSON.stringify(activation));
  t.env.MEMBER_ACCOUNT_DELETION_REPORTING_ENABLED="true";
  t.env.MEMBER_ACCOUNT_DELETION_REPORTING_URL="https://script.google.com/macros/s/qa-fixture/exec";
  t.env.MEMBER_ACCOUNT_DELETION_REPORTING_SECRET="qa-only-secret";
  const calls=[];
  t.deps.reportingFetch=async(_,init)=>{
    calls.push(JSON.parse(init.body));
    assert.ok(t.records.has("account:"+t.username));
    return Response.json({ok:true,anonymized:true,counts:{socios:1,afiliados:1,visitas:1,pagos:1}});
  };
  const res=await handleMemberAccountDeletion(
    t.request({confirmation:"ELIMINAR",password:t.pass}),t.env,t.deps);
  assert.equal(res.status,200);
  assert.equal(calls.length,1);
  assert.equal(calls[0].username,t.username);
  assert.equal(calls[0].stripeCustomerId,"cus_fakeqa1");
  assert.equal(t.records.has("account:"+t.username),false);
});

test("Google reporting timeout fails closed and does not erase account KV", async () => {
  const t=fixture();
  const activation=JSON.parse(t.records.get("activation:cs_test_one"));
  activation.customerId="cus_fakeqa1";
  t.records.set("activation:cs_test_one",JSON.stringify(activation));
  t.env.MEMBER_ACCOUNT_DELETION_REPORTING_ENABLED="true";
  t.env.MEMBER_ACCOUNT_DELETION_REPORTING_URL="https://script.google.com/macros/s/qa-fixture/exec";
  t.env.MEMBER_ACCOUNT_DELETION_REPORTING_SECRET="qa-only-secret";
  t.deps.reportingFetch=async()=>{throw Error("Apps Script temporarily down")};
  const res=await handleMemberAccountDeletion(
    t.request({confirmation:"ELIMINAR",password:t.pass}),t.env,t.deps);
  assert.equal(res.status,503);
  assert.ok(t.records.has("account:"+t.username));
  assert.ok(t.records.has("member:"+t.token));
  assert.equal(t.records.has("deleted-group:"+t.groupId),false);
});

test("Google reporting rejects ambiguous Stripe ownership without sending account identifiers", async () => {
  const t=fixture();
  const activation=JSON.parse(t.records.get("activation:cs_test_one"));
  activation.customerId="cus_ambiguous1";
  t.records.set("activation:cs_test_one",JSON.stringify(activation));
  const group=JSON.parse(t.records.get("group:"+t.groupId));
  group.customerId="cus_ambiguous2";
  t.records.set("group:"+t.groupId,JSON.stringify(group));
  t.env.MEMBER_ACCOUNT_DELETION_REPORTING_ENABLED="true";
  let contacted=false;
  t.deps.reportingFetch=async()=>{contacted=true;throw Error("wrong account")};
  const res=await handleMemberAccountDeletion(
    t.request({confirmation:"ELIMINAR",password:t.pass}),t.env,t.deps);
  assert.equal(res.status,503);
  assert.equal(contacted,false);
  assert.ok(t.records.has("account:"+t.username));
});
