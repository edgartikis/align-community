// ALIGN Apple Wallet - isolated prototype. Does not touch checkout/webhooks.
// Enable only after credentials, artwork and ally-scanner end-to-end tests.
import { PKPass, PassType } from "passkit-generator";
import { Buffer } from "node:buffer";
import { walletIconB64, walletLogoB64 } from "./wallet-artwork-data.js";
import { blackWalletArtwork } from "./wallet-black.js";

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
// Apple Wallet controls pass dimensions, the native QR, and field placement.
const formatSavingsMXN = (value) => {
  const n=Number(value);
  const amount=Number.isFinite(n) && n>0 ? Math.min(n,100000000) : 0;
  const whole=Math.round(amount*100)%100===0;
  return new Intl.NumberFormat("es-MX", {style:"currency",currency:"MXN",
    minimumFractionDigits:whole?0:2,maximumFractionDigits:2}).format(amount)+" MXN";
};
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
    foregroundColor:"rgb(217,221,227)", // bright satin silver
    backgroundColor:"rgb(5,5,5)", // Black Edition fallback for iOS 26 and earlier
    labelColor:"rgb(194,198,207)" // soft silver labels
  });
  // Keep Generic as fallback on older devices, with no member thumbnail.
  // Poster Generic uses custom artwork and a native QR on supported devices.
  pass.type="generic";
  // Apple controls field placement: primary appears first and prominently,
  // secondary fields follow it, then the native QR at the bottom.
  // Black Edition: prominent savings + quieter member details, not an
  // oversized, two-line member name.
  pass.primaryFields.push({
    key:"savings",label:"AHORRADO",value:formatSavingsMXN(member.savings)
  });
  pass.secondaryFields.push({
    key:"name",label:"SOCIO",value:safe(member.name,70)
  });
  pass.backFields.push({key:"code",label:"CÓDIGO DE SOCIO",value:safe(member.memberCode,60)});
  pass.backFields.push({key:"fullName",label:"NOMBRE COMPLETO",value:safe(member.name,90)});
  pass.backFields.push({key:"validity",label:"VIGENCIA",value:safe(period(member).until,40)});
  pass.backFields.push({key:"verification",label:"VALIDACIÓN",value:"El aliado debe escanear el QR y comprobar identidad y vigencia en el sistema ALIGN. Un pase guardado no garantiza membresía activa."});
  pass.backFields.push({key:"issuerContact",label:"CONTACTO",value:"https://alignmembers.com.mx"});

  // Poster Generic renders the approved Royal Marble artwork with real member data.
  // Compatible iOS versions add only the native QR on the front; the existing
  // Generic pass remains the fallback for earlier devices.
  const poster=new PassType("posterGeneric");
  // iOS 27 Poster Generic supports a single native footer field. It is
  // centered and keeps the callout legible on Wallet's material bottom strip
  // (artwork text alone can be hidden/cropped under this native strip).
  poster.footerFields.push({
    key:"alignFooterTagline",
    value:"BELONG TO SOMETHING",
    textAlignment:"PKTextAlignmentCenter"
  });
  poster.backFields.push({key:"posterMember",label:"SOCIO",value:safe(member.name,90)});
  poster.backFields.push({key:"posterSavings",label:"AHORRADO",value:formatSavingsMXN(member.savings)});
  poster.backFields.push({key:"posterMembership",label:"MEMBRESÍA",value:safe(member.level,48)});
  poster.backFields.push({key:"posterMemberCode",label:"CÓDIGO DE SOCIO",value:safe(member.memberCode,60)});
  poster.backFields.push({key:"posterValidity",label:"VIGENCIA",value:safe(period(member).until,40)});
  poster.backFields.push({key:"posterVerification",label:"VERIFICACIÓN",value:"El aliado debe escanear el QR y comprobar identidad y membresía vigente. Un pase guardado no acredita vigencia."});
  poster.backFields.push({key:"posterContact",label:"CONTACTO",value:"https://alignmembers.com.mx"});
  pass.types.push(poster);

  // Stable, non-secret, opaque pointer. The verifier reads CURRENT KV state.
  pass.setBarcodes({format:"PKBarcodeFormatQR",message:walletQrUrl(requestUrl,id),messageEncoding:"iso-8859-1"});
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
  // Photos are deliberately NOT included in the pass or artwork, even if a
  // legacy member record still contains photoUrl. QR validation remains native.
  onStage("artwork_poster");
  const posterArtwork=await blackWalletArtwork({
    name:safe(member.name,90),
    savings:formatSavingsMXN(member.savings)
  });
  pass.addBuffer("artwork.png",posterArtwork.normal);
  pass.addBuffer("artwork@2x.png",posterArtwork.retina);

  onStage("signature");
  return pass.getAsBuffer();
}
function verificationHtml(member) {
  const valid=active(member);
  const name=safe(member?.name);
  // Scanning must rely on CURRENT membership validity, never on an embedded
  // photograph or a saved pass alone. Existing member photos are untouched.
  const memberInfo=valid
    ?'<p>'+escapeHtml(name)+'</p><p>'+escapeHtml(member.level)+'</p><p>'+escapeHtml(member.memberCode)+'</p><p>Comprueba nombre, código e identidad antes de aplicar el beneficio.</p>'
    :'<p>No aplicar el beneficio.</p>';
  return new Response('<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Validación ALIGN</title><body style="background:#10233e;color:#fff;font:16px system-ui;text-align:center;padding:45px 20px"><main><h1>ALIGN MEMBERSHIP</h1><h2>'+(valid?"Membresía activa":"Membresía no válida")+'</h2>'+memberInfo+'</main></body></html>',{
    status:valid?200:403,
    headers:{...noCache,"content-type":"text/html; charset=utf-8",
      "content-security-policy":"default-src 'none'; style-src 'unsafe-inline'"}
  });
}
export async function walletRoute(request,env) {
  const url=new URL(request.url),path=url.pathname;
  if (request.method==="GET" && path==="/api/wallet/status") return json({ok:true,available:supported(env),provider:"apple"});
  if (request.method==="GET" && path==="/api/wallet/photo-test" &&
      url.hostname==="feature-apple-wallet-align-align-payments.alignservice18.workers.dev" &&
      supported(env)) {
    const member=await getMember(env,url.searchParams.get("token")||"");
    if (!active(member)) return json({error:"Socio de pruebas no encontrado o inactivo."},403);
    // Backwards compatible with old private photo-test bookmarks; photo
    // upload has been retired from Apple Wallet, not from member records.
    return new Response(null,{status:303,headers:{
      ...noCache,"location":"/api/wallet/apple?token="+encodeURIComponent(url.searchParams.get("token")||""),
      "referrer-policy":"no-referrer"
    }});
  }
  if (request.method==="GET" && /^\/api\/wallet\/verify\/[0-9a-f]{32}$/i.test(path)) {
    if (!env.PAYMENT_STATE) return verificationHtml(null);
    return verificationHtml(await memberById(env,path.split("/").pop()));
  }
  if (request.method==="GET" && path==="/api/wallet/apple") {
    if (!supported(env)) return json({error:"Apple Wallet aún no está disponible."},503);
    const token=url.searchParams.get("token")||"";
    const member=await getMember(env,token);
    if (!active(member)) return json({error:"La tarjeta no está activa."},403);
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
