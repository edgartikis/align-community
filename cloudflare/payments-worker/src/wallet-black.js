// ALIGN Premium Black Edition: actual ram emblem + metallic-blue corner.
// Poster image includes only branded art, member name and savings.
// QR is supplied natively by Wallet and must never be painted or obscured.
import { Buffer } from "node:buffer";
import { ramB64,ramWidth,ramHeight } from "./wallet-borrego-asset.js";
import { interGlyphPartA } from "./wallet-inter-font-a.js";
import { interGlyphPartB } from "./wallet-inter-font-b.js";

// Rasterized anti-aliased uppercase Inter Display letters. Only pixel coverage
// is bundled; no font files or dependencies are delivered to iPhone users.
const fontAlphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789$.,-/ :";
const fontAdvance=[26.94,25.61,28.95,27.73,23.56,22.55,29.3,28.45,9.66,21.77,26.06,21.7,34.78,28.59,29.94,24.73,29.94,25.53,25.08,24.75,28.14,26.84,38.59,26.5,26.33,24.81,25.02,14.86,22.95,24.22,25.23,23.38,23.81,21.08,23.72,23.81,25.08,9.12,9.12,17.36,13.52,9.53,9.12];
const fontWidth=48,fontHeight=53,fontBaseSize=40,fontBaseline=40;

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
    const [ram,font]=await Promise.all([
      inflate(ramB64),
      inflate(interGlyphPartA+interGlyphPartB)
    ]);
    if(ram.length!==ramWidth*ramHeight)throw new Error("Invalid official ALIGN ram emblem");
    if(font.length!==fontAlphabet.length*fontWidth*fontHeight/2)
      throw new Error("Invalid high-resolution ALIGN font atlas");
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
// iOS 27 draws a translucent native material band over the bottom of a Poster
// Generic pass. Its *displayed* color is darker than pass.json backgroundColor.
// Keep the system tint unchanged, but fade the raster artwork toward the color
// measured on iPhone ([0,6,25]); matching the JSON value ([5,10,25]) caused
// a distinct horizontal seam precisely where iOS starts painting its footer.
export const ALIGN_NATIVE_FOOTER_COLOR = "rgb(5,10,25)";
const FOOTER_RGB = [0,6,25];
const smoothstep = (a,b,v) => {
  const t=Math.max(0,Math.min(1,(v-a)/(b-a)));
  return t*t*(3-2*t);
};
function premiumBackdrop(w,h) {
  const pix=Buffer.alloc(w*h*4),scale=w/716;
  for(let y=0;y<h;y++) {
    const yy=y/scale;
    const progress=smoothstep(340,896,yy);
    // iOS starts painting its native material near y=670 (retina artwork
    // coordinates). It shifts the visible band darker than backgroundColor.
    // Use a broad one-way optical crossfade that FINISHES before iOS starts
    // that band. Avoid an extended flat #050a19 region immediately above it.
    const join=smoothstep(420,662,yy);
    for(let x=0;x<w;x++) {
      const xx=x/scale;
      const dark=7.5+2.2*(1-yy/896)+1.1*Math.sin(xx*.009+yy*.004);
      let r=dark,g=dark+1.5,b=dark+3;
      // Retain the original upper-right diagonal, but taper it smoothly.
      // Previously it was abruptly disabled at y=602 (a visible seam).
      const angleFade=1-smoothstep(320,596,yy);
      if(xx>853-yy*.63) {
        const panel=angleFade*(.8+.2*smoothstep(450,716,xx));
        r+=6*panel;g+=7*panel;b+=10*panel;
      }
      // Continuous midnight-blue satin glow, shaped like the approved image B:
      // near-black on the left, gradually richer on the right and bottom.
      // No hard rectangular fill, no flat band, no neon-blue corner.
      const side=smoothstep(.06,.98,xx/716);
      const cobalt=Math.pow(side,1.55)*progress;
      const satin=Math.sin(xx*.011+yy*.008)*.9;
      r+=progress*.5+cobalt*1.4+satin*.20;
      g+=progress*2.5+cobalt*18.5+satin*.24;
      b+=progress*8.0+cobalt*66+satin*.30;
      // Optical match to the native footer *as displayed on iOS*.
      // All artwork pixels converge to one color before the material begins;
      // no rectangular edge or hard color switch remains on either side.
      r=r*(1-join)+FOOTER_RGB[0]*join;
      g=g*(1-join)+FOOTER_RGB[1]*join;
      b=b*(1-join)+FOOTER_RGB[2]*join;
      // Metallic cobalt diagonal accent: unchanged from approved header.
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
// 4-bit antialiased glyph coverage at a 40px source size. Glyphs are
// proportionally spaced using their REAL advances rather than a fixed cell
// stride (the old 12.5px stride caused MEMBERSHI P and SOCI O artifacts).
function coverageAt(font,index,x,y) {
  if(x<0||y<0||x>=fontWidth||y>=fontHeight)return 0;
  const at=index*fontWidth*fontHeight+y*fontWidth+x;
  const packed=font[at>>1];
  return ((at&1)?(packed&15):(packed>>>4))/15;
}
function coverageSmooth(font,index,x,y) {
  const x0=Math.floor(x),y0=Math.floor(y),dx=x-x0,dy=y-y0;
  const top=coverageAt(font,index,x0,y0)*(1-dx)+coverageAt(font,index,x0+1,y0)*dx;
  const bottom=coverageAt(font,index,x0,y0+1)*(1-dx)+coverageAt(font,index,x0+1,y0+1)*dx;
  return top*(1-dy)+bottom*dy;
}
export function walletTextWidth(value,fontSize,tracking=0) {
  const str=String(value??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toUpperCase().replace(/[^A-Z0-9$.,\/-: ]/g," ").replace(/\s+/g," ").trim();
  if(!str)return 0;
  return str.split("").reduce((width,c)=>{
    const idx=fontAlphabet.indexOf(c);
    return width+(idx<0?fontAdvance[fontAlphabet.indexOf(" ")]:fontAdvance[idx]);
  },0)*fontSize/fontBaseSize+(str.length-1)*tracking;
}
function drawText(out,w,h,font,value,x,baseline,size,maxWidth,align="left",color=[224,228,235],tracking=0) {
  const chars=String(value??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toUpperCase().replace(/[^A-Z0-9$.,\/-: ]/g," ").replace(/\s+/g," ").trim();
  if(!chars)return;
  const px=w/716;
  const nominal=walletTextWidth(chars,size,tracking);
  const fit=Math.min(1,maxWidth/Math.max(1,nominal));
  const fontScale=(size/fontBaseSize)*fit;
  const letterSpace=tracking*fit;
  const actualWidth=walletTextWidth(chars,size*fit,letterSpace);
  const left=(align==="center"?x-actualWidth/2:align==="right"?x-actualWidth:x)*px;
  const top=(baseline-fontBaseline*fontScale)*px;
  const bitmapW=Math.ceil(fontWidth*fontScale*px);
  const bitmapH=Math.ceil(fontHeight*fontScale*px);
  let cursor=0;
  for(const character of chars) {
    const index=fontAlphabet.indexOf(character);
    const advance=(index<0?fontAdvance[fontAlphabet.indexOf(" ")]:fontAdvance[index]);
    if(index>=0&&character!==" ") {
      const x0=Math.round(left+cursor*px);
      const y0=Math.round(top);
      for(let gy=0;gy<bitmapH;gy++) {
        const yy=y0+gy;if(yy<0||yy>=h)continue;
        const sourceY=(gy+.5)/(fontScale*px)-.5;
        for(let gx=0;gx<bitmapW;gx++) {
          const xx=x0+gx;if(xx<0||xx>=w)continue;
          const sourceX=(gx+.5)/(fontScale*px)-.5;
          const opacity=coverageSmooth(font,index,sourceX,sourceY);
          if(opacity>.003)paint(out,w,xx,yy,color[0],color[1],color[2],opacity);
        }
      }
    }
    cursor+=advance*fontScale+letterSpace;
  }
}
function render(w,h,name,savings,assets) {
  const pixels=premiumBackdrop(w,h),font=assets.font;
  paintOfficialRam(pixels,w,h,assets.ram);
  // Static upper branding that imitates the approved physical-card hierarchy.
  drawText(pixels,w,h,font,"MEMBERSHIP",358,223,40,480,"center",[235,239,246],1.1);
  drawText(pixels,w,h,font,"CARD - ALIGN",358,271,39,510,"center",[231,236,244],0.9);
  for(let y=Math.round(286*w/716);y<Math.round(289*w/716);y++)
    for(let x=Math.round(327*w/716);x<Math.round(390*w/716);x++)
      paint(pixels,w,x,y,29,160,246);
  // Only the member name and saved amount precede the reserved native-QR area.
  drawText(pixels,w,h,font,name,54,344,32,608,"left",[234,236,240],0.35);
  drawText(pixels,w,h,font,"AHORRADO",56,380,18,213,"left",[158,180,207],0.85);
  drawText(pixels,w,h,font,savings,54,418,30,415,"left",[236,238,243],0.15);
  // Option B: one fine silver rule beneath the native QR, with no extra
  // artwork text to double-print or fight Wallet's native footer field.
  // The native Poster Generic footer is BELONG TO SOMETHING (centered).
  const scale=w/716;
  const ruleY=Math.round(784*scale),ruleX0=Math.round(134*scale),ruleX1=Math.round(582*scale);
  for(let x=ruleX0;x<=ruleX1;x++) {
    const t=(x/scale-134)/448;
    const alpha=.34*Math.pow(Math.sin(Math.PI*t),1.4);
    paint(pixels,w,x,ruleY,193,202,218,alpha);
    if(ruleY+1<h)paint(pixels,w,x,ruleY+1,91,129,184,alpha*.27);
  }
  return pixels;
}
export async function blackWalletArtwork({name="",savings=""}={}) {
  const assets=await loadAssets();
  return {
    normal:await encodePng(358,448,render(358,448,name,savings,assets)),
    retina:await encodePng(716,896,render(716,896,name,savings,assets))
  };
}
