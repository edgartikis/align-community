#!/usr/bin/env node
/**
 * Cloudflare Preview ONLY — end-to-end disposable membership deletion.
 * No Stripe subscription is created in this first acceptance stage.
 * A separate Stripe Test subscription test comes AFTER this passes.
 * Refuses production KV, live Stripe, unknown Preview usernames or existing fixtures.
 */
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const config=resolve(root,"cloudflare/payments-worker/wrangler.toml");
const text=readFileSync(config,"utf8");
const PREVIEW_KV="4b23fffb26264609b9f18f110baea954";
const LIVE_KV="4504d6bcead74cdfa7e3a76599f641fc";
const BASE="https://align-qr-pilot-align-payments.alignservice18.workers.dev";
const USERNAME="qa.delete.fixture2";
// Verified against Stripe TEST API; never accept a different customer or subscription here.
const QA_TEST_CUSTOMER="cus_VT7rpDV5GBjC6u";
const QA_TEST_SUBSCRIPTION="sub_1USSV1DMjEcJHlpUbTf9Sy6V";
// Stage 2 only: link a disposable Stripe TEST trial subscription ID, never live.
const args=process.argv.slice(2);
const reportingQa=args.includes("--reporting-qa");
const subscriptionIndex=args.indexOf("--stripe-test-sub");
const subId=subscriptionIndex>=0?String(args[subscriptionIndex+1]||""):"";
if(subscriptionIndex>=0 && !/^sub_[A-Za-z0-9]+$/.test(subId))
  throw Error("Especifica un ID sub_... válido de una suscripción Stripe Test.");
if(args.length!==(subscriptionIndex>=0?2:0)+(reportingQa?1:0))throw Error("Argumentos inesperados.");
if(reportingQa && subId!==QA_TEST_SUBSCRIPTION)throw Error("La prueba conjunta solo acepta la suscripción trialing del cliente QA previamente verificado.");
if(!reportingQa && subId===QA_TEST_SUBSCRIPTION)throw Error("La suscripción QA vinculada a Google Sheets exige --reporting-qa para anonimizar los registros antes de borrar KV.");
const createdKeys=[];
let groupId="";
let issuedSessionToken="";

function assertPreviewOnly(){
  const production=text.split("[vars]")[1]?.split("[previews]")[0] || "";
  const preview=text.split("[previews.vars]")[1]?.split("[[previews.kv_namespaces]]")[0] || "";
  const kv=text.split("[[previews.kv_namespaces]]")[1] || "";
  assert.notEqual(PREVIEW_KV,LIVE_KV);
  assert.match(kv,new RegExp('id\\s*=\\s*"'+PREVIEW_KV+'"'));
  assert.match(production,/STRIPE_MODE = "live"/);
  assert.match(production,/MEMBER_ACCOUNT_DELETION_ENABLED = "false"/);
  assert.match(preview,/STRIPE_MODE = "test"/);
  assert.match(preview,/MEMBER_ACCOUNT_DELETION_ENABLED = "true"/);
  // Keep the Preview allowlist assertion tied to the disposable account in this script.
  assert.ok(preview.includes(`MEMBER_ACCOUNT_DELETION_TEST_USERNAME = "${USERNAME}"`),
    "El usuario QA autorizado en Preview debe coincidir exactamente con el del script.");
  assert.match(preview,/MEMBER_LOGIN_GUARD = "true"/);
  assert.match(preview,/MEMBER_PASSWORD_V2 = "true"/);
  assert.match(preview,/ALIGN_APP_QR_ROTATION_ENABLED = "true"/);
  if(reportingQa){
    assert.match(preview,/MEMBER_ACCOUNT_DELETION_REPORTING_ENABLED = "true"/,
      "Activa el borrado de reportes solamente para la prueba Preview y despliega de nuevo.");
  }
  assert.ok(new URL(BASE).hostname.endsWith(".workers.dev"));
}
function kvRun(action,key,value){
  // Explicit namespace ID: NEVER use implicit or configured production binding.
  assert.ok(key.startsWith("account:"+USERNAME) ||
    (groupId && key.startsWith("group:"+groupId)) ||
    (groupId && key.startsWith("member:")) ||
    (groupId && key.startsWith("deleted-group:"+groupId)) ||
    (issuedSessionToken && key==="member-session:"+issuedSessionToken) ||
    (subId && key==="subscription:"+subId));
  const args=["wrangler","kv","key",action,key];
  if(action==="put")args.push(value);
  args.push("--namespace-id",PREVIEW_KV,"--remote","--config",config);
  if(action==="put") args.push("--ttl","3600");
  return spawnSync("npx",args,{cwd:root,encoding:"utf8",timeout:90000,maxBuffer:512*1024});
}
function kvPut(key,record,{raw=false}={}){
  const result=kvRun("put",key,raw?String(record):JSON.stringify(record));
  if(result.status!==0)throw Error("Cloudflare KV Preview no aceptó el registro ficticio ("+key.split(":")[0]+").");
  createdKeys.push(key);
}
function kvRead(key){
  const result=kvRun("get",key);
  if(result.status!==0)return null;
  return result.stdout.trim() || null;
}
function kvDelete(key) {
  const result=kvRun("delete",key);
  return result.status===0;
}
async function api(path,body,sessionToken){
  const response=await fetch(BASE+path,{
    method:"POST",
    headers:{"content-type":"application/json",...(sessionToken?{"authorization":"Bearer "+sessionToken}:{})},
    body:JSON.stringify(body),signal:AbortSignal.timeout(20000),
  });
  let data={};
  try{data=await response.json();}catch{}
  return {status:response.status,data};
}
async function sleep(ms){await new Promise(r=>setTimeout(r,ms))}
async function main(){
  assertPreviewOnly();
  console.log("✓ Configuración verificada: producción OFF; KV Preview separada; Stripe Test.");
  // Never probe a missing QA account by deliberately attempting a bad login:
  // doing so consumes the very login-attempt budget that this test needs.
  if(kvRead("account:"+USERNAME)){
    throw Error("La cuenta QA ya existe en Preview. No se sobrescribió.");
  }
  if(subId && kvRead("subscription:"+subId)){
    throw Error("La suscripción ya está vinculada a otra cuenta Preview. No se sobrescribió.");
  }
  groupId="grp_delete_preview_"+randomBytes(8).toString("hex");
  const token=randomBytes(32).toString("hex");
  const password="QA-"+randomBytes(20).toString("hex")+"!";
  const now=new Date().toISOString();
  const until=new Date(Date.now()+40*60*1000).toISOString();
  kvPut("member:"+token,{
    token,groupId,name:"QA Eliminación",memberCode:"QA-DELETE-"+randomBytes(4).toString("hex"),
    status:"Activa",level:"The Brotherhood",planKey:"brotherhood",position:1,
    joinedAt:now,validFrom:now,validUntil:until,savings:0,
  });
  kvPut("group:"+groupId,{groupId,tokens:[token],planKey:"brotherhood",membershipType:"synthetic_test",
    ...(reportingQa?{customerId:QA_TEST_CUSTOMER,subscriptionId:subId}:{})});
  kvPut("account:"+USERNAME,{
    version:1,username:USERNAME,passwordHash:createHash("sha256").update(password).digest("hex"),
    groupId,primaryToken:token,tokens:[token],createdAt:now,
  });
  if(subId)kvPut("subscription:"+subId,groupId,{raw:true});
  console.log(subId
    ? "✓ Cuenta ficticia de Preview vinculada a Stripe Test."
    : "✓ Cuenta ficticia creada exclusivamente en KV Preview; sin suscripción Stripe.");
  // Workers KV is eventually consistent across regions. A rapid retry loop
  // causes the Preview 5-attempt lockout even when the credentials are valid.
  console.log("⌛ Esperando 90 segundos a que la cuenta se propague en Cloudflare KV...");
  await sleep(90000);
  let login=await api("/api/member-login-v2",{username:USERNAME,password});
  if(login.status===401 || login.status===404){
    console.log("⌛ Aún no aparece en la región del Worker; esperamos 60 segundos (máximo un reintento).");
    await sleep(60000);
    login=await api("/api/member-login-v2",{username:USERNAME,password});
  }
  if(login.status===429){
    throw Error("Bloqueo de acceso temporal (429). No insistir: esperar 15 minutos y usar una cuenta QA nueva.");
  }
  assert.equal(login.status,200,"Preview no aceptó la cuenta temporal; HTTP "+login.status+". No volver a intentar de inmediato.");
  assert.equal(login.data.primary?.status,"Activa");
  const bearer=login.data.sessionToken;
  assert.ok(typeof bearer==="string" && bearer.length>=40);
  issuedSessionToken=bearer;
  createdKeys.push("member-session:"+issuedSessionToken);
  // Session token is stored in another KV key: let it propagate before using
  // it, otherwise a valid session may yield an unrelated 401 response.
  console.log("⌛ Esperando 65 segundos para verificar la sesión contra KV remota...");
  await sleep(65000);
  if(subId){
    const response=await fetch(BASE+"/api/member-billing",{
      headers:{authorization:"Bearer "+bearer},signal:AbortSignal.timeout(25000),
    });
    const billing=await response.json().catch(()=>({}));
    assert.equal(response.status,200,"Cloudflare no pudo consultar Stripe Test: HTTP "+response.status);
    assert.equal(billing.status,"trialing",
      "Stripe Test no reconoce la suscripción trialing vinculada; estado="+billing.status);
    assert.equal(billing.canCancel,true,"La suscripción Stripe Test debe permitir cancelación.");
    console.log("✓ Cloudflare consultó la suscripción trialing de Stripe Test.");
  }
  const wrong=await api("/api/member-account/delete",{confirmation:"ELIMINAR",password:"incorrecta"},bearer);
  assert.equal(wrong.status,401,"Una contraseña equivocada no debe permitir borrar (HTTP "+wrong.status+").");
  assert.match(String(wrong.data.error||""),/Contraseña incorrecta/,
    "El servidor debe rechazar la contraseña por autenticación, no por sesión vencida.");
  assert.ok(kvRead("account:"+USERNAME),"La cuenta debe seguir intacta tras un intento fallido.");
  const deleted=await api("/api/member-account/delete",{confirmation:"ELIMINAR",password},bearer);
  assert.equal(deleted.status,200,"Falló la solicitud de eliminación en Preview (HTTP "+deleted.status+").");
  assert.equal(deleted.data.status,"deleted");
  console.log("✓ El servidor aceptó la eliminación tras dos confirmaciones y contraseña.");
  // Account removals may take time to propagate to KV edge readers.
  console.log("⌛ Confirmando que la eliminación se propagó en Cloudflare KV...");
  let cleared=false;
  for(let i=0;i<10;i++){
    if(kvRead("account:"+USERNAME)===null &&
       kvRead("group:"+groupId)===null &&
       kvRead("member:"+token)===null){
      cleared=true;
      break;
    }
    await sleep(12000);
  }
  assert.ok(cleared,"Cloudflare KV aún conserva datos de la cuenta tras esperar la propagación.");
  if(subId)assert.equal(kvRead("subscription:"+subId),null,
    "Cloudflare KV aún conserva la vinculación de Stripe Test.");
  let second=await api("/api/member-login-v2",{username:USERNAME,password});
  if(second.status===200){
    // Account and tombstone visibility to the Worker can lag remote KV readers.
    await sleep(60000);
    second=await api("/api/member-login-v2",{username:USERNAME,password});
  }
  assert.equal(second.status,401,"No se debe poder volver a entrar después del borrado.");
  console.log("✓ Cuenta, tarjetas y acceso revocados; segundo login rechazado.");
  // Discard only the synthetic QA tombstone; no activation was created.
  kvDelete("deleted-group:"+groupId);
  console.log(reportingQa
    ? "✓ PRUEBA PREVIEW + GOOGLE SHEETS QA COMPLETADA. Comprueba en Sheets que solo qa.delete.fixture2 fue anonimizado."
    : subId
    ? "✓ PRUEBA PREVIEW + STRIPE TEST COMPLETADA. Verifica status=canceled en Stripe Test."
    : "✓ PRUEBA PREVIEW COMPLETADA. Stripe Live y los socios reales permanecen intactos.");
}
let ok=false;
try{
  await main();
  ok=true;
}catch(e){
  console.error("✗ TEST PREVIEW NO APROBADO: "+e.message);
  process.exitCode=1;
}finally{
  if(!ok && groupId){
    let failed=0;
    for(const key of [...createdKeys].reverse())if(!kvDelete(key))failed++;
    if(failed)console.error("⚠ No se pudieron retirar todos los registros ficticios. Revisar KV Preview.");
    else console.log("✓ Limpieza conservadora de registros temporales de Preview.");
  }
}
