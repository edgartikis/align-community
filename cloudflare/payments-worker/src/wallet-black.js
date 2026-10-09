// ALIGN Black Edition — native Poster Generic background for iOS 27+.
// Poster layout and barcode remain Wallet-native; this only draws pass artwork.
// All member photos remain in-memory and are packed into the signed .pkpass.
import { Buffer } from "node:buffer";

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
function drawBlackPoster(w,h,portrait) {
  const pixels=Buffer.alloc(w*h*4);
  const scale=w/358;
  for (let y=0;y<h;y++) {
    const yn=y/h;
    for(let x=0;x<w;x++) {
      const xn=x/w;
      // Near-black satin: dimensional but never a marble, stars, or visual clutter.
      const nearEdge=Math.min(xn,1-xn,yn,1-yn);
      const sheen=5*Math.exp(-Math.pow((xn-.64)*2.8,2)-Math.pow((yn-.18)*2.4,2));
      const mid=2*Math.exp(-Math.pow((xn-.48)*2.1,2)-Math.pow((yn-.49)*2.0,2));
      const edgeShade=Math.min(2.5,nearEdge*7);
      const black=clamp(5+sheen+mid+edgeShade);
      const p=(y*w+x)*4;
      pixels[p]=black;
      pixels[p+1]=black;
      pixels[p+2]=clamp(black+1);
      pixels[p+3]=255;
    }
  }
  // A restrained silver border around the photograph; no decorative stars.
  if(portrait) {
    const {width:pw,height:ph,data}=portrait;
    if(pw>0&&ph>0&&pw<=1800&&ph<=1800&&data?.length===pw*ph*4) {
      const portraitSide=Math.round(74*scale);
      const x0=Math.round(267*scale), y0=Math.round(94*scale);
      const frame=Math.max(1,Math.round(2*scale));
      const radius=Math.round(7*scale);
      const crop=Math.min(pw,ph);
      const ox=Math.floor((pw-crop)/2),oy=Math.floor((ph-crop)/2);
      for(let py=-frame;py<portraitSide+frame;py++){
        for(let px=-frame;px<portraitSide+frame;px++){
          const xx=x0+px, yy=y0+py;
          if(xx<0||yy<0||xx>=w||yy>=h)continue;
          const innerX=Math.max(radius,Math.min(portraitSide-radius,px));
          const innerY=Math.max(radius,Math.min(portraitSide-radius,py));
          const distance=Math.hypot(px-innerX,py-innerY);
          if(distance>radius+frame)continue;
          const p=(yy*w+xx)*4;
          if(px<0||py<0||px>=portraitSide||py>=portraitSide||distance>radius) {
            pixels[p]=217;pixels[p+1]=221;pixels[p+2]=227;
          } else {
            const sx=ox+Math.min(crop-1,Math.floor((px+.5)*crop/portraitSide));
            const sy=oy+Math.min(crop-1,Math.floor((py+.5)*crop/portraitSide));
            const src=(sy*pw+sx)*4;
            pixels[p]=data[src];pixels[p+1]=data[src+1];pixels[p+2]=data[src+2];
          }
        }
      }
    }
  }
  return pixels;
}
let sharedBlack;
export async function blackWalletArtwork(photo) {
  if(!photo&&sharedBlack)return sharedBlack;
  const render=async()=>({
    normal:await encodePng(358,448,drawBlackPoster(358,448,photo)),
    retina:await encodePng(716,896,drawBlackPoster(716,896,photo))
  });
  if(!photo) {
    sharedBlack=render();
    return sharedBlack;
  }
  return render();
}
