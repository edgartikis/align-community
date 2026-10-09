// Royal-blue marble artwork for Apple Wallet Poster Generic (iOS 27+).
// Pure Worker-side PNG generation, no third-party image host, no personal URLs.
// Older Wallet versions use the standard solid-color generic fallback.
import { Buffer } from "node:buffer";

function crc32(bytes) {
  let value=0xffffffff;
  for (let i=0;i<bytes.length;i++) {
    value^=bytes[i];
    for (let j=0;j<8;j++) value=(value>>>1)^((value&1)?0xedb88320:0);
  }
  return (value^0xffffffff)>>>0;
}
function chunk(label,bytes) {
  const name=Buffer.from(label,"ascii"),out=Buffer.alloc(12+bytes.length);
  out.writeUInt32BE(bytes.length,0);
  name.copy(out,4);
  bytes.copy(out,8);
  out.writeUInt32BE(crc32(out.subarray(4,8+bytes.length)),8+bytes.length);
  return out;
}
async function encodePng(width,height,rgba) {
  const stride=width*4;
  const scanlines=Buffer.alloc(height*(stride+1));
  for(let y=0;y<height;y++){
    const row=y*(stride+1);
    scanlines[row]=0;
    rgba.copy(scanlines,row+1,y*stride,(y+1)*stride);
  }
  const compressor=new CompressionStream("deflate");
  const writer=compressor.writable.getWriter();
  const result=new Response(compressor.readable).arrayBuffer();
  await writer.write(scanlines);
  await writer.close();
  const data=Buffer.from(await result);
  const header=Buffer.alloc(13);
  header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);
  header[8]=8;header[9]=6;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a","hex"),
    chunk("IHDR",header),
    chunk("IDAT",data),
    chunk("IEND",Buffer.alloc(0))
  ]);
}
const clamp=(v)=>Math.max(0,Math.min(255,Math.round(v)));
function drawArtwork(width,height,memberPhoto) {
  const rgba=Buffer.alloc(width*height*4);
  for(let y=0;y<height;y++) {
    const fy=y/height;
    const curl=.034*Math.sin(y*.029)+.021*Math.sin(y*.013+1.7);
    const r1=.17+.105*Math.sin(fy*7.6+1.6)+curl;
    const r2=.76+.13*Math.sin(fy*6.4+.4)-curl;
    const r3=.47+.09*Math.sin(fy*9.2+3.2)+curl*.6;
    for(let x=0;x<width;x++){
      const fx=x/width;
      const navyWave=.5+.5*Math.sin(fx*6.4+fy*7.3+Math.sin(fy*11.4)*.55);
      const shade=.07+.13*navyWave;
      const fine=(Math.sin(fx*37+fy*19+Math.sin(fy*16)*2)+1)*.5;
      const navy=Math.min(.30,shade + fine*.035);
      const vein1=Math.exp(-Math.pow((fx-r1)/.0025,2));
      const vein2=Math.exp(-Math.pow((fx-r2)/.0034,2));
      const vein3=Math.exp(-Math.pow((fx-r3)/.0047,2));
      const white=Math.min(.32,vein1*.23+vein2*.18+vein3*.09);
      const shadowVein=Math.min(.34,
        Math.exp(-Math.pow((fx-r1-.012)/.019,2))*.22 +
        Math.exp(-Math.pow((fx-r2+.018)/.027,2))*.18);
      const deep=navy+shadowVein;
      const i=(y*width+x)*4;
      rgba[i]=clamp(15*(1-deep-white)+6*deep+243*white);
      rgba[i+1]=clamp(76*(1-deep-white)+27*deep+245*white);
      rgba[i+2]=clamp(222*(1-deep-white)+79*deep+249*white);
      rgba[i+3]=255;
    }
  }
  if (memberPhoto) {
    const {width:sw,height:sh,data}=memberPhoto;
    if(sw>0&&sh>0&&sw<=1800&&sh<=1800&&data?.length===sw*sh*4) {
      // A subtle small portrait in the upper-right artwork area, not the barcode area.
      // On iOS 26 and earlier the native generic thumbnail is used instead.
      const scale=width/358,side=Math.floor(74*scale);
      const px=Math.floor(width-104*scale),py=Math.floor(88*scale);
      const crop=Math.min(sw,sh),left=Math.floor((sw-crop)/2),top=Math.floor((sh-crop)/2);
      const radius=Math.floor(9*scale);
      for(let yy=-3*scale|0;yy<side+3*scale;yy++){
        for(let xx=-3*scale|0;xx<side+3*scale;xx++){
          const tx=px+xx,ty=py+yy;
          if(tx<0||ty<0||tx>=width||ty>=height)continue;
          const d=(yy*side+xx);
          // Rounded framed portrait, no personal image is used outside the frame.
          const cxx=Math.max(radius,Math.min(side-radius,xx));
          const cyy=Math.max(radius,Math.min(side-radius,yy));
          const distance=Math.hypot(xx-cxx,yy-cyy);
          if(distance>radius+2*scale)continue;
          const o=(ty*width+tx)*4;
          if(xx<0||yy<0||xx>=side||yy>=side||distance>radius){
            rgba[o]=221;rgba[o+1]=226;rgba[o+2]=235;continue;
          }
          const sy=top+Math.min(crop-1,Math.floor((yy+.5)*crop/side));
          const sx=left+Math.min(crop-1,Math.floor((xx+.5)*crop/side));
          const src=(sy*sw+sx)*4;
          rgba[o]=data[src];rgba[o+1]=data[src+1];rgba[o+2]=data[src+2];
        }
      }
    }
  }
  return rgba;
}
let commonMarble;
export async function marbleWalletArtwork(memberPhoto) {
  if(!memberPhoto && commonMarble)return commonMarble;
  const make=async()=>{
    const normal=await encodePng(358,448,drawArtwork(358,448,memberPhoto));
    const retina=await encodePng(716,896,drawArtwork(716,896,memberPhoto));
    return {normal,retina};
  };
  if(!memberPhoto) {
    commonMarble=make();
    return commonMarble;
  }
  return make();
}
