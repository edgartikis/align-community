import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { walletRoute, rewriteWalletAllyRequest } from "../src/apple-wallet.js";

const HOST="https://api.alignmembers.com.mx";
const MEMBER_ORIGIN="https://alignmembers.com.mx";
const TOKEN="f".repeat(64);
const ID="abcdef0123456789abcdef0123456789";
const FROM=new Date(Date.now()-3600000).toISOString();

function fixture() {
  const groupId="grp_owner_fixture";
  const member={
    integranteId:"OWNER-EDGAR-1",token:TOKEN,memberCode:"AL-FOUNDER-001",
    name:"Edgar Cordero",level:"Founder Lifetime",status:"Activa",
    membershipType:"owner_lifetime",ownerComplimentary:true,groupId,
    validFrom:FROM,validUntil:"9999-12-31T23:59:59.000Z"
  };
  const records=new Map([
    ["member:"+TOKEN,JSON.stringify(member)],
    ["wallet:id:"+ID,TOKEN],
    ["wallet:member:"+member.memberCode,ID],
    ["owner-lifetime:primary",JSON.stringify({username:"edgar.cordero",groupId,memberCode:member.memberCode})],
    ["account:edgar.cordero",JSON.stringify({username:"edgar.cordero",groupId,
      primaryToken:TOKEN,tokens:[TOKEN],membershipType:"owner_lifetime"})],
    ["group:"+groupId,JSON.stringify({groupId,tokens:[TOKEN],
      membershipType:"owner_lifetime",ownerComplimentary:true})]
  ]);
  const PAYMENT_STATE={
    get:async key=>records.get(key)||null,
    put:async(key,value)=>records.set(key,value),
    delete:async key=>records.delete(key)
  };
  const env={
    PAYMENT_STATE,
    WALLET_ENABLED:"false",WALLET_OWNER_ENABLED:"true",
    WALLET_PILOT_ENABLED:"false",WALLET_PILOT_EXPIRES_AT:new Date(Date.now()-3600000).toISOString(),
    WALLET_TEAM_ID:"TEAM",WALLET_SIGNER_CERT_PEM:"fake",WALLET_SIGNER_KEY_PEM:"fake",WALLET_WWDR_PEM:"fake"
  };
  return {env,member,records};
}
const verify=(id=ID)=>new Request(HOST+"/api/wallet/verify/"+id);
const scan=()=>new Request(HOST+"/api/ally/scan",{
  method:"POST",
  headers:{"content-type":"application/json","authorization":"Bearer active-ally"},
  body:JSON.stringify({qr:HOST+"/api/wallet/verify/"+ID,allyKey:"gingers"})
});
const issue=(token=TOKEN,origin=MEMBER_ORIGIN,host=HOST)=>new Request(host+"/api/wallet/owner",{
  method:"POST",headers:{"origin":origin,"content-type":"application/x-www-form-urlencoded"},
  body:new URLSearchParams({token})
});

test("Owner flag is OFF in both production defaults and isolated preview",()=>{
  const toml=readFileSync(new URL("../wrangler.toml",import.meta.url),"utf8");
  const prod=toml.split("[vars]")[1].split("[previews]")[0];
  const preview=toml.split("[previews.vars]")[1].split("[[previews.kv_namespaces]]")[0];
  for(const vars of [prod,preview]){
    assert.match(vars,/WALLET_ENABLED\s*=\s*"false"/);
    assert.match(vars,/WALLET_OWNER_ENABLED\s*=\s*"false"/);
  }
});
test("Private owner recovery form POSTs session token in body, not in URL",()=>{
  const html=readFileSync(new URL("../../../wallet-owner.html",import.meta.url),"utf8");
  assert.match(html,/<meta name="referrer" content="origin">/);
  assert.match(html,/<form[^>]*method="POST"[^>]*action="https:\/\/api\.alignmembers\.com\.mx\/api\/wallet\/owner"/);
  assert.match(html,/<input[^>]*name="token"[^>]*type="hidden"/);
  assert.match(html,/sessionStorage\.getItem\("align_member_token"\)/);
  assert.doesNotMatch(html,/location\.search|URLSearchParams\(location/);
});
test("Founder QR remains verifiable after pilot expires, while general issuance stays OFF",async()=>{
  const {env}=fixture();
  assert.equal((await walletRoute(new Request(HOST+"/api/wallet/status"),env)).status,200);
  assert.equal((await (await walletRoute(new Request(HOST+"/api/wallet/status"),env)).json()).available,false);
  const verified=await walletRoute(verify(),env);
  assert.equal(verified.status,200);
  const html=await verified.text();
  assert.match(html,/Edgar Cordero/);
  assert.match(html,/AL-FOUNDER-001/);
  assert.doesNotMatch(html,new RegExp(TOKEN));
  assert.equal(verified.headers.get("cache-control"),"no-store");
  assert.equal((await walletRoute(new Request(HOST+"/api/wallet/apple?token="+TOKEN),env)).status,503);
});
test("All owner routes fail closed when the owner-specific switch is OFF",async()=>{
  const {env}=fixture();env.WALLET_OWNER_ENABLED="false";
  assert.equal((await walletRoute(verify(),env)).status,403);
  assert.equal((await walletRoute(issue(),env)).status,404);
  const original=scan();
  assert.equal(await rewriteWalletAllyRequest(original,env,{fetch:async()=>{throw Error("unexpected");}}),original);
});
test("Owner QR translates to a fresh rotating QR on every ally scan even after pilot expiry",async()=>{
  const {env}=fixture();
  let calls=0;
  const apiWorker={fetch:async request=>{
    calls++;
    assert.match(request.url,/\/api\/monthly-qr\?token=/);
    return Response.json({validationUrl:HOST+"/api/validate-member?code=rotating-"+calls});
  }};
  const one=await rewriteWalletAllyRequest(scan(),env,apiWorker);
  const two=await rewriteWalletAllyRequest(scan(),env,apiWorker);
  assert.match((await one.json()).qr,/rotating-1/);
  assert.match((await two.json()).qr,/rotating-2/);
  assert.equal(calls,2);
});
test("Revoke or expire owner membership immediately blocks verification and ally scans",async()=>{
  for(const patch of [{status:"Inactiva"},{status:"Pago pendiente"},{validUntil:new Date(Date.now()-5000).toISOString()}]){
    const {env,records,member}=fixture();
    records.set("member:"+TOKEN,JSON.stringify({...member,...patch}));
    const res=await walletRoute(verify(),env);
    assert.equal(res.status,403);
    const html=await res.text();
    assert.doesNotMatch(html,/Edgar Cordero|AL-FOUNDER-001/);
    const original=scan();
    const rewritten=await rewriteWalletAllyRequest(original,env,{fetch:async()=>{throw Error("must not fetch");}});
    assert.equal(rewritten,original);
  }
});
test("Missing or altered canonical owner marker/account/group blocks owner QR",async()=>{
  for(const key of ["owner-lifetime:primary","account:edgar.cordero","group:grp_owner_fixture"]){
    const {env,records}=fixture();
    records.delete(key);
    assert.equal((await walletRoute(verify(),env)).status,403,key);
    const original=scan();
    assert.equal(await rewriteWalletAllyRequest(original,env,{fetch:async()=>{throw Error("must not fetch");}}),original);
  }
  const {env,records}=fixture();
  records.set("account:edgar.cordero",JSON.stringify({username:"edgar.cordero",
    groupId:"grp_owner_fixture",primaryToken:"x".repeat(64),tokens:["x".repeat(64)]}));
  assert.equal((await walletRoute(verify(),env)).status,403);
});
test("Unrelated active members cannot use the permanent owner exception",async()=>{
  const {env,records,member}=fixture();
  const otherToken="b".repeat(64),otherId="0".repeat(32);
  records.set("wallet:id:"+otherId,otherToken);
  records.set("member:"+otherToken,JSON.stringify({...member,token:otherToken,
    integranteId:"MEMBER-2",membershipType:"standard",ownerComplimentary:false,
    memberCode:"AL-BRO-0002",name:"Otro socio"}));
  const res=await walletRoute(verify(otherId),env);
  assert.equal(res.status,403);
  assert.doesNotMatch(await res.text(),/Otro socio/);
  assert.equal((await walletRoute(issue(otherToken),env)).status,403);
});
test("Owner reissue is not possible from foreign Origin or Preview or missing signing credentials",async()=>{
  const {env}=fixture();
  assert.equal((await walletRoute(issue(TOKEN,"https://evil.example"),env)).status,403);
  assert.equal((await walletRoute(issue(TOKEN,"null"),env)).status,403);
  assert.equal((await walletRoute(issue(TOKEN,MEMBER_ORIGIN,"https://feature-apple-wallet-align-align-payments.alignservice18.workers.dev"),env)).status,404);
  assert.equal((await walletRoute(issue(TOKEN,MEMBER_ORIGIN),{...env,WALLET_SIGNER_CERT_PEM:""})).status,404);
  const jsonRequest=new Request(HOST+"/api/wallet/owner",{
    method:"POST",headers:{"origin":MEMBER_ORIGIN,"content-type":"text/plain"},body:TOKEN
  });
  assert.equal((await walletRoute(jsonRequest,env)).status,415);
});
test("Owner reissue remains limited to the canonical account despite a valid bearer token",async()=>{
  const {env,records,member}=fixture();
  records.set("member:"+TOKEN,JSON.stringify({...member,ownerComplimentary:false}));
  assert.equal((await walletRoute(issue(),env)).status,403);
  records.set("member:"+TOKEN,JSON.stringify(member));
  records.delete("owner-lifetime:primary");
  assert.equal((await walletRoute(issue(),env)).status,403);
});
