import test from "node:test";
import assert from "node:assert/strict";
import { eraseAccountReporting } from "../src/account-deletion-reporting.js";

const env=()=>({
  STRIPE_MODE:"test",
  MEMBER_ACCOUNT_DELETION_REPORTING_ENABLED:"true",
  MEMBER_ACCOUNT_DELETION_REPORTING_URL:"https://script.google.com/macros/s/qa-deletion-fixture/exec",
  MEMBER_ACCOUNT_DELETION_REPORTING_SECRET:"qa-private-fixture-never-deploy",
});
const member={username:"qa.delete.fixture2",customerId:"cus_fakeqa1"};
const success={ok:true,anonymized:true,counts:{socios:1,afiliados:1,visitas:1,pagos:1}};

test("reports exactly one verified QA identity over HTTPS with private secret and requires acknowledgment",async()=>{
  let called=0;
  const result=await eraseAccountReporting(env(),member,async(url,options)=>{
    called++;
    assert.equal(url,env().MEMBER_ACCOUNT_DELETION_REPORTING_URL);
    assert.equal(options.method,"POST");
    const body=JSON.parse(options.body);
    assert.deepEqual(body,{
      mode:"ALIGN_PROD_2026",
      secret:env().MEMBER_ACCOUNT_DELETION_REPORTING_SECRET,
      action:"anonymize_account",
      username:member.username,
      stripeCustomerId:member.customerId,
    });
    return Response.json(success);
  });
  assert.equal(called,1);
  assert.deepEqual(result,{ok:true,counts:success.counts});
});

test("disabled external reporting never contacts service",async()=>{
  const e=env();e.MEMBER_ACCOUNT_DELETION_REPORTING_ENABLED="false";
  let calls=0;
  await assert.rejects(eraseAccountReporting(e,member,()=>{calls++;throw Error("Unexpected network");}),
    /anonimización externa es obligatoria/);
  assert.equal(calls,0);
});

test("live mode, missing secrets, non-Apps-Script URLs and invalid accounts fail closed",async()=>{
  const bad=[
    {...env(),STRIPE_MODE:"live"},
    {...env(),MEMBER_ACCOUNT_DELETION_REPORTING_SECRET:""},
    {...env(),MEMBER_ACCOUNT_DELETION_REPORTING_URL:"http://script.google.com/macros/s/test/exec"},
    {...env(),MEMBER_ACCOUNT_DELETION_REPORTING_URL:"https://evil.example.test/steal"},
    {...env(),MEMBER_ACCOUNT_DELETION_REPORTING_URL:"https://script.google.com/macros/s/test/exec?leak=1"},
  ];
  for(const e of bad){
    await assert.rejects(eraseAccountReporting(e,member,()=>{throw Error("No network expected")}));
  }
  await assert.rejects(eraseAccountReporting(env(),{...member,customerId:""}));
});

test("network errors and unconfirmed or malformed reporting responses fail closed",async()=>{
  for(const data of [
    {ok:true,anonymized:false,counts:success.counts},
    {ok:false,anonymized:true,counts:success.counts},
    {ok:true,anonymized:true},
    {ok:true,anonymized:true,counts:{...success.counts,pagos:"1"}},
  ])await assert.rejects(eraseAccountReporting(env(),member,async()=>Response.json(data)));
  await assert.rejects(eraseAccountReporting(env(),member,async()=>Response.json({error:"offline"},{status:503})));
  await assert.rejects(eraseAccountReporting(env(),member,async()=>{throw Error("timeout")}));
});
