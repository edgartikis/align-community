import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { walletRoute, rewriteWalletAllyRequest, walletQrUrl } from "../src/apple-wallet.js";

test("Wallet remains unavailable without signing secrets and opt-in", async () => {
  const response = await walletRoute(new Request("https://api.alignmembers.com.mx/api/wallet/status"), {});
  assert.equal(response.status, 200);
  assert.equal((await response.json()).available, false);
  assert.equal(response.headers.get("cache-control"), "no-store");
});
test("Wallet does not return an unsigned pass", async () => {
  const response = await walletRoute(new Request("https://api.alignmembers.com.mx/api/wallet/apple?token=example"), {});
  assert.equal(response.status, 503);
});
test("Payments and existing QR routes bypass Wallet", async () => {
  assert.equal(await walletRoute(new Request("https://api.alignmembers.com.mx/api/checkout"),{}), null);
  assert.equal(await walletRoute(new Request("https://api.alignmembers.com.mx/api/monthly-qr"),{}), null);
});
test("Ally scan request is unchanged while Wallet is disabled", async () => {
  const request = new Request("https://api.alignmembers.com.mx/api/ally/scan",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({qr:"https://api.alignmembers.com.mx/api/wallet/verify/11111111111111111111111111111111"})});
  const next=await rewriteWalletAllyRequest(request,{},null);
  assert.equal(next,request);
});
test("Unknown Wallet QR never validates as an active membership", async () => {
  const env={PAYMENT_STATE:{get:async()=>null}};
  const response=await walletRoute(new Request("https://api.alignmembers.com.mx/api/wallet/verify/11111111111111111111111111111111"),env);
  assert.equal(response.status,403);
});


test("Preview KV binding never points to the production namespace", () => {
  const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  const prod = toml.match(/\[\[kv_namespaces\]\]\s*binding\s*=\s*"PAYMENT_STATE"\s*id\s*=\s*"([0-9a-f]{32})"/);
  const preview = toml.match(/\[\[previews\.kv_namespaces\]\]\s*binding\s*=\s*"PAYMENT_STATE"\s*id\s*=\s*"([0-9a-f]{32})"/);
  assert.ok(prod, "Production KV binding must be explicit");
  assert.ok(preview, "Preview KV binding must be explicit");
  assert.notEqual(prod[1], preview[1], "Never reuse production KV in previews");
  const productionVars = toml.split("[vars]")[1].split("[previews]")[0];
  const previewVars = toml.split("[previews.vars]")[1].split("[[previews.kv_namespaces]]")[0];
  assert.match(productionVars, /WALLET_ENABLED\s*=\s*"false"/);
  assert.match(previewVars, /WALLET_ENABLED\s*=\s*"false"/);
});

test("Wallet QR uses Preview origin and never redirects testing scans to live API", () => {
  const url="https://feature-apple-wallet-align-align-payments.alignservice18.workers.dev/api/wallet/apple";
  const id="11111111111111111111111111111111";
  assert.equal(walletQrUrl(url,id), "https://feature-apple-wallet-align-align-payments.alignservice18.workers.dev/api/wallet/verify/"+id);
  assert.equal(walletQrUrl("https://api.alignmembers.com.mx/api/wallet/apple",id),"https://api.alignmembers.com.mx/api/wallet/verify/"+id);
  assert.throws(()=>walletQrUrl("https://evil.example/api/wallet/apple",id));
});

test("Old Preview photo-test URL skips upload and opens Wallet for active members",async()=>{
  const token="a".repeat(48);
  const origin="https://feature-apple-wallet-align-align-payments.alignservice18.workers.dev";
  const url=origin+"/api/wallet/photo-test?token="+token;
  const record={
    status:"Activa",name:"SOCIO PRUEBA",memberCode:"ALIGN-TEST-0001",
    validFrom:new Date(Date.now()-3600000).toISOString(),
    validUntil:new Date(Date.now()+3600000).toISOString()
  };
  const env={
    WALLET_ENABLED:"true",WALLET_TEAM_ID:"TEAM",
    WALLET_SIGNER_CERT_PEM:"fake",WALLET_SIGNER_KEY_PEM:"fake",WALLET_WWDR_PEM:"fake",
    PAYMENT_STATE:{get:async(key)=>key==="member:"+token?JSON.stringify(record):null}
  };
  const result=await walletRoute(new Request(url),env);
  assert.equal(result.status,303);
  assert.equal(result.headers.get("location"),"/api/wallet/apple?token="+token);
  assert.equal(result.headers.get("referrer-policy"),"no-referrer");
  assert.equal(await result.text(),"","No photo upload page should be exposed");
  const rejected=await walletRoute(new Request(origin+"/api/wallet/photo-test?token="+"b".repeat(48)),env);
  assert.equal(rejected.status,403);
  const production=await walletRoute(new Request("https://api.alignmembers.com.mx/api/wallet/photo-test?token="+token),env);
  assert.equal(production,null);
});

test("A production Wallet QR reads a REAL active member from PAYMENT_STATE",async()=>{
  const id="abcdef0123456789abcdef0123456789";
  const token="a".repeat(48);
  const member={status:"Activa",name:"SOCIO REAL ALIGN",level:"Cowboys",memberCode:"AL-COW-AB1234",
    validFrom:new Date(Date.now()-3600000).toISOString(),validUntil:new Date(Date.now()+86400000).toISOString()};
  const env={PAYMENT_STATE:{get:async key=>key==="wallet:id:"+id?token:key==="member:"+token?JSON.stringify(member):null}};
  const response=await walletRoute(new Request("https://api.alignmembers.com.mx/api/wallet/verify/"+id),env);
  assert.equal(response.status,200);
  assert.match(await response.text(),/SOCIO REAL ALIGN/);
  assert.equal(response.headers.get("referrer-policy"),"no-referrer");
});

test("An unpaid or cancelled member is rejected even if their Wallet pass remains saved",async()=>{
  const id="abcdef0123456789abcdef0123456789",token="b".repeat(48);
  for(const status of ["Inactiva","Pago pendiente"]){
    const member={status,name:"SOCIO",validFrom:new Date(Date.now()-3600000).toISOString(),validUntil:new Date(Date.now()+86400000).toISOString()};
    const env={PAYMENT_STATE:{get:async key=>key==="wallet:id:"+id?token:key==="member:"+token?JSON.stringify(member):null}};
    const response=await walletRoute(new Request("https://api.alignmembers.com.mx/api/wallet/verify/"+id),env);
    assert.equal(response.status,403);
  }
});

test("Ally scan rewrites a live Wallet QR to the CURRENT rotating member QR without accepting previews",async()=>{
  const id="abcdef0123456789abcdef0123456789",token="a".repeat(48),activeMember={
    name:"SOCIO REAL",memberCode:"AL-BRO-123456",status:"Activa",
    validFrom:new Date(Date.now()-1000).toISOString(),validUntil:new Date(Date.now()+86400000).toISOString()};
  const env={WALLET_ENABLED:"true",WALLET_TEAM_ID:"APPLETEAM",
    WALLET_SIGNER_CERT_PEM:"cert",WALLET_SIGNER_KEY_PEM:"key",WALLET_WWDR_PEM:"wwdr",
    PAYMENT_STATE:{get:async key=>key==="wallet:id:"+id?token:key==="member:"+token?JSON.stringify(activeMember):null}};
  const original=new Request("https://api.alignmembers.com.mx/api/ally/scan",{
    method:"POST",headers:{"content-type":"application/json","authorization":"Bearer fake-ally-session"},
    body:JSON.stringify({qr:"https://api.alignmembers.com.mx/api/wallet/verify/"+id,allyKey:"gingers"})});
  let calls=0;
  const apiWorker={fetch:async request=>{
    calls++;
    assert.match(request.url,/\/api\/monthly-qr\?token=/);
    return Response.json({validationUrl:"https://api.alignmembers.com.mx/q/mock-current-code"});
  }};
  const rewritten=await rewriteWalletAllyRequest(original,env,apiWorker);
  assert.notEqual(rewritten,original);
  assert.equal(calls,1);
  assert.equal((await rewritten.json()).qr,"https://api.alignmembers.com.mx/q/mock-current-code");
  assert.equal(rewritten.headers.get("authorization"),"Bearer fake-ally-session");
  const preview=new Request("https://api.alignmembers.com.mx/api/ally/scan",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({qr:"https://feature-apple-wallet-align-align-payments.alignservice18.workers.dev/api/wallet/verify/"+id})});
  const notRewritten=await rewriteWalletAllyRequest(preview,env,apiWorker);
  assert.equal(notRewritten,preview);
  assert.equal(calls,1);
});

test("Official production issuance rejects Preview TEST identities before attempting to sign",async()=>{
  const token="c".repeat(48);
  const record={status:"Activa",memberCode:"ALIGN-TEST-0001",name:"PRUEBA",
    validFrom:new Date(Date.now()-3600000).toISOString(),validUntil:new Date(Date.now()+86400000).toISOString()};
  const env={WALLET_ENABLED:"true",WALLET_TEAM_ID:"TEAM",WALLET_SIGNER_CERT_PEM:"cert",
    WALLET_SIGNER_KEY_PEM:"key",WALLET_WWDR_PEM:"wwdr",PAYMENT_STATE:{get:async key=>key==="member:"+token?JSON.stringify(record):null}};
  const response=await walletRoute(new Request("https://api.alignmembers.com.mx/api/wallet/apple?token="+token),env);
  assert.equal(response.status,403);
});
