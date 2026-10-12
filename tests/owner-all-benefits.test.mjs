import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import entryWorker from "../cloudflare/payments-worker/src/entry.js";
import allyWorker, { ownerHasAllBenefits } from "../cloudflare/payments-worker/src/entry-visits.js";

const API="https://api.alignmembers.com.mx";
const TOKEN="a".repeat(64);
const OWNER_VISIT="Visita Founder Lifetime · sin descuento configurado";

function fixture(){
  const groupId="grp_owner_all_benefits_test";
  const now=new Date(Date.now()-3600000).toISOString();
  const member={
    token:TOKEN,integranteId:"OWNER-EDGAR-1",memberCode:"AL-FOUNDER-001",
    name:"Edgar Cordero",level:"Founder Lifetime",planKey:"owner",
    membershipType:"owner_lifetime",ownerComplimentary:true,
    groupId,status:"Activa",validFrom:now,joinedAt:now,validUntil:"9999-12-31T23:59:59.000Z"
  };
  const records=new Map([
    ["member:"+TOKEN,JSON.stringify(member)],
    ["owner-lifetime:primary",JSON.stringify({username:"edgar.cordero",groupId,memberCode:"AL-FOUNDER-001"})],
    ["account:edgar.cordero",JSON.stringify({username:"edgar.cordero",groupId,primaryToken:TOKEN,tokens:[TOKEN]})],
    ["group:"+groupId,JSON.stringify({groupId,tokens:[TOKEN],membershipType:"owner_lifetime",ownerComplimentary:true})]
  ]);
  const kv={get:async k=>records.get(k)||null,put:async(k,v)=>{records.set(k,v)},delete:async k=>{records.delete(k)}};
  const env={PAYMENT_STATE:kv,STRIPE_MODE:"test",STRIPE_SECRET_KEY:"sk_test_local_only_unrelated_to_live_billing"};
  return {records,member,env};
}
function allySession(env,allyId="ALI-010"){
  const payload=Buffer.from(JSON.stringify({allyId,exp:Date.now()+3600000,nonce:"fixture"})).toString("base64url");
  const signature=createHmac("sha256",env.STRIPE_SECRET_KEY).update("ally-session:"+payload).digest("base64url");
  return payload+"."+signature;
}
async function currentQr(env,token=TOKEN){
  const r=await entryWorker.fetch(new Request(API+"/api/monthly-qr?token="+token),env);
  assert.equal(r.status,200);
  return (await r.json()).validationUrl;
}
function req(path,env,body){
  return new Request(API+path,{method:"POST",
    headers:{"content-type":"application/json",authorization:"Bearer "+allySession(env)},
    body:JSON.stringify(body)
  });
}

test("Official owner alone has access to every partner benefit",async()=>{
  const {env,member,records}=fixture();
  assert.equal(await ownerHasAllBenefits(env,TOKEN,member),true);
  for(const key of ["owner-lifetime:primary","account:edgar.cordero","group:"+member.groupId]){
    const entry=records.get(key);
    records.delete(key);
    assert.equal(await ownerHasAllBenefits(env,TOKEN,member),false,key);
    records.set(key,entry);
  }
  for(const patch of [
    {status:"Inactiva"},{status:"Pago pendiente"},{ownerComplimentary:false},
    {membershipType:"standard"},{memberCode:"AL-BRO-1234"},
    {integranteId:"NOT-OWNER"},{token:"b".repeat(64)},
    {validUntil:new Date(Date.now()-1000).toISOString()}
  ])assert.equal(await ownerHasAllBenefits(env,TOKEN,{...member,...patch}),false,JSON.stringify(patch));
  const impersonator={...member,planKey:"owner"};
  assert.equal(await ownerHasAllBenefits(env,"b".repeat(64),impersonator),false,"fake owner plan rejected");
});

test("Real ally scanner reports canonical owner access for Marea Baja",async()=>{
  const {env}=fixture();
  const qr=await currentQr(env);
  const response=await allyWorker.fetch(req("/api/ally/scan",env,{qr,allyKey:"marea"}),env);
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(data.member.ownerAllBenefits,true);
  assert.equal(data.member.planKey,"owner");
  assert.equal(data.member.memberCode,"AL-FOUNDER-001");
  assert.equal(data.ally.key,"marea");
});

test("Owner access-only visit records no invented monetary discount",async()=>{
  const {env,records}=fixture();
  const qr=await currentQr(env);
  const body={qr,allyKey:"marea",people:1,gross:350,spent:350,benefit:OWNER_VISIT,clientVisitId:"owner-test-visit"};
  const response=await allyWorker.fetch(req("/api/ally/visit",env,body),env);
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(data.visit.saved,0);
  assert.equal(data.visit.spent,350);
  assert.equal(data.visit.benefit,OWNER_VISIT);
  assert.equal(records.has("visit:"+data.visit.visitId),true);
});

test("Without a configured partner discount, owner cannot fabricate savings",async()=>{
  const {env}=fixture();
  const qr=await currentQr(env);
  const response=await allyWorker.fetch(req("/api/ally/visit",env,{
    qr,allyKey:"marea",gross:350,spent:200,benefit:OWNER_VISIT
  }),env);
  assert.equal(response.status,400);
});

test("Normal members and fake owner plans cannot use owner access-only visits",async()=>{
  const {env,records,member}=fixture();
  const other="b".repeat(64);
  records.set("member:"+other,JSON.stringify({...member,token:other,integranteId:"NORMAL-1",
    memberCode:"AL-BRO-1111",membershipType:"standard",ownerComplimentary:false,
    planKey:"owner"}));
  const qr=await currentQr(env,other);
  const scan=await allyWorker.fetch(req("/api/ally/scan",env,{qr,allyKey:"marea"}),env);
  assert.equal(scan.status,200);
  assert.equal((await scan.json()).member.ownerAllBenefits,false);
  const visit=await allyWorker.fetch(req("/api/ally/visit",env,{
    qr,allyKey:"marea",gross:350,spent:350,benefit:OWNER_VISIT
  }),env);
  assert.equal(visit.status,400);
});

test("Both owner portals list all registered allies, including pending offers",()=>{
  const source=readFileSync(new URL("../cloudflare/payments-worker/src/entry-visits.js",import.meta.url),"utf8");
  const registered=[...source.matchAll(/"ALI-\d+": \{ key: "([^"]+)"/g)].map(x=>x[1]);
  assert.ok(registered.length>=23);
  for(const file of ["portal.html","package-allies.html"]){
    const html=readFileSync(new URL("../"+file,import.meta.url),"utf8");
    const section=html.slice(html.indexOf("const ALLIES={"),html.indexOf("const PLANS={"));
    const keys=[...section.matchAll(/\b([a-z][a-z0-9]*):\{name:/g)].map(x=>x[1]);
    const missing=registered.filter(key=>!keys.includes(key));
    assert.deepEqual(missing,[],file+" must not omit officially registered allies");
    assert.match(html,/owner:\{title:'Founder Lifetime · Propietario',.*allies:Object\.keys\(ALLIES\)/);
  }
});

test("Real ally portal allows only backend-confirmed owner to bypass plan filter",()=>{
  const html=readFileSync(new URL("../portal-aliados.html",import.meta.url),"utf8");
  assert.match(html,/scanned\.ownerAllBenefits===true/);
  assert.match(html,/founderAccess\|\|offer\.plans\.includes\(plan\)/);
  assert.match(html,/OWNER_NO_PROMO/);
  assert.match(html,/mode:'access'/);
  // Parse HTML inline scripts for syntax correctness without a browser.
  const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(x=>x[1]).filter(x=>x.trim());
  for(const code of scripts)assert.doesNotThrow(()=>new Script(code));
});
