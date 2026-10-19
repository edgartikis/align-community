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
const USERNAME="qa.delete.fixture";
const createdKeys=[];
let groupId="";

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
  assert.match(preview,/MEMBER_ACCOUNT_DELETION_TEST_USERNAME = "qa\.delete\.fixture"/);
  assert.match(preview,/MEMBER_LOGIN_GUARD = "true"/);
  assert.match(preview,/MEMBER_PASSWORD_V2 = "true"/);
  assert.match(preview,/ALIGN_APP_QR_ROTATION_ENABLED = "true"/);
  assert.ok(new URL(BASE).hostname.endsWith(".workers.dev"));
}
function kvRun(action,key,value){
  // Explicit namespace ID: NEVER use implicit or configured production binding.
  assert.ok(key.startsWith("account:"+USERNAME) ||
    (groupId && key.startsWith("group:"+groupId)) ||
    (groupId && key.startsWith("member:")) ||
    (groupId && key.startsWith("deleted-group:"+groupId)));
  const args=["wrangler","kv","key",action,key];
  if(action==="put")args.push(value);
  args.push("--namespace-id",PREVIEW_KV,"--remote","--config",config);
  if(action==="put") args.push("--ttl","3600");
  return spawnSync("npx",args,{cwd:root,encoding:"utf8",timeout:90000,maxBuffer:512*1024});
}
function kvPut(key,record){
  const result=kvRun("put",key,JSON.stringify(record));
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
  if(kvRead("account:"+USERNAME) || (await api("/api/member-login-v2",{
    username:USERNAME,password:"not-a-valid-password",
  })).status===429){
    throw Error("La cuenta QA ya existe o Preview bloqueó los intentos. No se sobrescribió.");
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
  kvPut("group:"+groupId,{groupId,tokens:[token],planKey:"brotherhood",membershipType:"synthetic_test"});
  kvPut("account:"+USERNAME,{
    version:1,username:USERNAME,passwordHash:createHash("sha256").update(password).digest("hex"),
    groupId,primaryToken:token,tokens:[token],createdAt:now,
  });
  console.log("✓ Cuenta ficticia creada exclusivamente en KV Preview; sin suscripción Stripe.");
  let login;
  for(let i=0;i<12;i++){
    login=await api("/api/member-login-v2",{username:USERNAME,password});
    if(login.status===200)break;
    if(![401,404,503].includes(login.status))break;
    await sleep(5000); // KV propagation across regions
  }
  assert.equal(login.status,200,"Preview no aceptó la cuenta temporal; comprueba que el despliegue es el nuevo.");
  assert.equal(login.data.primary?.status,"Activa");
  const bearer=login.data.sessionToken;
  assert.ok(typeof bearer==="string" && bearer.length>=40);
  const wrong=await api("/api/member-account/delete",{confirmation:"ELIMINAR",password:"incorrecta"},bearer);
  assert.equal(wrong.status,401,"Una contraseña equivocada no debe permitir borrar.");
  assert.ok(kvRead("account:"+USERNAME),"La cuenta debe seguir intacta tras un intento fallido.");
  const deleted=await api("/api/member-account/delete",{confirmation:"ELIMINAR",password},bearer);
  assert.equal(deleted.status,200,"Falló la solicitud de eliminación en Preview (HTTP "+deleted.status+").");
  assert.equal(deleted.data.status,"deleted");
  console.log("✓ El servidor aceptó la eliminación tras dos confirmaciones y contraseña.");
  await sleep(3000);
  assert.equal(kvRead("account:"+USERNAME),null,"Cloudflare KV aún conserva la cuenta.");
  assert.equal(kvRead("group:"+groupId),null,"Cloudflare KV aún conserva el grupo.");
  assert.equal(kvRead("member:"+token),null,"Cloudflare KV aún conserva la tarjeta.");
  const second=await api("/api/member-login-v2",{username:USERNAME,password});
  assert.equal(second.status,401,"No se debe poder volver a entrar después del borrado.");
  console.log("✓ Cuenta, tarjetas y acceso revocados; segundo login rechazado.");
  // Discard only the synthetic QA tombstone; no activation was created.
  kvDelete("deleted-group:"+groupId);
  console.log("✓ PRUEBA PREVIEW COMPLETADA. Stripe Live y los socios reales permanecen intactos.");
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
