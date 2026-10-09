// ALIGN Black Marble — image approved by the member, NOT a procedural imitation.
// Poster artwork has only the member name, savings and private photo.
// Wallet paints the real signed QR separately. This artwork must NEVER draw a QR.
import jpeg from "jpeg-js";
import { Buffer } from "node:buffer";
import { approvedBlackMarbleJpegB64 } from "./wallet-approved-marble-data.js";
import { memberSerifGlyphsB64,memberSerifAlphabet,memberSerifWidth,memberSerifHeight } from "./wallet-serif-glyphs.js";

function crc32(bytes) {
  let c=0xffffffff;
  for(let i=0;i<bytes.length;i++){
    c^=bytes[i];
    for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0);
  }
  return(c^0xffffffff)>>>0;
}
function chunk(tag,data) {
  const name=Buffer.from(tag,"ascii"),out=Buffer.alloc(data.length+12);
  out.writeUInt32BE(data.length,0);
  name.copy(out,4);
  Buffer.from(data).copy(out,8);
  out.writeUInt32BE(crc32(out.subarray(4,8+data.length)),8+data.length);
  return out;
}
async function encodePng(w,h,rgba) {
  const scan=Buffer.alloc(h*(1+4*w));
  for(let y=0;y<h;y++) {
    const row=y*(1+4*w);
    rgba.copy(scan,row+1,y*w*4,(y+1)*w*4);
  }
  const stream=new CompressionStream("deflate");
  const writer=stream.writable.getWriter(),pending=new Response(stream.readable).arrayBuffer();
  await writer.write(scan);await writer.close();
  const info=Buffer.alloc(13);
  info.writeUInt32BE(w,0);info.writeUInt32BE(h,4);info[8]=8;info[9]=6;
  return Buffer.concat([Buffer.from("89504e470d0a1a0a","hex"),
    chunk("IHDR",info),chunk("IDAT",Buffer.from(await pending)),chunk("IEND",Buffer.alloc(0))]);
}
const clamp=(v)=>Math.max(0,Math.min(255,Math.round(v)));
let baseImage,serifMask;
function approvedImage() {
  if(!baseImage) {
    const bytes=Buffer.from(approvedBlackMarbleJpegB64,"base64");
    const image=jpeg.decode(bytes,{useTArray:true,formatAsRGBA:true,
      tolerantDecoding:false,maxResolutionInMP:3,maxMemoryUsageInMB:24});
    if(image.width!==716||image.height!==896)throw new Error("Invalid approved ALIGN image");
    baseImage=image;
  }
  return baseImage;
}
async function serifGlyphs() {
  if(!serifMask)serifMask=(async()=>{
    const packed=Buffer.from(memberSerifGlyphsB64,"base64");
    const unzip=new DecompressionStream("deflate");
    const writer=unzip.writable.getWriter(),pending=new Response(unzip.readable).arrayBuffer();
    await writer.write(packed);await writer.close();
    const pixels=Buffer.from(await pending);
    if(pixels.length!==memberSerifAlphabet.length*memberSerifWidth*memberSerifHeight)
      throw new Error("Invalid ALIGN serif glyph atlas");
    return pixels;
  })();
  return serifMask;
}
function stampPortrait(target,w,h,portrait,scale) {
  if(!portrait)return;
  const {width:pw,height:ph,data}=portrait;
  if(!pw||!ph||pw>1800||ph>1800||data?.length!==pw*ph*4)return;
  const side=Math.round(65*scale);
  const x0=Math.round(263*scale),y0=Math.round(137*scale);
  const crop=Math.min(pw,ph),sx0=Math.floor((pw-crop)/2),sy0=Math.floor((ph-crop)/2);
  for(let y=0;y<side;y++)for(let x=0;x<side;x++){
    const dx=x0+x,dy=y0+y;if(dx>=w||dy>=h)continue;
    const px=sx0+Math.min(crop-1,Math.floor((x+.5)*crop/side));
    const py=sy0+Math.min(crop-1,Math.floor((y+.5)*crop/side));
    const source=(py*pw+px)*4,at=(dy*w+dx)*4;
    for(let c=0;c<3;c++)target[at+c]=data[source+c];
  }
}
function paintSerif(target,w,h,atlas,value,x,y,size,maxWidth) {
  let chars=String(value??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toUpperCase().replace(/[^A-Z0-9$.,\-/ :]/g," ").trim();
  if(!chars)return;
  const scaling=w/358;
  const advance=12.5;
  const fontScale=Math.min(size/18,maxWidth/(chars.length*advance));
  const glyphW=Math.max(1,Math.round(memberSerifWidth*fontScale*scaling));
  const glyphH=Math.max(1,Math.round(memberSerifHeight*fontScale*scaling));
  const step=advance*fontScale*scaling;
  for(let i=0;i<chars.length;i++) {
    const idx=memberSerifAlphabet.indexOf(chars[i]);
    if(idx<0)continue;
    const x0=Math.round(x*scaling+i*step),y0=Math.round(y*scaling);
    for(let gy=0;gy<glyphH;gy++) {
      const sy=Math.min(memberSerifHeight-1,Math.floor((gy+.5)*memberSerifHeight/glyphH));
      const dy=y0+gy;if(dy<0||dy>=h)continue;
      for(let gx=0;gx<glyphW;gx++) {
        const sx=Math.min(memberSerifWidth-1,Math.floor((gx+.5)*memberSerifWidth/glyphW));
        const dx=x0+gx;if(dx<0||dx>=w)continue;
        const a=atlas[idx*memberSerifWidth*memberSerifHeight+sy*memberSerifWidth+sx]/255;
        if(a===0)continue;
        const offset=(dy*w+dx)*4;
        for(let c=0;c<3;c++)target[offset+c]=clamp(
          target[offset+c]*(1-a)+(c===0?225:c===1?227:232)*a);
      }
    }
  }
}
function render(w,h,photo,name,savings,atlas) {
  const original=approvedImage(),scale=w/358;
  const pixels=Buffer.alloc(w*h*4);
  // Full Retina artwork is 716×896. Keep its pixels intact at @2x;
  // downsample smoothly at 1x with pixel-centred bilinear filtering.
  for(let y=0;y<h;y++){
    const sourceY=Math.max(0,Math.min(895,(y+.5)*896/h-.5));
    const y0=Math.floor(sourceY),y1=Math.min(895,y0+1),dy=sourceY-y0;
    for(let x=0;x<w;x++){
      const sourceX=Math.max(0,Math.min(715,(x+.5)*716/w-.5));
      const x0=Math.floor(sourceX),x1=Math.min(715,x0+1),dx=sourceX-x0;
      const i00=(y0*716+x0)*4,i10=(y0*716+x1)*4;
      const i01=(y1*716+x0)*4,i11=(y1*716+x1)*4;
      const target=(y*w+x)*4;
      for(let c=0;c<3;c++){
        const top=original.data[i00+c]*(1-dx)+original.data[i10+c]*dx;
        const bottom=original.data[i01+c]*(1-dx)+original.data[i11+c]*dx;
        pixels[target+c]=Math.round(top*(1-dy)+bottom*dy);
      }
      pixels[target+3]=255;
    }
  }
  stampPortrait(pixels,w,h,photo,scale);
  // QR begins below this upper block on the supported Poster display.
  // No membership, code, extra logo, labels or white photo frame.
  paintSerif(pixels,w,h,atlas,name,26,151,17,213);
  paintSerif(pixels,w,h,atlas,savings,26,181,19,210);
  return pixels;
}
export async function blackWalletArtwork({photo=null,name="",savings=""}={}) {
  const atlas=await serifGlyphs();
  return {
    normal:await encodePng(358,448,render(358,448,photo,name,savings,atlas)),
    retina:await encodePng(716,896,render(716,896,photo,name,savings,atlas))
  };
}
