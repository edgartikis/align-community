import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import memberLoginWorker from "../cloudflare/payments-worker/src/entry-member-login.js";
import memberApiWorker from "../cloudflare/payments-worker/src/entry.js";
import { walletRoute } from "../cloudflare/payments-worker/src/apple-wallet.js";

const API_ORIGIN="https://api.alignmembers.com.mx";
function setup(){
 const username="edgar.cordero",password="long-random-test-only-password-do-not-reuse";
 const token="b".repeat(64),groupId="grp_owner_mock",now=new Date(Date.now()-3600000).toISOString();
 const member={
   integranteId:"OWNER-EDGAR-1",token,memberCode:"AL-FOUNDER-001",name:"Edgar Cordero",
   email:"",phone:"",level:"Founder Lifetime",planKey:"owner",
   membershipType:"owner_lifetime",ownerComplimentary:true,status:"Activa",
   position:1,groupId,joinedAt:now,validFrom:now,validUntil:"9999-12-31T23:59:59.000Z",
   savings:0,photoUrl:""
 };
 const account={version:1,username,passwordHash:createHash("sha256").update(password).digest("hex"),
   groupId,primaryToken:token,tokens:[token],createdAt:now};
 const group={groupId,tokens:[token],membershipType:"owner_lifetime",ownerComplimentary:true};
 const records=new Map([
   ["member:"+token,JSON.stringify(member)],["account:"+username,JSON.stringify(account)],
   ["group:"+groupId,JSON.stringify(group)],
   ["owner-lifetime:primary",JSON.stringify({username,groupId,memberCode:member.memberCode})],
 ]);
 const kv={
   get:async key=>records.get(key)||null,
   put:async(key,value)=>records.set(key,value),
   delete:async(key)=>records.delete(key)
 };
 const env={PAYMENT_STATE:kv,STRIPE_SECRET_KEY:"sk_test_local_fake_legacy_qr_hmac",
   WALLET_ENABLED:"true",WALLET_TEAM_ID:"2WG8DN922L",
   WALLET_SIGNER_CERT_PEM:"unit-cert",WALLET_SIGNER_KEY_PEM:"unit-key",WALLET_WWDR_PEM:"unit-wwdr"};
 return {username,password,token,member,group,env,records};
}
test("Owner account logs into real member login without Stripe subscription",async()=>{
 const {username,password,token,env,records}=setup();
 const request=new Request(API_ORIGIN+"/api/member-login",{method:"POST",
   headers:{"origin":"https://alignmembers.com.mx","content-type":"application/json"},
   body:JSON.stringify({username,passwordHash:createHash("sha256").update(password).digest("hex")})});
 const response=await memberLoginWorker.fetch(request,env);
 assert.equal(response.status,200);
 const data=await response.json();
 assert.equal(data.ok,true);
 assert.equal(data.primary.token,token);
 assert.equal(data.primary.status,"Activa");
 assert.equal(data.primary.level,"Founder Lifetime");
 assert.equal(data.active,true);
 assert.equal(data.billingOnly,false);
 assert.ok(data.sessionToken);
 assert.equal([...records.keys()].some(k=>k.startsWith("subscription:")),false);
});
test("Lifetime owner billing returns no charges and refuses all billing actions",async()=>{
 const {username,password,env}=setup();
 const login=await memberLoginWorker.fetch(new Request(API_ORIGIN+"/api/member-login",{
   method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username,passwordHash:createHash("sha256").update(password).digest("hex")})
 }),env);
 const {sessionToken}=await login.json();
 const headers={"authorization":"Bearer "+sessionToken,"origin":"https://alignmembers.com.mx"};
 const response=await memberLoginWorker.fetch(new Request(API_ORIGIN+"/api/member-billing",{headers}),env);
 assert.equal(response.status,200);
 const billing=await response.json();
 assert.equal(billing.lifetime,true);
 assert.equal(billing.status,"lifetime");
 assert.equal(billing.periodEnd,null);
 assert.equal(billing.paymentMethod,null);
 for(const property of ["canCancel","canResume","canChangePayment","canResubscribe"]) assert.equal(billing[property],false);
 for(const action of ["resubscribe","change_payment","cancel","resume","confirm_payment"]){
   const denied=await memberLoginWorker.fetch(new Request(API_ORIGIN+"/api/member-billing",{
     method:"POST",headers:{...headers,"content-type":"application/json"},body:JSON.stringify({action})
   }),env);
   assert.equal(denied.status,403);
 }
});
test("Lifetime owner QR rotates every 15m and passes existing membership validation",async()=>{
 const {token,env}=setup();
 const qr=await memberApiWorker.fetch(new Request(API_ORIGIN+"/api/monthly-qr?token="+token),env);
 assert.equal(qr.status,200);
 const details=await qr.json();
 assert.equal(details.validUntil,"9999-12-31T23:59:59.000Z");
 assert.match(details.validationUrl,/\/api\/validate-member\?/);
 const verified=await memberApiWorker.fetch(new Request(details.validationUrl),env);
 assert.equal(verified.status,200);
 const html=await verified.text();
 assert.match(html,/Edgar Cordero/);
 assert.match(html,/AL-FOUNDER-001/);
 const changed={...env,PAYMENT_STATE:{...env.PAYMENT_STATE,get:async key=>
   key==="member:"+token?JSON.stringify({...setup().member,status:"Pago pendiente"}):env.PAYMENT_STATE.get(key)}};
 const invalid=await memberApiWorker.fetch(new Request(details.validationUrl),changed);
 assert.equal(invalid.status,403);
});
test("Wallet can validate the same owner identity without exposing member token in QR",async()=>{
 const {token,env,records}=setup(),id="0123456789abcdef0123456789abcdef";
 records.set("wallet:id:"+id,token);
 const response=await walletRoute(new Request(API_ORIGIN+"/api/wallet/verify/"+id),env);
 assert.equal(response.status,200);
 const body=await response.text();
 assert.match(body,/Edgar Cordero/);
 assert.doesNotMatch(body,new RegExp(token));
 const disabled=await walletRoute(new Request(API_ORIGIN+"/api/wallet/verify/"+id),{...env,WALLET_ENABLED:"false"});
 assert.equal(disabled.status,403);
});
test("Owner provisioning never ships an open public grant route or a payment request",()=>{
 const source=readFileSync(new URL("../scripts/provision-owner-lifetime.mjs",import.meta.url),"utf8");
 assert.match(source,/--remote/);
 assert.match(source,/owner-lifetime:primary/);
 assert.match(source,/bulk","put/);
 assert.doesNotMatch(source,/stripePost\(|checkout\/sessions|Stripe checkout/);
 const wrangler=readFileSync(new URL("../cloudflare/payments-worker/wrangler.toml",import.meta.url),"utf8");
 assert.match(wrangler,/WALLET_ENABLED\s*=\s*"false"/);
 assert.match(wrangler,/WALLET_PILOT_ENABLED\s*=\s*"false"/);
});
