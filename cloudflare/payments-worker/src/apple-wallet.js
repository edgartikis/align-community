// ALIGN Apple Wallet - isolated prototype. Does not touch checkout/webhooks.
// Enable only after credentials, artwork and ally-scanner end-to-end tests.
import { PKPass, PassType } from "passkit-generator";
import jpeg from "jpeg-js";
import { Buffer } from "node:buffer";
import { walletIconB64, walletLogoB64 } from "./wallet-artwork-data.js";
import { marbleWalletArtwork } from "./wallet-marble.js";

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
// Member photos from the existing ALIGN capture flow are private inline JPEGs.
// Convert directly inside the Worker: never publish or fetch a member image URL.
const JPEG_PREFIX="data:image/jpeg;base64,";
function pngCrc32(bytes) {
  let c=0xffffffff;
  for (let i=0;i<bytes.length;i++) {
    c^=bytes[i];
    for (let b=0;b<8;b++) c=(c>>>1)^((c&1)?0xedb88320:0);
  }
  return (c^0xffffffff)>>>0;
}
function pngChunk(name,data) {
  const type=Buffer.from(name,"ascii");
  const output=Buffer.alloc(12+data.length);
  output.writeUInt32BE(data.length,0);
  type.copy(output,4);
  Buffer.from(data).copy(output,8);
  output.writeUInt32BE(pngCrc32(output.subarray(4,8+data.length)),8+data.length);
  return output;
}
async function encodeWalletThumbnail(source,size) {
  const {width,height,data}=source;
  if (!width || !height || width>1800 || height>1800 || data.length!==width*height*4) {
    throw new Error("Invalid JPEG photo dimensions");
  }
  const square=Math.min(width,height);
  const left=Math.floor((width-square)/2),top=Math.floor((height-square)/2);
  const scanline=Buffer.alloc(size*(size*4+1));
  for (let y=0;y<size;y++) {
    const sourceY=top+Math.min(square-1,Math.floor((y+.5)*square/size));
    const destRow=y*(size*4+1);
    scanline[destRow]=0; // PNG filter None
    for (let x=0;x<size;x++) {
      const sourceX=left+Math.min(square-1,Math.floor((x+.5)*square/size));
      const index=(sourceY*width+sourceX)*4;
      for (let b=0;b<4;b++) scanline[destRow+1+x*4+b]=data[index+b];
    }
  }
  const compressor=new CompressionStream("deflate");
  const writer=compressor.writable.getWriter();
  const compressedPromise=new Response(compressor.readable).arrayBuffer();
  await writer.write(scanline);
  await writer.close();
  const compressed=Buffer.from(await compressedPromise);
  const ihdr=Buffer.alloc(13);
  ihdr.writeUInt32BE(size,0);
  ihdr.writeUInt32BE(size,4);
  ihdr[8]=8;  // bit depth
  ihdr[9]=6;  // RGBA
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a","hex"),
    pngChunk("IHDR",ihdr),
    pngChunk("IDAT",compressed),
    pngChunk("IEND",Buffer.alloc(0))
  ]);
}
async function inlineMemberPhoto(photoUrl) {
  if (!photoUrl.startsWith(JPEG_PREFIX) || photoUrl.length>180000 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(photoUrl.slice(JPEG_PREFIX.length))) {
    throw new Error("Invalid private member JPEG photo");
  }
  const jpegBytes=Buffer.from(photoUrl.slice(JPEG_PREFIX.length),"base64");
  if (jpegBytes.length<100 || jpegBytes.length>120000) throw new Error("Private member photo too large");
  const decoded=jpeg.decode(jpegBytes,{
    useTArray:true,formatAsRGBA:true,tolerantDecoding:false,
    maxResolutionInMP:3,maxMemoryUsageInMB:24
  });
  return {
    normal:await encodeWalletThumbnail(decoded,90),
    retina:await encodeWalletThumbnail(decoded,180),
    source:decoded
  };
}
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
    foregroundColor:"rgb(217,221,227)", // ALIGN silver
    backgroundColor:"rgb(15,76,222)", // royal blue generic fallback
    labelColor:"rgb(217,221,227)"
  });
  pass.type="generic";
  // The amount is short, so it won't dominate or truncate the member name.
  pass.primaryFields.push({key:"savings",label:"AHORRADO",value:formatSavingsMXN(member.savings)});
  pass.secondaryFields.push({key:"name",label:"SOCIO",value:safe(member.name,48)});
  // Position the membership in the same visible details group as the name.
  // Wallet may drop auxiliary fields when the square QR consumes available space.
  pass.secondaryFields.push({key:"plan",label:"MEMBRESÍA",value:safe(member.level,35)});
  // A long code would compete with photo and name on small screens; the QR
  // alt text displays it below the barcode and details always show it.
  pass.backFields.push({key:"code",label:"CÓDIGO DE SOCIO",value:safe(member.memberCode,60)});
  pass.backFields.push({key:"validity",label:"VIGENCIA",value:safe(period(member).until,40)});
  pass.backFields.push({key:"verification",label:"VALIDACIÓN",value:"El aliado debe escanear el QR y comprobar fotografía, identidad y vigencia en el sistema ALIGN. Un pase guardado no garantiza membresía activa."});
  // iOS 27+ supports native posterGeneric with full artwork. iOS 26 and older
  // continue to use the same Generic pass with a real member thumbnail + QR.
  // Field keys must be distinct across styles in passkit-generator.
  const poster=new PassType("posterGeneric");
  poster.headerFields.push({key:"posterCode",label:"CÓDIGO",value:safe(member.memberCode,48)});
  poster.primaryFields.push({key:"posterName",label:"SOCIO",value:safe(member.name,48)});
  poster.primaryFields.push({key:"posterPlan",label:"MEMBRESÍA",value:safe(member.level,35)});
  poster.primaryFields.push({key:"posterSavings",label:"AHORRADO",value:formatSavingsMXN(member.savings)});
  poster.backFields.push({key:"posterVerification",label:"VERIFICACIÓN",value:"Presenta tu QR para validar identidad y membresía vigente. El pase por sí solo no prueba vigencia."});
  poster.backFields.push({key:"posterContact",label:"CONTACTO",value:"https://alignmembers.com.mx"});
  pass.types.push(poster);

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
  pass.addBuffer("primaryLogo.png",logo);
  pass.addBuffer("primaryLogo@2x.png",logo);
  let posterPhoto=null;
  if (member.photoUrl && !isPlaceholderPhoto(member.photoUrl)) {
    onStage("member_photo");
    const photo=member.photoUrl.startsWith("data:")
      ? await inlineMemberPhoto(member.photoUrl)
      : await (async()=>{
          const image=await trustedMemberThumbnail(member.photoUrl);
          return {normal:image,retina:image};
        })();
    posterPhoto=photo.source||null;
    pass.addBuffer("thumbnail.png",photo.normal);
    pass.addBuffer("thumbnail@2x.png",photo.retina);
  }
  onStage("artwork_marble");
  const artwork=await marbleWalletArtwork(posterPhoto);
  pass.addBuffer("artwork.png",artwork.normal);
  pass.addBuffer("artwork@2x.png",artwork.retina);
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
// Preview-only capture page: sends the same small JPEG as ALIGN's real
// enrollment flow to the Preview worker and isolated KV (never production).
function previewMemberPhotoPage() {
  const html=String.raw`<!doctype html><html lang="es"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>Foto de prueba · ALIGN Wallet</title>
<style>body{font:16px system-ui;background:#0e3793;color:#e1e5ec;min-height:100vh;display:grid;place-items:center;margin:0;padding:20px;box-sizing:border-box}
main{max-width:420px;width:100%;padding:25px;border:1px solid #a7b4c8;border-radius:18px;background:#0c275e}
h1{font:32px Georgia,serif;margin:0 0 12px}p{line-height:1.5}input,button{font:inherit;width:100%;box-sizing:border-box;margin:10px 0}
button{background:#dae1eb;color:#071d47;border:0;padding:14px;border-radius:12px;font-weight:600;cursor:pointer}
button:disabled{opacity:.5}img{height:180px;width:180px;object-fit:cover;border-radius:12px;display:none;margin:10px auto}
small{display:block;opacity:.8}#status{min-height:2em}</style>
<main><h1>ALIGN · Foto de prueba</h1>
<p>Usa la fotografía real del socio de pruebas. Se guarda solamente en el entorno Preview de ALIGN.</p>
<input id="image" type="file" accept="image/*" aria-label="Seleccionar foto">
<img id="preview" alt="Foto seleccionada"><button id="save" disabled>Guardar foto en pruebas</button>
<p id="status" role="status"></p><small>No modifica las membresías ni los pagos de producción.</small></main>
<canvas id="canvas" width="320" height="320" hidden></canvas>
<script>
const token=new URLSearchParams(location.search).get('token')||'';
const input=document.getElementById('image'),preview=document.getElementById('preview');
const save=document.getElementById('save'),status=document.getElementById('status');
let photo='';
input.addEventListener('change',async()=>{
 try{
  save.disabled=true;photo='';status.textContent='';
  const file=input.files?.[0];if(!file)return;
  if(file.size>8*1024*1024)throw new Error('El archivo original es demasiado grande.');
  const temp=URL.createObjectURL(file);const picture=new Image();
  try{
   await new Promise((resolve,reject)=>{picture.onload=resolve;picture.onerror=reject;picture.src=temp;});
   const c=document.getElementById('canvas'),ctx=c.getContext('2d');
   const crop=Math.min(picture.naturalWidth,picture.naturalHeight);
   if(!crop)throw new Error('Imagen no válida.');
   const x=(picture.naturalWidth-crop)/2,y=(picture.naturalHeight-crop)/2;
   ctx.drawImage(picture,x,y,crop,crop,0,0,320,320);
   let quality=.75;photo=c.toDataURL('image/jpeg',quality);
   while(photo.length>43000 && quality>.25){quality-=.08;photo=c.toDataURL('image/jpeg',quality);}
   if(photo.length>44000)throw new Error('La foto no se pudo comprimir. Prueba otra.');
   preview.src=photo;preview.style.display='block';save.disabled=false;
  }finally{URL.revokeObjectURL(temp);}
 }catch(error){status.textContent=error.message;}
});
save.addEventListener('click',async()=>{
 try{
  if(!photo || !token)throw new Error('Falta la foto o la clave de prueba.');
  save.disabled=true;status.textContent='Guardando en Preview…';
  const response=await fetch('/api/upload-profile-photo',{method:'POST',
   headers:{'content-type':'application/json'},body:JSON.stringify({token,photo})});
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(result.error||'No se pudo guardar la foto.');
  status.textContent='Foto guardada. Abriendo la tarjeta de Apple Wallet…';
  location.assign('/api/wallet/apple?token='+encodeURIComponent(token));
 }catch(error){status.textContent=error.message;save.disabled=false;}
});
</script></html>`;
  return new Response(html,{status:200,headers:{...noCache,
    "content-type":"text/html; charset=utf-8",
    "content-security-policy":"default-src 'none'; img-src data: blob:; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'",
    "referrer-policy":"no-referrer"}});
}
export async function walletRoute(request,env) {
  const url=new URL(request.url),path=url.pathname;
  if (request.method==="GET" && path==="/api/wallet/status") return json({ok:true,available:supported(env),provider:"apple"});
  if (request.method==="GET" && path==="/api/wallet/photo-test" &&
      url.hostname==="feature-apple-wallet-align-align-payments.alignservice18.workers.dev" &&
      supported(env)) {
    const member=await getMember(env,url.searchParams.get("token")||"");
    return active(member) ? previewMemberPhotoPage() : json({error:"Socio de pruebas no encontrado o inactivo."},403);
  }
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
