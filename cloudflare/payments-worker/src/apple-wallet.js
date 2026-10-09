// ALIGN Apple Wallet - isolated prototype. Does not touch checkout/webhooks.
// Enable only after credentials, artwork and ally-scanner end-to-end tests.
import { PKPass } from "passkit-generator";
import { Buffer } from "node:buffer";
import { walletIconB64, walletLogoB64 } from "./wallet-artwork-data.js";

const API_HOST = "api.alignmembers.com.mx";
const ID = "pass.mx.com.alignmembers.membership";
export function walletQrUrl(requestUrl, id) {
  if (!/^[0-9a-f]{32}$/i.test(id)) throw new Error("Invalid wallet pass id");
  const origin = new URL(requestUrl);
  if (origin.protocol !== "https:" || (origin.hostname !== API_HOST && !origin.hostname.endsWith(".workers.dev"))) {
    throw new Error("Invalid Wallet signing origin");
  }
  return new URL("/api/wallet/verify/" + id, origin.origin).toString();
}
const okToken = (s) => /^[A-Za-z0-9_-]{20,140}$/.test(s);
const okId = (s) => /^[0-9a-f]{32}$/i.test(s);
const safe = (s, length=100) => String(s ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, length);
const escapeHtml = (s) => safe(s, 250).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const noCache = { "cache-control": "no-store", "x-content-type-options": "nosniff", "access-control-allow-origin": "https://alignmembers.com.mx", "vary": "Origin" };
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
function bundledWalletPng(base64) {
  const bytes=Buffer.from(base64, "base64");
  // Fail closed on missing/invalid static images without contacting external services.
  if (bytes.length===0 || bytes.length>400000 ||
      bytes.subarray(0,8).toString("hex")!=="89504e470d0a1a0a") {
    throw new Error("Invalid bundled Wallet PNG");
  }
  return bytes;
}
// Apple Wallet controls card dimensions and typography. Generic passes permit
// a real member thumbnail; storeCard passes do not support member thumbnails.
const formatSavingsMXN = (value) => {
  const n=Number(value);
  const amount=Number.isFinite(n) && n>0 ? Math.min(n,100000000) : 0;
  const whole=Math.round(amount*100)%100===0;
  return new Intl.NumberFormat("es-MX", {style:"currency",currency:"MXN",
    minimumFractionDigits:whole?0:2,maximumFractionDigits:2}).format(amount)+" MXN";
};
const isPlaceholderPhoto = (value) => {
  try {
    const u=new URL(value);
    return ["https://alignmembers.com.mx","https://www.alignmembers.com.mx"].includes(u.origin) &&
      ["/assets/align-primary.png","/assets/align-wordmark.png"].includes(u.pathname);
  } catch { return false; }
};
const pngSize = (bytes) => {
  if (bytes.length<24 || bytes.subarray(0,8).toString("hex")!=="89504e470d0a1a0a" ||
      bytes.toString("ascii",12,16)!=="IHDR") throw new Error("Invalid member photo PNG");
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
  if (width<60 || height<90 || width>1600 || height>1600) throw new Error("Invalid member photo dimensions");
  return {width,height};
};
async function trustedMemberThumbnail(photoUrl) {
  const u=new URL(photoUrl);
  // Photos must be publicly viewable PNGs on an ALIGN-controlled domain.
  if (u.protocol!=="https:" || !["alignmembers.com.mx","www.alignmembers.com.mx"].includes(u.hostname) ||
      u.username || u.password || u.port || !u.pathname.startsWith("/assets/")) {
    throw new Error("Photo must use an ALIGN-controlled HTTPS asset URL");
  }
  const response=await fetch(u.href,{redirect:"error",headers:{"accept":"image/png"}});
  if (!response.ok || !(response.headers.get("content-type")||"").toLowerCase().includes("image/png")) {
    throw new Error("Member photo must be a public PNG");
  }
  const declaredSize=Number(response.headers.get("content-length")||0);
  if (declaredSize>400000) throw new Error("Photo is too large");
  const bytes=Buffer.from(await response.arrayBuffer());
  if (bytes.length>400000) throw new Error("Photo is too large");
  pngSize(bytes);
  return bytes;
}
export async function producePass(env,member,id,requestUrl,onStage=()=>{}) {
  onStage("certificate_setup");
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
    // ALIGN's wordmark image already contains the brand name.
    foregroundColor:"rgb(218,224,234)",
    backgroundColor:"rgb(14,55,147)", // ALIGN royal blue
    labelColor:"rgb(189,200,217)" // soft silver
  });
  pass.type="generic";
  // The amount is short, so it won't dominate or truncate the member name.
  pass.primaryFields.push({key:"savings",label:"AHORRADO",value:formatSavingsMXN(member.savings)});
  pass.secondaryFields.push({key:"name",label:"SOCIO",value:safe(member.name,70)});
  pass.auxiliaryFields.push({key:"plan",label:"MEMBRESÍA",value:safe(member.level,48)});
  // A long code would compete with photo and name on small screens; the QR
  // alt text displays it below the barcode and details always show it.
  pass.backFields.push({key:"code",label:"CÓDIGO DE SOCIO",value:safe(member.memberCode,60)});
  pass.backFields.push({key:"validity",label:"VIGENCIA",value:safe(period(member).until,40)});
  pass.backFields.push({key:"verification",label:"VALIDACIÓN",value:"El aliado debe escanear el QR y comprobar fotografía, identidad y vigencia en el sistema ALIGN. Un pase guardado no garantiza membresía activa."});
  // Stable, non-secret, opaque pointer. The verifier reads CURRENT KV state.
  pass.setBarcodes({format:"PKBarcodeFormatQR",message:walletQrUrl(requestUrl,id),messageEncoding:"iso-8859-1",altText:safe(member.memberCode,60)});
  // Public brand assets are bundled at build time; no runtime external requests.
  // Replace with correctly resized Apple Wallet imagery before production launch.
  onStage("artwork_icon");
  const icon=bundledWalletPng(walletIconB64);
  onStage("artwork_logo");
  const logo=bundledWalletPng(walletLogoB64);
  pass.addBuffer("icon.png",icon);
  pass.addBuffer("icon@2x.png",icon);
  pass.addBuffer("logo.png",logo);
  pass.addBuffer("logo@2x.png",logo);
  if (member.photoUrl && !isPlaceholderPhoto(member.photoUrl)) {
    onStage("member_photo");
    const thumbnail=await trustedMemberThumbnail(member.photoUrl);
    pass.addBuffer("thumbnail.png",thumbnail);
    pass.addBuffer("thumbnail@2x.png",thumbnail);
  }
  onStage("signature");
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
    let stage="kv_mapping";
    try {
      const id=await idForMember(env,token,member);
      const buffer=await producePass(env,member,id,request.url,(next)=>{stage=next;});
      return new Response(buffer,{status:200,headers:{...noCache,"content-type":"application/vnd.apple.pkpass","content-disposition":"attachment; filename=\"ALIGN.pkpass\""}});
    } catch(e) {
      // Never log tokens, PEM contents, raw error messages or passphrases.
      console.error("ALIGN Wallet issue stage",stage,"exception",e?.name || "Error");
      // This non-sensitive stage is only returned by this dedicated preview branch.
      const isPreview=url.hostname==="feature-apple-wallet-align-align-payments.alignservice18.workers.dev";
      return json({error:"No pudimos preparar tu tarjeta Wallet.", ...(isPreview?{stage}:{})},503);
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
  if (qr.protocol!=="https:" || qr.origin!==new URL(request.url).origin || !/^\/api\/wallet\/verify\/[0-9a-f]{32}$/i.test(qr.pathname)) return request;
  const token=await tokenById(env,qr.pathname.split("/").pop());
  const member=token ? await getMember(env,token) : null;
  if (!active(member)) return request;
  const dynamicUrl=new URL("/api/monthly-qr?token="+encodeURIComponent(token),new URL(request.url).origin).toString();
  const dynamicResponse=await apiWorker.fetch(new Request(dynamicUrl),env);
  if (!dynamicResponse.ok) return request;
  const current=await dynamicResponse.json().catch(()=>null);
  if (!current?.validationUrl) return request;
  const headers=new Headers(request.headers);
  headers.set("content-type","application/json");
  headers.delete("content-length");
  return new Request(request.url,{method:"POST",headers,body:JSON.stringify({...body,qr:current.validationUrl})});
}
