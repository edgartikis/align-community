#!/usr/bin/env node
/**
 * ALIGN - one-time complimentary owner member provisioning.
 * Run ONLY on the owner's Mac after an authenticated Wrangler login.
 * NO remote endpoint, payment, access token or password is committed.
 *
 * Dry run: node scripts/provision-owner-lifetime.mjs
 * Create:  node scripts/provision-owner-lifetime.mjs --create
 *
 * WARNING: Output contains a ONE-TIME login password only after a successful
 * Cloudflare KV write. Do not paste or screenshot that password into chat.
 */
import { spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const toml = readFileSync(join(root, "cloudflare/payments-worker/wrangler.toml"), "utf8");
const match = toml.match(/\[\[kv_namespaces\]\]\s*binding\s*=\s*"PAYMENT_STATE"\s*id\s*=\s*"([a-f0-9]{32})"/);
const preview = toml.match(/\[\[previews\.kv_namespaces\]\]\s*binding\s*=\s*"PAYMENT_STATE"\s*id\s*=\s*"([a-f0-9]{32})"/);
if (!match || !preview || match[1] === preview[1]) throw Error("Falta un binding production KV separado de Preview");
const namespaceId = match[1];
const mode = process.argv.includes("--create") ? "create" : "check";
const usernameFlag = process.argv.indexOf("--username");
const username = usernameFlag < 0 ? "edgar.cordero" : process.argv[usernameFlag + 1];
if (!/^[a-z0-9._-]{4,24}$/.test(username || "")) throw Error("Usuario inválido");
if (process.argv.some(a => a.startsWith("--") && !["--create","--username"].includes(a))) throw Error("Argumento desconocido");
const name = "Edgar Cordero";
const code = "AL-FOUNDER-001";

function wrangler(args) {
  const call = spawnSync("npx", ["--no-install", "wrangler", ...args], {
    cwd: root, encoding: "utf8", maxBuffer: 3*1024*1024, timeout: 90000
  });
  if (call.error || call.status !== 0) {
    throw Error("Wrangler falló. Comprueba npm install y npx wrangler login en tu Mac. " +
      (call.error?.message || String(call.stderr||"").slice(0,450)));
  }
  return call.stdout || "";
}
function remoteList(prefix) {
  const output = wrangler(["kv","key","list","--namespace-id",namespaceId,"--remote","--prefix",prefix]);
  // Wrangler may prepend ANSI diagnostics and banners around JSON.
  const first=output.indexOf("[");
  const last=output.lastIndexOf("]");
  if (first < 0 || last < first) throw Error("No fue posible interpretar la lista de KV, operación cancelada");
  let list;
  try { list=JSON.parse(output.slice(first,last+1)); } catch { throw Error("Lista de KV no válida; operación cancelada"); }
  if (!Array.isArray(list) || !list.every(x => typeof x?.name === "string")) throw Error("Respuesta KV inesperada; operación cancelada");
  return list.map(x => x.name);
}

console.log("ALIGN · alta privada del propietario");
console.log("Usuario propuesto:",username);
console.log("Cuenta: una tarjeta Founder Lifetime, sin Stripe y sin pago.");
console.log("Entorno: Cloudflare KV remoto de Production; Preview excluido.");
console.log("Comprobando que aún no exista una cuenta de propietario o el mismo username...");
const ownerKeys = remoteList("owner-lifetime:");
const accountKeys = remoteList("account:"+username);
const groupKeys = remoteList("group:grp_owner_");
const sameAccount=accountKeys.includes("account:"+username);
if (ownerKeys.length || groupKeys.length || sameAccount) {
  throw Error("Hay una cuenta existente o indicios de propietario. No se sobrescribe nada; revisa en Cloudflare KV.");
}
console.log("Sin duplicados detectados. Es posible crear una cuenta nueva.");
if (mode !== "create") {
  console.log("MODO SIMULACIÓN. No se escribió nada.");
  console.log("Para crearla, ejecuta: node scripts/provision-owner-lifetime.mjs --create");
  process.exit(0);
}

if (!process.stdin.isTTY) throw Error("La creación requiere Terminal interactiva");
console.log("Escribe exactamente CREAR EDGAR para confirmar que eres el administrador de Cloudflare.");
process.stdout.write("> ");
const answer = (() => {
  const buf = Buffer.alloc(256); const bytes=process.stdin.read?.();
  return bytes ? bytes.toString("utf8").trim() : "";
})();
if (answer !== "CREAR EDGAR") {
  // Standard input may require readline in interactive terminals.
  throw Error("Confirmación no recibida. No se escribió nada.");
}
const token=randomBytes(32).toString("hex"); // 64-character private token
const groupId="grp_owner_"+randomUUID().replace(/-/g,"");
const password=randomBytes(32).toString("base64url"); // 43 characters
const hash=createHash("sha256").update(password).digest("hex"); // compatible with existing login page
const now=new Date().toISOString();
const member={
  integranteId:"OWNER-EDGAR-1",token,memberCode:code,name,
  email:"",phone:"",level:"Founder Lifetime",planKey:"owner",
  membershipType:"owner_lifetime",ownerComplimentary:true,status:"Activa",
  position:1,groupId,joinedAt:now,validFrom:now,
  // Existing rotating-QR validator requires real timestamps.
  // 9999 is its technical long-term bound; never create a Stripe subscription.
  validUntil:"9999-12-31T23:59:59.000Z",savings:0,photoUrl:""
};
const records=[
  {key:"member:"+token,value:JSON.stringify(member)},
  {key:"group:"+groupId,value:JSON.stringify({groupId,tokens:[token],membershipType:"owner_lifetime",ownerComplimentary:true})},
  {key:"account:"+username,value:JSON.stringify({version:1,username,passwordHash:hash,
    groupId,primaryToken:token,tokens:[token],createdAt:now,membershipType:"owner_lifetime"})},
  {key:"owner-lifetime:primary",value:JSON.stringify({username,groupId,memberCode:code,createdAt:now})}
];
const dir=mkdtempSync(join(tmpdir(),"align-owner-"));
try{
  const tmpFile=join(dir,"kv-owner.json");
  writeFileSync(tmpFile,JSON.stringify(records),{encoding:"utf8",flag:"wx",mode:0o600});
  console.log("Guardando cuatro registros en KV remoto. Sin Stripe.");
  wrangler(["kv","bulk","put",tmpFile,"--namespace-id",namespaceId,"--remote"]);
  console.log("\nÉXITO. Cuenta de propietario creada.");
  console.log("Usuario: "+username);
  console.log("Contraseña ÚNICA (guárdala en tu gestor de contraseñas): "+password);
  console.log("Código: "+code+" | Plan: Founder Lifetime | Costo: $0");
  console.log("Entra en https://alignmembers.com.mx/login.html");
  console.log("No compartas ni captures la contraseña, token de socio o archivos de KV.");
}finally {
  rmSync(dir,{recursive:true,force:true});
}
