import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stopVerifiedSubscriptions } from "../src/account-deletion-billing.js";

// No Stripe requests leave this process: all calls use an in-memory stub.
const env = {STRIPE_MODE:"test"};
const customer = "cus_fixture99";

test("preflight reads every subscription before cancelling any", async () => {
  const calls = [];
  const request = async (_,method,path) => {
    calls.push(method+":"+path);
    const id = path.split("/").pop();
    return {id,customer,status:method==="GET"?"active":"canceled"};
  };
  const result = await stopVerifiedSubscriptions(env,["sub_A","sub_B"],customer,request);
  assert.deepEqual(result,{inspected:2,canceled:2});
  assert.deepEqual(calls,[
    "GET:subscriptions/sub_A","GET:subscriptions/sub_B",
    "DELETE:subscriptions/sub_A","DELETE:subscriptions/sub_B",
  ]);
});

test("cross-customer second subscription aborts before first cancellation", async () => {
  const calls=[];
  const request=async (_,method,path)=>{
    calls.push(method);
    const id=path.split("/").pop();
    return {id,customer:id==="sub_other"?"cus_elsewhere":customer,status:"active"};
  };
  await assert.rejects(stopVerifiedSubscriptions(env,["sub_own","sub_other"],customer,request),
    /no corresponde/);
  assert.deepEqual(calls,["GET","GET"]);
});

test("unknown Stripe identity cannot cancel even a single subscription", async () => {
  let called=false;
  const request=async()=>{called=true;throw Error("should not call Stripe");};
  await assert.rejects(stopVerifiedSubscriptions(env,["sub_A"],null,request),/sin verificar/);
  assert.equal(called,false);
});

test("failed Stripe GET cancels nothing",async()=>{
  const calls=[];
  const request=async(_,method,path)=>{
    calls.push(method);
    if(path.endsWith("sub_B"))throw Error("Stripe temporarily unavailable");
    return {id:"sub_A",status:"active",customer};
  };
  await assert.rejects(stopVerifiedSubscriptions(env,["sub_A","sub_B"],customer,request),
    /temporarily unavailable/);
  assert.deepEqual(calls,["GET","GET"]);
});

test("already canceled subscription is only verified, not deleted again",async()=>{
  const calls=[];
  const request=async(_,method)=>{calls.push(method);return{id:"sub_A",status:"canceled",customer};};
  const result=await stopVerifiedSubscriptions(env,["sub_A","sub_A"],customer,request);
  assert.deepEqual(result,{inspected:1,canceled:0});
  assert.deepEqual(calls,["GET"]);
});

test("Stripe cancellation must return a confirmed canceled object",async()=>{
  const calls=[];
  const request=async(_,method)=>{
    calls.push(method);
    return {id:"sub_A",status:method==="GET"?"trialing":"active",customer};
  };
  await assert.rejects(stopVerifiedSubscriptions(env,["sub_A"],customer,request),/no confirmó/);
  assert.deepEqual(calls,["GET","DELETE"]);
});

test("subscription ID mismatch aborts before cancellation",async()=>{
  let deletes=0;
  const request=async(_,method)=>{
    if(method==="DELETE")deletes++;
    return {id:"sub_other",status:"active",customer};
  };
  await assert.rejects(stopVerifiedSubscriptions(env,["sub_A"],customer,request),/no corresponde/);
  assert.equal(deletes,0);
});

test("free account with no subscriptions causes no Stripe calls",async()=>{
  const request=async()=>{throw Error("should never be called");};
  assert.deepEqual(await stopVerifiedSubscriptions(env,[],null,request),
    {inspected:0,canceled:0});
});

test("reject oversized Stripe subscription lists before side effects",async()=>{
  let called=false;
  const request=async()=>{called=true;};
  const ids=Array.from({length:26},(_,i)=>"sub_fixture"+i);
  await assert.rejects(stopVerifiedSubscriptions(env,ids,customer,request),/revisión asistida/);
  assert.equal(called,false);
});

test("safe branch keeps real deletions and Founder disabled in Wrangler production vars",()=>{
  const toml=readFileSync(new URL("../wrangler.toml",import.meta.url),"utf8");
  const prod=toml.split("[vars]")[1]?.split("[previews]")[0];
  const staging=toml.split("[previews.vars]")[1]?.split("[[previews.kv_namespaces]]")[0];
  assert.ok(prod,"Production vars must exist");
  assert.match(prod,/STRIPE_MODE = "live"/);
  assert.match(prod,/MEMBER_ACCOUNT_DELETION_ENABLED = "false"/);
  assert.match(prod,/MEMBER_ACCOUNT_DELETION_REPORTING_ENABLED = "false"/);
  assert.match(prod,/MEMBER_ACCOUNT_DELETION_FOUNDER_ENABLED = "false"/);
  assert.ok(staging,"Preview vars must exist");
  assert.match(staging,/STRIPE_MODE = "test"/);
  assert.match(staging,/MEMBER_ACCOUNT_DELETION_TEST_USERNAME = "qa\.delete\.fixture2"/);
});
