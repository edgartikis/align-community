// ALIGN Apple Wallet - isolated prototype. Does not touch checkout/webhooks.
// Enable only after credentials, artwork and ally-scanner end-to-end tests.
import { PKPass } from "passkit-generator";
import { Buffer } from "node:buffer";

const API_HOST = "api.alignmembers.com.mx";
const ID = "pass.mx.com.alignmembers.membership";
const b64 = (value) => Buffer.from(String(value || "").replace(/\s/g, ""), "base64");
const okToken = (s) => /^[A-Za-z0-9_-]{20,140}$/.test(s);
const okId = (s) => /^[0-9a-f]{32}$/i.test(s);
const safe = (s, length=100) => String(s ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, length);
const escapeHtml = (s) => safe(s, 250).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const noCache = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
const json = (body, status=200) => Response.json(body, {status,headers:noCache});
const supported = (env) => env.WALLET_ENABLED === "true" && Boolean(env.PAYMENT_STATE && env.WALLET_TEAM_ID && env.WALLET_SIGNER_CERT_PEM && env.WALLET_SIGNER_KEY_PEM && env.WALLET_WWDR_PEM);
const period = (m) => {
  const from = m.validFrom || m.joinedAt || "";
  let until = m.validUntil || "";
  if (!until && from) { const d=new Date(from); if (!Number.isNaN(d.getTime())) { d.setUTCMonth(d.getUTCMonth()+1); until=d.toISOString(); } }
  return {from,until};
};
const active = (m) => {
  if (!m || m.status !== "Activa") return false;
  const p=period(m),from=Date.parse(p.from),until=Date.parse(p.until);
  return Number.isFinite(from)&&Number.isFinite(until)&&Date.now()>=from&&Date.now()<until;
};
async function getMember(env, token) {
  if (!okToken(token)) return null;
  const raw=await env.PAYMENT_STATE.get("member:"+token);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
async function tokenById(env, id) {
  if (!okId(id)) return null;
  const token=await env.PAYMENT_STATE.get("wallet:id:"+id);
  return okToken(token) ? token : null;
}
async function memberById(env,id) {
  const token=await tokenById(env,id);
  return token ? getMember(env,token) : null;
}
async function idForMember(env,token,member) {
  const code=safe(member.memberCode,60);
  if (!code) throw new Error("Missing member code");
  const key="wallet:member:"+code;
  let id=await env.PAYMENT_STATE.get(key);
  if (id && okId(id)) { await env.PAYMENT_STATE.put("wallet:id:"+id,token);return id; }
  id=crypto.randomUUID().replace(/-/g,"");
  await env.PAYMENT_STATE.put("wallet:id:"+id,token);
  await env.PAYMENT_STATE.put(key,id);
  return id;
}
async function imageFromSite(env,path) {
  const origin=String(env.SITE_ORIGIN || "https://alignmembers.com.mx").replace(/\/$/,"");
  const response=await fetch(origin+path, {redirect:"error"});
  if (!response.ok || !(response.headers.get("content-type")||"").includes("image/png")) throw new Error("Wallet PNG asset unavailable");
  const data=await response.arrayBuffer();
  if (!data.byteLength || data.byteLength>400000) throw new Error("Wallet image too large");
  return Buffer.from(data);
}
async function producePass(env,member,id) {
  const pass=new PKPass({},{
    wwdr:env.WALLET_WWDR_PEM,
    signerCert:env.WALLET_SIGNER_CERT_PEM,
    signerKey:env.WALLET_SIGNER_KEY_PEM,
    ...(env.WALLET_SIGNER_KEY_PASSPHRASE ? {signerKeyPassphrase:env.WALLET_SIGNER_KEY_PASSPHRASE}:{})
  },{
    formatVersion:1,
    passTypeIdentifier:ID,
    teamIdentifier:env.WALLET_TEAM_ID,
    serialNumber:id,
    organizationName:"ALIGN Membership",
    description:"Membresía ALIGN",
    logoText:"ALIGN",
    foregroundColor:"rgb(255,255,255)",
    backgroundColor:"rgb(16,35,62)",
    labelColor:"rgb(217,198,165)"
  });
  pass.type="storeCard";
  pass.primaryFields.push({key:"name",label:"SOCIO",value:safe(member.name)});
  pass.secondaryFields.push({key:"plan",label:"MEMBRESÍA",value:safe(member.level,60)});
  pass.auxiliaryFields.push({key:"code",label:"CÓDIGO",value:safe(member.memberCode,60)});
  pass.backFields.push({key:"verification",label:"VALIDACIÓN",value:"El aliado debe escanear el QR y comprobar fotografía, identidad y vigencia en el sistema ALIGN. Un pase guardado no garantiza membresía activa."});
  // Stable, non-secret, opaque pointer. The verifier reads CURRENT KV state.
  pass.setBarcodes({format:"PKBarcodeFormatQR",message:"https://"+API_HOST+"/api/wallet/verify/"+id,messageEncoding:"iso-8859-1",altText:safe(member.memberCode,60)});
  // Images are obtained from the existing public ALIGN asset host.
  // Before launch ensure production artwork meets Apple pixel-size requirements.
  const icon=await imageFromSite(env,"/assets/align-primary.png");
  const logo=await imageFromSite(env,"/assets/align-wordmark.png");
  pass.addBuffer("icon.png",icon);
  pass.addBuffer("icon@2x.png",icon);
  pass.addBuffer("logo.png",logo);
  pass.addBuffer("logo@2x.png",logo);
  return pass.getAsBuffer();
}
function verificationHtml(member) {
  const valid=active(member);
  const name=safe(member?.name);
  const photo=String(member?.photoUrl || "");
  const photoHtml=/^https:\/\/[^\s"'<>]+$/.test(photo) ? '<img src="'+escapeHtml(photo)+'" alt="Foto del socio" width="120" height="120" style="object-fit:cover;border-radius:20px">' : "";
  return new Response('<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Validación ALIGN</title><body style="background:#10233e;color:#fff;font:16px system-ui;text-align:center;padding:45px 20px"><main><h1>ALIGN MEMBERSHIP</h1><h2>'+ (valid?"Membresía activa":"Membresía no válida") +'</h2>' +(valid?photoHtml+'<p>'+escapeHtml(name)+'</p><p>'+escapeHtml(member.level)+'</p><p>'+escapeHtml(member.memberCode)+'</p><p>Comprueba fotografía e identidad antes de aplicar el beneficio.</p>':'<p>No aplicar el beneficio.</p>')+'</main></body></html>',{status:valid?200:403,headers:{...noCache,"content-type":"text/html; charset=utf-8","content-security-policy":"default-src 'none'; img-src https:; style-src 'unsafe-inline'"}});
}
export async function walletRoute(request,env) {
  const url=new URL(request.url),path=url.pathname;
  if (request.method==="GET" && path==="/api/wallet/status") return json({ok:true,available:supported(env),provider:"apple"});
  if (request.method==="GET" && /^\/api\/wallet\/verify\/[0-9a-f]{32}$/i.test(path)) {
    if (!env.PAYMENT_STATE) return verificationHtml(null);
    return verificationHtml(await memberById(env,path.split("/").pop()));
  }
  if (request.method==="GET" && path==="/api/wallet/apple") {
    if (!supported(env)) return json({error:"Apple Wallet aún no está disponible."},503);
    const token=url.searchParams.get("token")||"";
    const member=await getMember(env,token);
    if (!active(member) || !member.photoUrl) return json({error:"La tarjeta no está activa o falta fotografía."},403);
    try {
      const id=await idForMember(env,token,member);
      const buffer=await producePass(env,member,id);
      return new Response(buffer,{status:200,headers:{...noCache,"content-type":"application/vnd.apple.pkpass","content-disposition":"attachment; filename=\"ALIGN.pkpass\""}});
    } catch(e) {
      console.error("Wallet pass generation failed",e?.name || "Error");
      return json({error:"No pudimos preparar tu tarjeta Wallet."},503);
    }
  }
  return null;
}
// The existing ally scanner expects a 15-minute QR. Map a Wallet QR to a
// freshly generated one only after checking CURRENT member status in KV.
export async function rewriteWalletAllyRequest(request,env,apiWorker) {
  if (!supported(env) || request.method!=="POST") return request;
  const pathname=new URL(request.url).pathname;
  if (!["/api/ally/scan","/api/ally/visit"].includes(pathname)) return request;
  const body=await request.clone().json().catch(()=>null);
  if (!body || typeof body.qr!=="string") return request;
  let qr;
  try { qr=new URL(body.qr); } catch { return request; }
  if (qr.protocol!=="https:" || qr.hostname!==API_HOST || !/^\/api\/wallet\/verify\/[0-9a-f]{32}$/i.test(qr.pathname)) return request;
  const token=await tokenById(env,qr.pathname.split("/").pop());
  const member=token ? await getMember(env,token) : null;
  if (!active(member)) return request;
  const dynamicUrl="https://"+API_HOST+"/api/monthly-qr?token="+encodeURIComponent(token);
  const dynamicResponse=await apiWorker.fetch(new Request(dynamicUrl),env);
  if (!dynamicResponse.ok) return request;
  const current=await dynamicResponse.json().catch(()=>null);
  if (!current?.validationUrl) return request;
  const headers=new Headers(request.headers);
  headers.set("content-type","application/json");
  headers.delete("content-length");
  return new Request(request.url,{method:"POST",headers,body:JSON.stringify({...body,qr:current.validationUrl})});
}
