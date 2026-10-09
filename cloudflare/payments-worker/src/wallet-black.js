// ALIGN Premium Black Edition: actual ram emblem + metallic-blue corner.
// Poster image includes only branded art, member name, savings and private photo.
// QR is supplied natively by Wallet and must never be painted or obscured.
import { Buffer } from "node:buffer";
import { ramB64,ramWidth,ramHeight } from "./wallet-borrego-asset.js";
import { memberSerifGlyphsB64,memberSerifAlphabet,memberSerifWidth,memberSerifHeight } from "./wallet-serif-glyphs.js";

function crc32(bytes) {
  let c=0xffffffff;
  for(let i=0;i<bytes.length;i++){
    c^=bytes[i];for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0);
  }
  return(c^0xffffffff)>>>0;
}
function chunk(tag,data) {
  const name=Buffer.from(tag,"ascii"),out=Buffer.alloc(data.length+12);
  out.writeUInt32BE(data.length,0);name.copy(out,4);
  Buffer.from(data).copy(out,8);
  out.writeUInt32BE(crc32(out.subarray(4,8+data.length)),8+data.length);
  return out;
}
async function encodePng(w,h,rgba) {
  const scan=Buffer.alloc(h*(1+4*w));
  for(let y=0;y<h;y++)rgba.copy(scan,y*(1+w*4)+1,y*w*4,(y+1)*w*4);
  const stream=new CompressionStream("deflate");
  const writer=stream.writable.getWriter(),pending=new Response(stream.readable).arrayBuffer();
  await writer.write(scan);await writer.close();
  const info=Buffer.alloc(13);
  info.writeUInt32BE(w,0);info.writeUInt32BE(h,4);info[8]=8;info[9]=6;
  return Buffer.concat([Buffer.from("89504e470d0a1a0a","hex"),
    chunk("IHDR",info),chunk("IDAT",Buffer.from(await pending)),chunk("IEND",Buffer.alloc(0))]);
}
const clamp=(v)=>Math.max(0,Math.min(255,Math.round(v)));
let assetsPromise;
async function loadAssets() {
  if(!assetsPromise)assetsPromise=(async()=>{
    async function inflate(b64) {
      const stream=new DecompressionStream("deflate");
      const writer=stream.writable.getWriter(),pending=new Response(stream.readable).arrayBuffer();
      await writer.write(Buffer.from(b64,"base64"));await writer.close();
      return Buffer.from(await pending);
    }
    const [ram,font]=await Promise.all([inflate(ramB64),inflate(memberSerifGlyphsB64)]);
    if(ram.length!==ramWidth*ramHeight)throw new Error("Invalid official ALIGN ram emblem");
    if(font.length!==memberSerifAlphabet.length*memberSerifWidth*memberSerifHeight)
      throw new Error("Invalid ALIGN font atlas");
    return {ram,font};
  })();
  return assetsPromise;
}
function paint(out,w,x,y,r,g,b,alpha=1) {
  if(x<0||x>=w||y<0||y>=out.length/(w*4))return;
  const k=(y*w+x)*4;
  out[k]=clamp(out[k]*(1-alpha)+r*alpha);
  out[k+1]=clamp(out[k+1]*(1-alpha)+g*alpha);
  out[k+2]=clamp(out[k+2]*(1-alpha)+b*alpha);
}
function premiumBackdrop(w,h) {
  const pix=Buffer.alloc(w*h*4),scale=w/716;
  for(let y=0;y<h;y++) {
    const yy=y/scale;
    for(let x=0;x<w;x++) {
      const xx=x/scale;
      const dark=7.5+2.2*(1-yy/896)+1.1*Math.sin(xx*.009+yy*.004);
      let r=dark,g=dark+1.5,b=dark+3;
      // Very subtle black-on-black diagonal satin panel.
      if(xx>853-yy*.63){r+=6;g+=7;b+=10;}
      // Metallic cobalt diagonal accent in upper left.
      if(yy<=216) {
        const factor=1-yy/216,left=130*factor,right=208*factor;
        if(xx>=left&&xx<=right) {
          const shine=(xx-left)/Math.max(1,right-left);
          r=4+14*shine;g=49+75*shine;b=135+93*shine;
        }
        const rim=178*(1-yy/189);
        if(yy<189&&Math.abs(xx-rim)<3.4){r=57;g=172;b=250;}
        const rim2=203*(1-yy/214);
        if(yy<214&&Math.abs(xx-rim2)<1.15){r=125;g=206;b=255;}
      }
      if(yy>594&&Math.abs(xx-(716-(yy-594)*.82))<1.25){r=13;g=79;b=160;}
      const k=(y*w+x)*4;
      pix[k]=clamp(r);pix[k+1]=clamp(g);pix[k+2]=clamp(b);pix[k+3]=255;
    }
  }
  return pix;
}
function paintOfficialRam(out,w,h,data) {
  const scale=w/716,left=Math.round((716-ramWidth)/2*scale),top=Math.round(24*scale);
  const dw=Math.round(ramWidth*scale),dh=Math.round(ramHeight*scale);
  for(let y=0;y<dh;y++)for(let x=0;x<dw;x++) {
    const sx=clamp(Math.floor((x+.5)/scale)),sy=clamp(Math.floor((y+.5)/scale));
    const byte=data[Math.min(ramHeight-1,sy)*ramWidth+Math.min(ramWidth-1,sx)];
    const gray=(byte>>4)*17,opacity=(byte&15)*17/255;
    if(opacity===0)continue;
    paint(out,w,left+x,top+y,gray*.94,gray*.97,Math.min(255,gray*1.02),opacity);
  }
}
// Bilinear sample of a genuine anti-aliased source atlas. The old code used
// integer nearest-neighbour glyph pixels, visibly jagged on iPhone.
function sampleGlyph(font,at,gx,gy) {
  const sw=memberSerifWidth,sh=memberSerifHeight;
  const sx=Math.max(0,Math.min(sw-1,gx)),sy=Math.max(0,Math.min(sh-1,gy));
  const x0=Math.floor(sx),y0=Math.floor(sy),x1=Math.min(sw-1,x0+1),y1=Math.min(sh-1,y0+1);
  const fx=sx-x0,fy=sy-y0,start=at*sw*sh;
  return (font[start+y0*sw+x0]*(1-fx)+font[start+y0*sw+x1]*fx)*(1-fy)
    +(font[start+y1*sw+x0]*(1-fx)+font[start+y1*sw+x1]*fx)*fy;
}
function drawText(out,w,h,font,value,x,baseline,size,maxWidth,align="left",color=[224,228,235],tracking=0) {
  const chars=String(value??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toUpperCase().replace(/[^A-Z0-9$.,\/\- :]/g," ").replace(/\s+/g," ").trim();
  if(!chars)return;
  const scale=w/716,advance=12.5,sourceSize=18;
  let fontScale=size/sourceSize;
  let visualLength=(chars.length*advance+Math.max(0,chars.length-1)*tracking)*fontScale;
  if(visualLength>maxWidth)fontScale*=maxWidth/visualLength;
  visualLength=Math.min(maxWidth,visualLength);
  const left=(align==="center"?x-visualLength/2:align==="right"?x-visualLength:x)*scale;
  // Keep space for descenders from the original 17x23 font atlas.
  const top=Math.round((baseline-memberSerifHeight*fontScale*.78)*scale);
  const glyphW=Math.max(1,Math.round(memberSerifWidth*fontScale*scale));
  const glyphH=Math.max(1,Math.round(memberSerifHeight*fontScale*scale));
  for(let i=0;i<chars.length;i++) {
    const idx=memberSerifAlphabet.indexOf(chars[i]);if(idx<0)continue;
    const tx=Math.round(left+i*(advance+tracking)*fontScale*scale);
    for(let gy=0;gy<glyphH;gy++) {
      const yy=top+gy;if(yy<0||yy>=h)continue;
      const sourceY=(gy+.5)/(fontScale*scale)-.5;
      for(let gx=0;gx<glyphW;gx++) {
        const xx=tx+gx;if(xx<0||xx>=w)continue;
        const sourceX=(gx+.5)/(fontScale*scale)-.5;
        const opacity=sampleGlyph(font,idx,sourceX,sourceY)/255;
        if(opacity>.003)paint(out,w,xx,yy,color[0],color[1],color[2],opacity);
      }
    }
  }
}
function stampPortrait(out,w,h,portrait) {
  if(!portrait)return;
  const {width:pw,height:ph,data}=portrait;
  if(!pw||!ph||pw>1800||ph>1800||data?.length!==pw*ph*4)return;
  const scale=w/716,side=Math.round(82*scale);
  const x0=Math.round(580*scale),y0=Math.round(313*scale);
  const crop=Math.min(pw,ph),ox=Math.floor((pw-crop)/2),oy=Math.floor((ph-crop)/2);
  for(let py=0;py<side;py++)for(let px=0;px<side;px++) {
    const xx=x0+px,yy=y0+py;if(xx>=w||yy>=h)continue;
    const round=5*scale;
    const dx=px-Math.max(round,Math.min(side-round,px)),dy=py-Math.max(round,Math.min(side-round,py));
    if(Math.hypot(dx,dy)>round)continue;
    const sx=ox+Math.min(crop-1,Math.floor((px+.5)*crop/side));
    const sy=oy+Math.min(crop-1,Math.floor((py+.5)*crop/side));
    const from=(sy*pw+sx)*4,to=(yy*w+xx)*4;
    for(let channel=0;channel<3;channel++)out[to+channel]=data[from+channel];
  }
}
function render(w,h,photo,name,savings,assets) {
  const pixels=premiumBackdrop(w,h),font=assets.font;
  paintOfficialRam(pixels,w,h,assets.ram);
  // Static upper branding that imitates the approved physical-card hierarchy.
  drawText(pixels,w,h,font,"MEMBERSHIP",358,217,31,480,"center");
  drawText(pixels,w,h,font,"CARD - ALIGN",358,270,31,510,"center");
  for(let y=Math.round(286*w/716);y<Math.round(289*w/716);y++)
    for(let x=Math.round(327*w/716);x<Math.round(390*w/716);x++)
      paint(pixels,w,x,y,29,160,246);
  // Only user-specific name, savings and portrait precede the reserved QR area.
  drawText(pixels,w,h,font,name,56,341,25,498);
  drawText(pixels,w,h,font,"AHORRADO",58,372,13,213,"left",[156,176,201],.5);
  drawText(pixels,w,h,font,savings,57,409,23,413);
  stampPortrait(pixels,w,h,photo);
  // Bottom branding stays below the native QR. No duplicate member ID.
  drawText(pixels,w,h,font,"BELONG TO SOMETHING",40,824,13,433,"left",[174,182,193],.5);
  drawText(pixels,w,h,font,"ALIGN",657,839,19,145,"right",[214,222,234]);
  return pixels;
}
export async function blackWalletArtwork({photo=null,name="",savings=""}={}) {
  const assets=await loadAssets();
  return {
    normal:await encodePng(358,448,render(358,448,photo,name,savings,assets)),
    retina:await encodePng(716,896,render(716,896,photo,name,savings,assets))
  };
}
