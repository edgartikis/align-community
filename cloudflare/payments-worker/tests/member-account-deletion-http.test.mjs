import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { makeV2Verifier } from "../src/member-password-v2.js";
import worker from "../src/entry-member-login.js";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

// Exercises the member API Worker HTTP routing, V2 sign-in, session issuance,
// reauthentication, billing cancellation and post-deletion access control.
// Only in-memory KV and a Stripe HTTP mock: NEVER sends a network request.
function fixture() {
  const records = new Map();
  const username = "qa.delete.fixture";
  const password = "Fixture-Delete-Only!82";
  const groupId = "grp_isolated_deletion_999";
  const token = "Q".repeat(48);
  const subId = "sub_isolated_mock_999";
  const base = "https://align-qr-pilot-align-payments.alignservice18.workers.dev";
  const env = {
    PAYMENT_STATE: {
      get: async (key) => records.get(key) ?? null,
      put: async (key, value) => { records.set(key, value); },
      delete: async (key) => { records.delete(key); },
      list: async ({ prefix = "", limit = 100, cursor } = {}) => {
        if (cursor) throw new Error("Fixture list unexpectedly paginated");
        const keys = [...records.keys()].filter(key => key.startsWith(prefix));
        assert.ok(keys.length <= limit, "Fixture exceeds KV page capacity");
        return { keys: keys.map(name => ({ name })), list_complete: true };
      },
    },
    STRIPE_MODE: "test",
    STRIPE_SECRET_KEY: "sk_test_local_fixture_NOT_REAL",
    MEMBER_PASSWORD_V2: "true",
    MEMBER_LOGIN_GUARD: "true",
    ALIGN_APP_QR_ROTATION_ENABLED: "true",
    ALIGN_APP_QR_SECRET: "preview-e2e-test-secret-not-for-production-12345",
    MEMBER_ACCOUNT_DELETION_ENABLED: "true",
    MEMBER_ACCOUNT_DELETION_TEST_USERNAME: username,
    WALLET_ENABLED: "false",
    WALLET_OWNER_ENABLED: "false",
  };
  const stripeCalls = [];
  const fetchMock = async (url, options = {}) => {
    assert.ok(String(url).startsWith("https://api.stripe.com/v1/subscriptions/"),
      "Unexpected outgoing network request");
    assert.ok(String(url).endsWith(subId), "Wrong subscription targeted");
    const method = String(options.method || "GET").toUpperCase();
    stripeCalls.push(method);
    if (method === "GET") return Response.json({id: subId,status:"active"});
    if (method === "DELETE") return Response.json({id: subId,status:"canceled"});
    return Response.json({ error: { message:"Method rejected" } }, { status: 405 });
  };
  const req = (path, {method="POST",body,sessionToken}={})=>new Request(base+path,{
    method,
    headers:{
      "content-type":"application/json",
      ...(sessionToken?{authorization:"Bearer "+sessionToken}:{}),
      "cf-connecting-ip":"192.0.2.18",
    },
    ...(body ? { body:JSON.stringify(body) } : {}),
  });
  return { records,username,password,groupId,token,subId,base,env,stripeCalls,fetchMock,req };
}
async function seed(t) {
  const account = {
    username:t.username,
    groupId:t.groupId,
    primaryToken:t.token,
    tokens:[t.token],
    passwordVerifier: await makeV2Verifier(t.password),
    version:2,
  };
  t.records.set("account:"+t.username, JSON.stringify(account));
  t.records.set("group:"+t.groupId, JSON.stringify({groupId:t.groupId,tokens:[t.token]}));
  t.records.set("member:"+t.token, JSON.stringify({
    token:t.token, groupId:t.groupId, memberCode:"QA-DELETE-001",
    name:"Account Deletion Fixture", status:"Activa", level:"The Brotherhood",
    validFrom:"2026-01-01T00:00:00.000Z",validUntil:"2099-01-01T00:00:00.000Z",
  }));
  t.records.set("subscription:"+t.subId,t.groupId);
  t.records.set("activation:fixture",JSON.stringify({groupId:t.groupId,subscriptionId:t.subId,sessionId:"fixture"}));
  t.records.set("visit:qa-fixture",JSON.stringify({ memberCode:"QA-DELETE-001",visitorName:"Account Deletion Fixture",spent:200 }));
  t.records.set("visit:another-account",JSON.stringify({memberCode:"OTHER-123",visitorName:"Other Account",spent:99}));
}

test("full HTTP flow: Preview member login, delete, Stripe Test cancellation, QR access revoked, login denied",async()=>{
  const t=fixture();
  await seed(t);
  const originalFetch=globalThis.fetch;
  globalThis.fetch=t.fetchMock;
  try {
    const logged=await worker.fetch(t.req("/api/member-login-v2",{body:{username:t.username,password:t.password}}),t.env);
    assert.equal(logged.status,200,await logged.clone().text());
    const data=await logged.json();
    assert.equal(data.primary.status,"Activa");
    assert.ok(data.sessionToken?.length>=40);
    const wrong=await worker.fetch(t.req("/api/member-account/delete",{
      sessionToken:data.sessionToken,body:{confirmation:"ELIMINAR",password:"wrong"},
    }),t.env);
    assert.equal(wrong.status,401);
    assert.equal(t.stripeCalls.length,0);
    const deleted=await worker.fetch(t.req("/api/member-account/delete",{
      sessionToken:data.sessionToken,body:{confirmation:"ELIMINAR",password:t.password},
    }),t.env);
    assert.equal(deleted.status,200,await deleted.clone().text());
    assert.deepEqual(t.stripeCalls,["GET","DELETE"]);
    const result=await deleted.json();
    assert.equal(result.status,"deleted");
    assert.equal(t.records.has("account:"+t.username),false);
    assert.equal(t.records.has("member:"+t.token),false);
    assert.equal(t.records.has("subscription:"+t.subId),false);
    assert.equal(JSON.parse(t.records.get("visit:qa-fixture")).memberCode,"");
    assert.equal(JSON.parse(t.records.get("visit:another-account")).visitorName,"Other Account");
    const loginAgain=await worker.fetch(t.req("/api/member-login-v2",{
      body:{username:t.username,password:t.password},
    }),t.env);
    assert.equal(loginAgain.status,401);
    const oldSession=await worker.fetch(t.req("/api/member-billing",{
      method:"GET",sessionToken:data.sessionToken,
    }),t.env);
    assert.equal(oldSession.status,401);
    assert.equal(JSON.parse(t.records.get("deleted-group:"+t.groupId)).status,"complete");
  } finally {
    globalThis.fetch=originalFetch;
  }
});

test("production-mode hard gate stops deletion despite explicit enable flag",async()=>{
  const t=fixture();
  await seed(t);
  t.env.STRIPE_MODE="live";
  const response=await worker.fetch(t.req("/api/member-account/delete",{
    sessionToken:"S".repeat(64),body:{confirmation:"ELIMINAR",password:t.password},
  }),t.env);
  assert.equal(response.status,503);
  assert.equal(t.records.has("account:"+t.username),true);
  assert.equal(t.stripeCalls.length,0);
});

test("different username cannot be deleted even with valid session and correct password",async()=>{
  const t=fixture();
  await seed(t);
  t.env.MEMBER_ACCOUNT_DELETION_TEST_USERNAME="qa.delete.another";
  const logged=await worker.fetch(t.req("/api/member-login-v2",{body:{username:t.username,password:t.password}}),t.env);
  assert.equal(logged.status,200);
  const {sessionToken}=await logged.json();
  const deleted=await worker.fetch(t.req("/api/member-account/delete",{
    sessionToken,body:{confirmation:"ELIMINAR",password:t.password},
  }),t.env);
  assert.equal(deleted.status,403);
  assert.equal(t.records.has("account:"+t.username),true);
  assert.equal(t.stripeCalls.length,0);
});
