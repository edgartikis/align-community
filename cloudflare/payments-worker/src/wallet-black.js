// ALIGN Black Edition — native Poster Generic background for iOS 27+.
// Poster layout and barcode remain Wallet-native; this only draws pass artwork.
// All member photos remain in-memory and are packed into the signed .pkpass.
import { Buffer } from "node:buffer";
import { walletLogoB64 } from "./wallet-artwork-data.js";

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
  const underlineY=Math.round(142*scale),left=Math.round(27*scale);
  const right=width-left;
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
function drawBlackPoster(w,h,portrait,logo) {
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
      // Fine satin-silver rounded outline like ALIGN's approved Black Edition.
      // Keep it faint so native Wallet text and the QR remain fully legible.
      const margin=14*scale,radius=20*scale;
      const halfW=w/2-margin,halfH=h/2-margin;
      const px=Math.abs(x-w/2)-(halfW-radius);
      const py=Math.abs(y-h/2)-(halfH-radius);
      const signedDistance=Math.hypot(Math.max(px,0),Math.max(py,0))+
        Math.min(Math.max(px,py),0)-radius;
      const outline=Math.max(0,1-Math.abs(signedDistance)/(1.0*scale));
      const silver=outline*.55;
      pixels[p]=clamp(black*(1-silver)+217*silver);
      pixels[p+1]=clamp(black*(1-silver)+221*silver);
      pixels[p+2]=clamp((black+1)*(1-silver)+227*silver);
      pixels[p+3]=255;
    }
  }
  // A restrained silver border around the photograph; no decorative stars.
  if(portrait) {
    const {width:pw,height:ph,data}=portrait;
    if(pw>0&&ph>0&&pw<=1800&&ph<=1800&&data?.length===pw*ph*4) {
      const portraitSide=Math.round(74*scale);
      const x0=Math.round(256*scale), y0=Math.round(160*scale);
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
  stampWordmark(pixels,w,h,logo);
  return pixels;
}
let sharedBlack;
export async function blackWalletArtwork(photo) {
  if(!photo&&sharedBlack)return sharedBlack;
  const render=async()=>{
    const logo=await posterWordmark();
    return {
      normal:await encodePng(358,448,drawBlackPoster(358,448,photo,logo)),
      retina:await encodePng(716,896,drawBlackPoster(716,896,photo,logo))
    };
  };
  if(!photo) {
    sharedBlack=render();
    return sharedBlack;
  }
  return render();
}
