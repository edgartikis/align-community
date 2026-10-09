// ALIGN approved Black Marble — real Poster Generic artwork for compatible iOS.
// Fixed branded marble background + member-specific image text/photo.
// The signed QR and its code are ALWAYS Wallet-native; never paint a QR here.
// All member photos remain in-memory and are packed into the signed .pkpass.
import { Buffer } from "node:buffer";
import jpeg from "jpeg-js";
import { approvedBlackMarbleJpegB64 } from "./wallet-approved-marble-data.js";

function crc32(bytes) {
  let c=0xffffffff;
  for (let i=0;i<bytes.length;i++) {
    c^=bytes[i];
    for(let b=0;b<8;b++) c=(c>>>1)^((c&1)?0xedb88320:0);
  }
  return (c^0xffffffff)>>>0;
}
function chunk(tag,data) {
  const type=Buffer.from(tag,"ascii"),out=Buffer.alloc(12+data.length);
  out.writeUInt32BE(data.length,0);
  type.copy(out,4);
  data.copy(out,8);
  out.writeUInt32BE(crc32(out.subarray(4,8+data.length)),8+data.length);
  return out;
}
async function encodePng(w,h,rgba) {
  const scanlines=Buffer.alloc(h*(w*4+1));
  for(let y=0;y<h;y++) {
    const at=y*(w*4+1);
    scanlines[at]=0;
    rgba.copy(scanlines,at+1,y*w*4,(y+1)*w*4);
  }
  const deflate=new CompressionStream("deflate");
  const writer=deflate.writable.getWriter();
  const result=new Response(deflate.readable).arrayBuffer();
  await writer.write(scanlines);
  await writer.close();
  const compressed=Buffer.from(await result);
  const info=Buffer.alloc(13);
  info.writeUInt32BE(w,0);
  info.writeUInt32BE(h,4);
  info[8]=8;
  info[9]=6;
  return Buffer.concat([Buffer.from("89504e470d0a1a0a","hex"),
    chunk("IHDR",info),chunk("IDAT",compressed),chunk("IEND",Buffer.alloc(0))]);
}
const clamp=(n)=>Math.max(0,Math.min(255,Math.round(n)));
// Read the original silver ALIGN logo, including BELONG TO SOMETHING.
// The repository asset is an 8-bit indexed PNG with a transparent palette.
// We composite it into the Poster background at a much larger size than
// Apple's small automatic primaryLogo slot (which otherwise duplicates it).
let decodedLogo;
async function posterWordmark() {
  if (decodedLogo) return decodedLogo;
  decodedLogo=(async()=>{
    const png=Buffer.from(walletLogoB64,"base64");
    if(png.subarray(0,8).toString("hex")!=="89504e470d0a1a0a")throw new Error("Invalid ALIGN wordmark");
    let offset=8,width=0,height=0,depth=0,colorType=0,palette=null,opacity=null;
    const idats=[];
    while(offset+12<=png.length) {
      const size=png.readUInt32BE(offset),kind=png.toString("ascii",offset+4,offset+8);
      if(offset+size+12>png.length)throw new Error("Invalid wordmark PNG chunk");
      const bytes=png.subarray(offset+8,offset+8+size);
      if(kind==="IHDR"){
        width=bytes.readUInt32BE(0);height=bytes.readUInt32BE(4);
        depth=bytes[8];colorType=bytes[9];
      }
      if(kind==="PLTE")palette=bytes;
      if(kind==="tRNS")opacity=bytes;
      if(kind==="IDAT")idats.push(bytes);
      offset+=size+12;
      if(kind==="IEND")break;
    }
    if(depth!==8||colorType!==3||!palette||width<100||height<30||
       width>1600||height>600||idats.length===0)throw new Error("Unsupported ALIGN logo PNG");
    const stream=new DecompressionStream("deflate");
    const writer=stream.writable.getWriter();
    const inflated=new Response(stream.readable).arrayBuffer();
    await writer.write(Buffer.concat(idats));await writer.close();
    const src=Buffer.from(await inflated);
    const lines=Buffer.alloc(width*height),bpp=1;
    let pos=0;
    const paeth=(a,b,c)=>{
      const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);
      return pa<=pb&&pa<=pc?a:pb<=pc?b:c;
    };
    for(let y=0;y<height;y++) {
      if(pos+1+width>src.length)throw new Error("Truncated ALIGN logo");
      const filter=src[pos++],row=y*width;
      if(filter>4)throw new Error("Invalid PNG filter");
      for(let x=0;x<width;x++) {
        const raw=src[pos++],left=x>=bpp?lines[row+x-bpp]:0;
        const up=y>0?lines[row-width+x]:0;
        const diagonal=y>0&&x>=bpp?lines[row-width+x-bpp]:0;
        const predictor=filter===0?0:filter===1?left:filter===2?up:
          filter===3?Math.floor((left+up)/2):paeth(left,up,diagonal);
        lines[row+x]=(raw+predictor)&255;
      }
    }
    const rgba=Buffer.alloc(width*height*4);
    for(let i=0;i<lines.length;i++){
      const idx=lines[i],p=idx*3,out=i*4;
      if(p+2>=palette.length)throw new Error("Invalid ALIGN palette index");
      const shade=(palette[p]+palette[p+1]+palette[p+2])/3;
      // Re-map the original silver lettering for contrast on deep black.
      const silver=clamp(154+shade*.38);
      rgba[out]=silver;
      rgba[out+1]=clamp(silver+1);
      rgba[out+2]=clamp(silver+3);
      rgba[out+3]=idx<(opacity?.length||0)?opacity[idx]:255;
    }
    return {width,height,data:rgba};
  })();
  return decodedLogo;
}
const PERSONAL_GLYPHS={"0":"01110100011001110101110011000101110","1":"00100011000010000100001000010001110","2":"01110100010000100010001000100011111","3":"11110000010000101110000010000111110","4":"00010001100101010010111110001000010","5":"11111100001000011110000010000111110","6":"01110100001000011110100011000101110","7":"11111000010001000100010000100001000","8":"01110100011000101110100011000101110","9":"01110100011000101111000010000101110","A":"01110100011000111111100011000110001","B":"11110100011000111110100011000111110","C":"01111100001000010000100001000001111","D":"11110100011000110001100011000111110","E":"11111100001000011110100001000011111","F":"11111100001000011110100001000010000","G":"01111100001000010111100011000101110","H":"10001100011000111111100011000110001","I":"11111001000010000100001000010011111","J":"00111000100001000010100101001001100","K":"10001100101010011000101001001010001","L":"10000100001000010000100001000011111","M":"10001110111010110101100011000110001","N":"10001110011010110011100011000110001","O":"01110100011000110001100011000101110","P":"11110100011000111110100001000010000","Q":"01110100011000110001101011001001101","R":"11110100011000111110101001001010001","S":"01111100001000001110000010000111110","T":"11111001000010000100001000010000100","U":"10001100011000110001100011000101110","V":"10001100011000110001100010101000100","W":"10001100011000110101101011010101010","X":"10001100010101000100010101000110001","Y":"10001100010101000100001000010000100","Z":"11111000010001000100010001000011111","$":"00100011111010001110001011111000100","-":"00000000000000011111000000000000000",".":"00000000000000000000000000110001100",",":"00000000000000000000001100010001000","/":"00001000010001000100010001000010000",":":"00000011000110000000011000110000000","+":"00000001000010011111001000010000000"," ":"00000000000000000000000000000000000"};
function walletDisplayText(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toUpperCase().replace(/[^A-Z0-9 $,.:+/-]/g," ");
}
// Small antialiased silver sans letterforms, rendered into the signed artwork.
// All member data remains private and stays inside each member's .pkpass.
// Fine high-contrast serif alphabet rasterized from a licensed local font
// into an in-repository bitmap atlas (16x20, 40 glyphs, 1 bit/pixel).
// This avoids the old blocky 5x7 pixel typography on the iPhone.
const SERIF_CHARS="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789$.,-";
const SERIF_BITS=Buffer.from("AAAAAAYABgAHAAMACwABgAGAH4AQwADAIOBw4AAAAAAAAAAAAAAAAAAAAAA/ABmAGYAZgBmAHwAZgBjAGMAYwBmAPwAAAAAAAAAAAAAAAAAAAAAAD4AZwDDAMAAwADAAMAAwADAAMMAYwA+AAAAAAAAAAAAAAAAAAAAAAD+AGcAYwBjgGGAYYBhgGGAY4BjAGcA/AAAAAAAAAAAAAAAAAAAAAAA/gBiAGAAYABgAHwAYABgAGAAYQBjAP8AAAAAAAAAAAAAAAAAAAAAAP4AYgBgAGAAYABgAGAAYABgAGAAYADwAAAAAAAAAAAAAAAAAAAAAAA+AGMAwwDAAMAAwADHgMMAwwDDAGMAPwAAAAAAAAAAAAAAAAAAAAAA88BhgGGAYYBhgGOAY4BhgGGAYYBhgPPAAAAAAAAAAAAAAAAAAAAAAPAAYABgAGAAYABgAGAAYABgAGAAYADwAAAAAAAAAAAAAAAAAAAAAADwAGAAYABgAGAAYABgAGAAYABgAGAAYABgAGAAwACAAAAAAAAAAAAAAADzAGIAZABkAGgAeAB8AG4AZgBnAOOA8YAAAAAAAAAAAAAAAAAAAAAA8ABgAGAAYABgAGAAYABgAGAAYQDjAP8AAAAAAAAAAAAAAAAAAAAAAOBwYGBw4DDgOGBZYFlgXGBMYA5gRmDk8AAAAAAAAAAAAAAAAAAAAADhgHEAMAA5AFkATQBOAEYARwADAEMA4QAAAAAAAAAAAAAAAAAAAAAAPgBjAMOAwYDBgMGAwYDBgMGAwwBjAD4AAAAAAAAAAAAAAAAAAAAAAPwAZgBmAGcAZgBmAG4AeABgAGAA4ADwAAAAAAAAAAAAAAAAAAAAAAA+AGMAw4DBgMGAwYDBgMGAwYDDAGMAPgAcAAwADgACAAAAAAAAAAAA/ABmAGYAZgBmAGYAfABsAG4AZgDnAPMAAAAAAAAAAAAAAAAAAAAAAHgAzADMAMAA4AB4ADwADACOAYwAzAB4AAAAAAAAAAAAAAAAAAAAAAH/ATkAOQA4ADgAOAA4ADgAOAA4ADgAOAAAAAAAAAAAAAAAAAAAAAAAAADjgOEA4QDhAOEA4QDhAOEA4QBhAHIAPAAAAAAAAAAAAAAAAAAAAAAB4wDAAOIAYgBiAHQANAA0ADgAGAAYABgAAAAAAAAAAAAAAAAAAAAAAOMYwwDjEGMQZZB1gDWAMcA4wDjAGMAQQAAAAAAAAAAAAAAAAAAAAADnAGIAdAA0ADgAGAAYACwALABGAMcAxwAAAAAAAAAAAAAAAAAAAAAA4wBiAGIAMAA0ADgAGAAYABgAGAAYADwAAAAAAAAAAAAAAAAAAAAAAP4AjgAMABgAGAA4ADAAcABgAOIAwgD+AAAAAAAAAAAAAAAAAAAAAAB4AMwAzADOAc4BxgHGAM4AzADMAGwAOAAAAAAAAAAAAAAAAAAAAAAAMADwAPAAMAAwADAAMAAwADAAMAA4AHgAAAAAAAAAAAAAAAAAAAAAAPgAzADMAAwADAAYADAAIABAAIQB/AD8AAAAAAAAAAAAAAAAAAAAAAD4AMwAzAAMABwAOAAMAA4AjgCMAMwAeAAAAAAAAAAAAAAAAAAAAAAAAAAcABwAPABcAFwAnAAYAf4B/gAYABwAHAAAAAAAAAAAAAAAAAAAAAAA/AD8AIAAAAD4AIwADAAMAAwAzADcAHAAAAAAAAAAAAAAAAAAAAAAAHwAbADEAMAA3ADMAM4AzgDOAMwAbAA4AAAAAAAAAAAAAAAAAAAAAAD+APwABAAMAAwACAAYABgAEAAwADAAIAAAAAAAAAAAAAAAAAAAAAAAfADMAMwAzADsAHgA3ADOAcYAxgDMAHgAAAAAAAAAAAAAAAAAAAAAAHgAzADMAMwAzgDOAH4ADAAMAIwA2ABwAAAAAAAAAAAAAAAAAAAAAAAwAHwAzADMAOAAcAA8ABwAjADMAOwAMAAAAAAAAAAAAAAAAAAAAAAAwADAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMAAwABAAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==","base64");
const glyphWidths=Array.from(SERIF_CHARS,(_,i)=>{
  let max=0,min=16;
  for(let y=0;y<20;y++)for(let x=0;x<16;x++){
    const at=i*320+y*16+x;
    if((SERIF_BITS[at>>3]>>(7-(at&7)))&1){min=Math.min(min,x);max=Math.max(max,x)}
  }
  return min>max?{min:0,width:5}:{min,width:max-min+1};
});
function isSerifPixel(index,x,y){
  if(index<0||x<0||x>=16||y<0||y>=20)return 0;
  const at=index*320+y*16+x;
  return (SERIF_BITS[at>>3]>>(7-(at&7)))&1;
}
function drawMemberText(pixels,w,h,value,x,y,desiredHeight,maxWidth){
  const str=walletDisplayText(value).replace(/\s+/g," ").trim();
  if(!str)return;
  const chars=[...str];
  const estimated=chars.reduce((a,ch)=>a+(ch===" "?6:(glyphWidths[SERIF_CHARS.indexOf(ch)]?.width||7)+3),0);
  // Use proportional serif letterforms, not the old monospaced bitmap glyphs.
  const baseScale=Math.min(desiredHeight/15,maxWidth/estimated);
  const scale=baseScale*w/358;
  let pen=x*w/358,top=y*w/358;
  const white=[226,229,235];
  for(const char of chars){
    if(char===" "){pen+=6*scale;continue;}
    const index=SERIF_CHARS.indexOf(char);
    if(index<0){pen+=7*scale;continue;}
    const metrics=glyphWidths[index],gw=metrics.width;
    const destW=Math.ceil(gw*scale),destH=Math.ceil(20*scale);
    for(let yy=0;yy<destH;yy++)for(let xx=0;xx<destW;xx++){
      const gx=metrics.min+(xx+.5)/scale-.5,gy=(yy+.5)/scale-.5;
      const bx=Math.floor(gx),by=Math.floor(gy),fx=gx-bx,fy=gy-by;
      const a=(isSerifPixel(index,bx,by)*(1-fx)*(1-fy)+
        isSerifPixel(index,bx+1,by)*fx*(1-fy)+
        isSerifPixel(index,bx,by+1)*(1-fx)*fy+
        isSerifPixel(index,bx+1,by+1)*fx*fy)*.93;
      if(a<=0)continue;
      const px=Math.floor(pen+xx),py=Math.floor(top+yy);
      if(px<0||py<0||px>=w||py>=h)continue;
      const p=(py*w+px)*4;
      for(let i=0;i<3;i++)pixels[p+i]=clamp(pixels[p+i]*(1-a)+white[i]*a);
    }
    pen+=(gw+3)*scale;
  }
}
function stampWordmark(pixels,width,height,logo) {
  const scale=width/358;
  const destW=Math.round(302*scale);
  const destH=Math.round(destW*logo.height/logo.width);
  const startX=Math.round((width-destW)/2),startY=Math.round(19*scale);
  for(let y=0;y<destH;y++) {
    const sy=Math.min(logo.height-1,Math.floor((y+.5)*logo.height/destH));
    for(let x=0;x<destW;x++) {
      const sx=Math.min(logo.width-1,Math.floor((x+.5)*logo.width/destW));
      const si=(sy*logo.width+sx)*4,alpha=logo.data[si+3]/255;
      if(alpha===0)continue;
      const dx=startX+x,dy=startY+y;
      if(dx<0||dy<0||dx>=width||dy>=height)continue;
      const di=(dy*width+dx)*4;
      for(let channel=0;channel<3;channel++)
        pixels[di+channel]=clamp(pixels[di+channel]*(1-alpha)+logo.data[si+channel]*alpha);
    }
  }
  // Hairline separates the brand from the personalized membership details.
  const underlineY=Math.round(128*scale),left=Math.round(28*scale);
  const right=Math.round(330*scale);
  for(let y=underlineY;y<underlineY+Math.max(1,Math.round(scale));y++) {
    if(y>=height)break;
    for(let x=left;x<right;x++){
      const i=(y*width+x)*4;
      pixels[i]=clamp(pixels[i]*.55+217*.45);
      pixels[i+1]=clamp(pixels[i+1]*.55+221*.45);
      pixels[i+2]=clamp(pixels[i+2]*.55+227*.45);
    }
  }
}
// Deterministic marble: deep navy and royal-cobalt clouds with thin, soft
// white veins. The center remains dark so member text and the native QR
// remain legible. No network image dependencies or additional fonts.
// ALIGN's exact user-approved marble image already contains the original
// centered chrome logo and tagline. Do NOT draw or replace that branding.
// Each .pkpass gets its own member name, savings and private photo.
let approvedBackground=null;
function getApprovedBackground(){
  if(!approvedBackground){
    const bytes=Buffer.from(approvedBlackMarbleJpegB64,"base64");
    approvedBackground=jpeg.decode(bytes,{useTArray:true,formatAsRGBA:true,
      tolerantDecoding:false,maxResolutionInMP:1,maxMemoryUsageInMB:12});
    if(approvedBackground.width!==358||approvedBackground.height!==448)
      throw new Error("Approved Wallet background has invalid dimensions");
  }
  return approvedBackground;
}
function drawBlackPoster(w,h,portrait,member) {
  const original=getApprovedBackground();
  const pixels=Buffer.alloc(w*h*4);
  const scale=w/358;
  // Copy the actual uploaded image, not procedural blue/black marble.
  for(let y=0;y<h;y++){
    const sy=Math.min(447,Math.floor(y/scale));
    for(let x=0;x<w;x++){
      const sx=Math.min(357,Math.floor(x/scale));
      const i=(y*w+x)*4,j=(sy*358+sx)*4;
      pixels[i]=original.data[j];
      pixels[i+1]=original.data[j+1];
      pixels[i+2]=original.data[j+2];
      pixels[i+3]=255;
    }
  }
  if(portrait){
    const {width:pw,height:ph,data}=portrait;
    if(pw>0&&ph>0&&pw<=1800&&ph<=1800&&data?.length===pw*ph*4){
      const side=Math.round(68*scale),x0=Math.round(261*scale),y0=Math.round(145*scale);
      const crop=Math.min(pw,ph),ox=Math.floor((pw-crop)/2),oy=Math.floor((ph-crop)/2);
      // The user requested no frames around the member's photo.
      for(let y=0;y<side;y++)for(let x=0;x<side;x++){
        const xx=x0+x,yy=y0+y,srcX=ox+Math.min(crop-1,Math.floor(x*crop/side)),
          srcY=oy+Math.min(crop-1,Math.floor(y*crop/side));
        const p=(yy*w+xx)*4,q=(srcY*pw+srcX)*4;
        pixels[p]=data[q];pixels[p+1]=data[q+1];pixels[p+2]=data[q+2];
      }
    }
  }
  // Keep every overlay ABOVE the real iPhone's native QR region, which starts
  // around artwork y=216. Never paint membership, a duplicate logo or a QR.
  drawMemberText(pixels,w,h,member?.name||"",28,149,13,218);
  drawMemberText(pixels,w,h,member?.savings||"",28,183,16,225);
  return pixels;
}
export async function blackWalletArtwork({photo=null,name="",savings=""}={}) {
  const member={name,savings};
  return {
    normal:await encodePng(358,448,drawBlackPoster(358,448,photo,member)),
    retina:await encodePng(716,896,drawBlackPoster(716,896,photo,member))
  };
}
