import test from "node:test";
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { handleMemberAccountDeletion, recoverInterruptedDeletionPreview } from "../src/member-account-deletion.js";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

function fixture({ owner = false, subStatus = "active", enabled = "true" } = {}) {
  const username = "apple.review.align", groupId = "review_group_123";
  const token = "A".repeat(32), sessionToken = "S".repeat(64);
  const pass = "review-example-Password123!";
  const passwordHash = createHash("sha256").update(pass).digest("hex");
  const group = { groupId, tokens: [token], customerId: "cus_test123", ...(owner
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
    if (method === "GET") {
      const activation = JSON.parse(records.get("activation:cs_test_one") || "{}");
      const ownerGroup = JSON.parse(records.get("group:"+groupId) || "{}");
      return { id: "sub_review123", status: subStatus,
        customer: activation.customerId || ownerGroup.customerId || "cus_test123" };
    }
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

test("Live deletion requires independent live and reporting switches, not merely the main flag", async () => {
  const t = fixture();
  t.env.STRIPE_MODE = "live";
  const r = await handleMemberAccountDeletion(t.request({confirmation:"ELIMINAR",password:t.pass}),t.env,t.deps);
  assert.equal(r.status,503);
  assert.equal(t.stripeCalls.length,0);
  assert.ok(t.records.has("account:"+t.username));
});

test("Live reporting preflight must affirm ownership BEFORE Stripe cancellation",async()=>{
  const t=fixture();
  Object.assign(t.env,{
    STRIPE_MODE:"live",
    MEMBER_ACCOUNT_DELETION_LIVE_ENABLED:"true",
    MEMBER_ACCOUNT_DELETION_REPORTING_ENABLED:"true",
    ALIGN_DB_URL:"https://script.google.com/macros/s/test-fixture/exec",
    ALIGN_DB_SECRET:"F".repeat(48),
    MEMBER_ACCOUNT_DELETION_LIVE_SECRET:"D".repeat(48),
  });
  const calls=[];
  t.deps.reportingFetch=async(_,init)=>{
    const body=JSON.parse(init.body);
    calls.push("SHEETS:"+body.action);
    assert.equal(body.username,t.username);
    assert.equal(body.stripeCustomerId,"cus_test123");
    if(body.action==="preflight_account_erasure")
      return Response.json({ok:true,eligible:true,capability:"account-erasure-v1"});
    if(body.action==="anonymize_account")
      return Response.json({ok:true,anonymized:true,counts:{socios:1,afiliados:1,visitas:1,pagos:1}});
    throw Error("Unexpected reporting request");
  };
  const original=t.deps.stripeRequest;
  t.deps.stripeRequest=async (...args)=>{
    calls.push("STRIPE:"+args[1]);
    return original(...args);
  };
  const res=await handleMemberAccountDeletion(t.request({
    confirmation:"ELIMINAR",password:t.pass,
  }),t.env,t.deps);
  assert.equal(res.status,200,await res.clone().text());
  assert.deepEqual(calls,[
    "SHEETS:preflight_account_erasure",
    "STRIPE:GET","STRIPE:DELETE",
    "SHEETS:anonymize_account",
  ]);
  assert.equal(t.records.has("account:"+t.username),false);
});

test("Live preflight failure never calls Stripe or alters member data",async()=>{
  const t=fixture();
  Object.assign(t.env,{
    STRIPE_MODE:"live",
    MEMBER_ACCOUNT_DELETION_LIVE_ENABLED:"true",
    MEMBER_ACCOUNT_DELETION_REPORTING_ENABLED:"true",
    ALIGN_DB_URL:"https://script.google.com/macros/s/test-fixture/exec",
    ALIGN_DB_SECRET:"F".repeat(48),
    MEMBER_ACCOUNT_DELETION_LIVE_SECRET:"D".repeat(48),
  });
  let reportingCalls=0;
  t.deps.reportingFetch=async()=>{
    reportingCalls++;
    return Response.json({ok:true,eligible:false,capability:"account-erasure-v1"});
  };
  const r=await handleMemberAccountDeletion(t.request({
    confirmation:"ELIMINAR",password:t.pass,
  }),t.env,t.deps);
  assert.equal(r.status,503);
  assert.equal(reportingCalls,1);
  assert.equal(t.stripeCalls.length,0);
  assert.ok(t.records.has("account:"+t.username));
  assert.ok(t.records.has("member:"+t.token));
});

test("Live mode fails closed if Google integration secret is missing",async()=>{
  const t=fixture();
  Object.assign(t.env,{
    STRIPE_MODE:"live",
    MEMBER_ACCOUNT_DELETION_LIVE_ENABLED:"true",
    MEMBER_ACCOUNT_DELETION_REPORTING_ENABLED:"true",
    ALIGN_DB_URL:"https://script.google.com/macros/s/test-fixture/exec",
    ALIGN_DB_SECRET:"F".repeat(48),
    MEMBER_ACCOUNT_DELETION_LIVE_SECRET:"",
  });
  const r=await handleMemberAccountDeletion(t.request({
    confirmation:"ELIMINAR",password:t.pass,
  }),t.env,t.deps);
  assert.equal(r.status,503);
  assert.equal(t.stripeCalls.length,0);
  assert.ok(t.records.has("account:"+t.username));
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

test("deleted visits retain accounting amounts but remove unexpected private fields and retry sync", async () => {
  const t = fixture({subStatus:"canceled"});
  const key = "visit:visit_1";
  const row = JSON.parse(t.records.get(key));
  Object.assign(row,{
    visitId:"VIS-CF-FIXTURE",createdAt:"2026-10-19T12:00:00.000Z",
    spent:199,saved:40,gross:239,people:2,
    email:"private@example.invalid",phone:"5551234",
    notes:"Highly sensitive notes",photoUrl:"data:image/jpeg;base64,SECRET",
    memberToken:"sensitive-member-token",benefit:"My medical details",
    dbSynced:false,dbSyncError:"contains customer identity"
  });
  t.records.set(key,JSON.stringify(row));
  const response=await handleMemberAccountDeletion(
    t.request({confirmation:"ELIMINAR",password:t.pass}),t.env,t.deps);
  assert.equal(response.status,200);
  const safe=JSON.parse(t.records.get(key));
  assert.equal(safe.visitorName,"Cuenta eliminada");
  assert.equal(safe.memberCode,"");
  assert.equal(safe.spent,199);
  assert.equal(safe.saved,40);
  assert.equal(safe.gross,239);
  assert.equal(safe.dbSynced,true);
  for(const key of ["email","phone","notes","photoUrl","memberToken","benefit","dbSyncError"]) {
    assert.equal(Object.hasOwn(safe,key),false,"Unexpected personal data retained: "+key);
  }
  assert.equal(JSON.parse(t.records.get("visit:visit_other")).visitorName,"Another Member");
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
  const accountGroup=JSON.parse(t.records.get("group:"+t.groupId));
  accountGroup.customerId="cus_fakeqa1";
  t.records.set("group:"+t.groupId,JSON.stringify(accountGroup));
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
  const accountGroup=JSON.parse(t.records.get("group:"+t.groupId));
  accountGroup.customerId="cus_fakeqa1";
  t.records.set("group:"+t.groupId,JSON.stringify(accountGroup));
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


test("Stripe canceled, Google temporarily fails, then authenticated retry finishes once Google recovers", async () => {
  const t=fixture();
  const activation=JSON.parse(t.records.get("activation:cs_test_one"));
  activation.customerId="cus_fakeqa1";
  t.records.set("activation:cs_test_one",JSON.stringify(activation));
  const accountGroup=JSON.parse(t.records.get("group:"+t.groupId));
  accountGroup.customerId="cus_fakeqa1";
  t.records.set("group:"+t.groupId,JSON.stringify(accountGroup));
  Object.assign(t.env,{
    MEMBER_ACCOUNT_DELETION_REPORTING_ENABLED:"true",
    MEMBER_ACCOUNT_DELETION_REPORTING_URL:"https://script.google.com/macros/s/qa-fixture/exec",
    MEMBER_ACCOUNT_DELETION_REPORTING_SECRET:"qa-local-only",
  });
  let status="active", cancelCalls=0, reportCalls=0;
  t.deps.stripeRequest=async (_,method)=>{
    if(method==="GET") return {id:"sub_review123",status, customer:"cus_fakeqa1"};
    if(method==="DELETE") { status="canceled";cancelCalls++;return {id:"sub_review123",status}; }
    throw Error("unexpected Stripe operation");
  };
  t.deps.reportingFetch=async()=>{
    reportCalls++;
    if(reportCalls===1) throw Error("Google temporary unavailable");
    return Response.json({ok:true,anonymized:true,counts:{socios:1,afiliados:1,visitas:1,pagos:1}});
  };
  const first=await handleMemberAccountDeletion(
    t.request({confirmation:"ELIMINAR",password:t.pass}),t.env,t.deps);
  assert.equal(first.status,503);
  assert.equal(cancelCalls,1);
  assert.ok(t.records.has("account:"+t.username));
  assert.equal(JSON.parse(t.records.get("deletion-progress:"+t.groupId)).stage,"erasing-reporting");
  assert.equal(t.records.has("deleted-group:"+t.groupId),false);
  const second=await handleMemberAccountDeletion(
    t.request({confirmation:"ELIMINAR",password:t.pass}),t.env,t.deps);
  assert.equal(second.status,200);
  assert.equal(cancelCalls,1,"Second attempt must not double-cancel Stripe");
  assert.equal(reportCalls,2);
  assert.equal(t.records.has("account:"+t.username),false);
  assert.equal(t.records.has("deletion-progress:"+t.groupId),false);
  assert.equal(JSON.parse(t.records.get("deleted-group:"+t.groupId)).status,"complete");
});

test("Transient KV cleanup error is retried before responding with success",async()=>{
  const t=fixture({subStatus:"canceled"});
  const original=t.env.PAYMENT_STATE.delete;
  let failures=0;
  t.env.PAYMENT_STATE.delete=async(key)=>{
    if(key==="account:"+t.username && failures++===0)throw Error("KV transient timeout");
    return original(key);
  };
  const result=await handleMemberAccountDeletion(t.request({confirmation:"ELIMINAR",password:t.pass}),t.env,t.deps);
  assert.equal(result.status,200);
  assert.equal(t.records.has("account:"+t.username),false);
  assert.equal(t.records.has("deletion-progress:"+t.groupId),false);
  assert.equal(JSON.parse(t.records.get("deleted-group:"+t.groupId)).status,"complete");
});

test("Permanent KV failure leaves a processing tombstone and support-visible journal, never fake success",async()=>{
  const t=fixture({subStatus:"canceled"});
  const original=t.env.PAYMENT_STATE.delete;
  t.env.PAYMENT_STATE.delete=async(key)=>{
    if(key==="account:"+t.username)throw Error("KV permanent read-only");
    return original(key);
  };
  const result=await handleMemberAccountDeletion(t.request({confirmation:"ELIMINAR",password:t.pass}),t.env,t.deps);
  assert.equal(result.status,503);
  assert.equal(t.records.has("account:"+t.username),true);
  assert.equal(JSON.parse(t.records.get("deletion-progress:"+t.groupId)).stage,"purging-kv");
  assert.equal(JSON.parse(t.records.get("deleted-group:"+t.groupId)).status,"processing");
  // This requires a protected operator recovery procedure, not client retry:
  // requireMemberSession correctly rejects tombstoned accounts.
});


test("After successful erasure and completed tombstone, journal-cleanup failure cannot falsely report failed deletion",async()=>{
  const t=fixture({subStatus:"canceled"});
  const original=t.env.PAYMENT_STATE.delete;
  t.env.PAYMENT_STATE.delete=async(key)=>{
    if(key==="deletion-progress:"+t.groupId)throw Error("KV journal GC unavailable");
    return original(key);
  };
  const response=await handleMemberAccountDeletion(t.request({confirmation:"ELIMINAR",password:t.pass}),t.env,t.deps);
  assert.equal(response.status,200);
  assert.equal(t.records.has("account:"+t.username),false);
  assert.equal(JSON.parse(t.records.get("deleted-group:"+t.groupId)).status,"complete");
  assert.equal(JSON.parse(t.records.get("deletion-progress:"+t.groupId)).stage,"purging-kv");
});


test("Internal Preview recovery safely resumes permanently interrupted KV deletion",async()=>{
  const t=fixture({subStatus:"canceled"});
  const original=t.env.PAYMENT_STATE.delete;
  let outage=true;
  t.env.PAYMENT_STATE.delete=async key=>{
    if(outage && key==="account:"+t.username)throw Error("KV permanent outage");
    return original(key);
  };
  const first=await handleMemberAccountDeletion(
    t.request({confirmation:"ELIMINAR",password:t.pass}),t.env,t.deps);
  assert.equal(first.status,503);
  assert.equal(JSON.parse(t.records.get("deleted-group:"+t.groupId)).status,"processing");
  assert.ok(t.records.has("deletion-manifest:"+t.groupId));
  const manifest=JSON.parse(t.records.get("deletion-manifest:"+t.groupId));
  assert.equal(manifest.username,t.username);
  assert.equal(manifest.groupId,t.groupId);
  assert.ok(manifest.deletions.includes("account:"+t.username));
  assert.equal(JSON.stringify(manifest).includes(t.pass),false);
  // No additional Stripe operations: billing was already stopped.
  const priorStripeCalls=t.stripeCalls.length;
  outage=false;
  const outcome=await recoverInterruptedDeletionPreview(t.env,{
    username:t.username,groupId:t.groupId,
  });
  assert.deepEqual(outcome,{ok:true,status:"deleted"});
  assert.equal(t.stripeCalls.length,priorStripeCalls);
  assert.equal(t.records.has("account:"+t.username),false);
  assert.equal(t.records.has("member:"+t.token),false);
  assert.equal(t.records.has("deletion-manifest:"+t.groupId),false);
  assert.equal(t.records.has("deletion-progress:"+t.groupId),false);
  assert.equal(JSON.parse(t.records.get("deleted-group:"+t.groupId)).status,"complete");
  assert.equal(JSON.parse(t.records.get("visit:visit_other")).visitorName,"Another Member");
});

test("Internal recovery rejects Live mode, unrelated usernames and incomplete authorization",async()=>{
  const t=fixture({subStatus:"canceled"});
  await assert.rejects(recoverInterruptedDeletionPreview(t.env,{
    username:t.username,groupId:t.groupId
  }),/No hay una eliminación/);
  t.env.STRIPE_MODE="live";
  await assert.rejects(recoverInterruptedDeletionPreview(t.env,{
    username:t.username,groupId:t.groupId
  }),/no está autorizada/);
  t.env.STRIPE_MODE="test";
  await assert.rejects(recoverInterruptedDeletionPreview(t.env,{
    username:"qa.another",groupId:t.groupId
  }),/no está autorizada/);
});

test("Recovery will not touch KV if a processing tombstone has no verified manifest",async()=>{
  const t=fixture({subStatus:"canceled"});
  t.records.set("deleted-group:"+t.groupId,JSON.stringify({status:"processing"}));
  t.records.set("deletion-progress:"+t.groupId,JSON.stringify({stage:"purging-kv"}));
  await assert.rejects(recoverInterruptedDeletionPreview(t.env,{
    username:t.username,groupId:t.groupId
  }),/Falta el manifiesto verificado/);
  assert.ok(t.records.has("account:"+t.username));
  assert.ok(t.records.has("member:"+t.token));
});


test("Reporting QA refuses to cancel a subscription owned by another Stripe customer",async()=>{
  const t=fixture();
  const activation=JSON.parse(t.records.get("activation:cs_test_one"));
  activation.customerId="cus_fakeqa1";
  t.records.set("activation:cs_test_one",JSON.stringify(activation));
  const group=JSON.parse(t.records.get("group:"+t.groupId));
  group.customerId="cus_fakeqa1";
  t.records.set("group:"+t.groupId,JSON.stringify(group));
  const accountGroup=JSON.parse(t.records.get("group:"+t.groupId));
  accountGroup.customerId="cus_fakeqa1";
  t.records.set("group:"+t.groupId,JSON.stringify(accountGroup));
  t.env.MEMBER_ACCOUNT_DELETION_REPORTING_ENABLED="true";
  const attempts=[];
  t.deps.stripeRequest=async(_,method)=>{
    attempts.push(method);
    if(method==="GET")return {id:"sub_review123",status:"trialing",customer:"cus_someone_else"};
    throw Error("should not cancel unrelated Stripe subscription");
  };
  let calledSheets=false;
  t.deps.reportingFetch=async()=>{calledSheets=true;throw Error("should not erase sheets");};
  const response=await handleMemberAccountDeletion(
    t.request({confirmation:"ELIMINAR",password:t.pass}),t.env,t.deps);
  assert.equal(response.status,503);
  assert.deepEqual(attempts,["GET"]);
  assert.equal(calledSheets,false);
  assert.ok(t.records.has("account:"+t.username));
  assert.equal(t.records.has("deleted-group:"+t.groupId),false);
});
