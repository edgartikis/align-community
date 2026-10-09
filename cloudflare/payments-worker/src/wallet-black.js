// ALIGN Royal Marble Edition — Poster Generic artwork for compatible iOS.
// Fixed branded marble background + member-specific image text/photo.
// The signed QR and its code are ALWAYS Wallet-native; never paint a QR here.
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
const PERSONAL_GLYPHS={"0":"01110100011001110101110011000101110","1":"00100011000010000100001000010001110","2":"01110100010000100010001000100011111","3":"11110000010000101110000010000111110","4":"00010001100101010010111110001000010","5":"11111100001000011110000010000111110","6":"01110100001000011110100011000101110","7":"11111000010001000100010000100001000","8":"01110100011000101110100011000101110","9":"01110100011000101111000010000101110","A":"01110100011000111111100011000110001","B":"11110100011000111110100011000111110","C":"01111100001000010000100001000001111","D":"11110100011000110001100011000111110","E":"11111100001000011110100001000011111","F":"11111100001000011110100001000010000","G":"01111100001000010111100011000101110","H":"10001100011000111111100011000110001","I":"11111001000010000100001000010011111","J":"00111000100001000010100101001001100","K":"10001100101010011000101001001010001","L":"10000100001000010000100001000011111","M":"10001110111010110101100011000110001","N":"10001110011010110011100011000110001","O":"01110100011000110001100011000101110","P":"11110100011000111110100001000010000","Q":"01110100011000110001101011001001101","R":"11110100011000111110101001001010001","S":"01111100001000001110000010000111110","T":"11111001000010000100001000010000100","U":"10001100011000110001100011000101110","V":"10001100011000110001100010101000100","W":"10001100011000110101101011010101010","X":"10001100010101000100010101000110001","Y":"10001100010101000100001000010000100","Z":"11111000010001000100010001000011111","$":"00100011111010001110001011111000100","-":"00000000000000011111000000000000000",".":"00000000000000000000000000110001100",",":"00000000000000000000001100010001000","/":"00001000010001000100010001000010000",":":"00000011000110000000011000110000000","+":"00000001000010011111001000010000000"," ":"00000000000000000000000000000000000"};
function walletDisplayText(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toUpperCase().replace(/[^A-Z0-9 $,.:+/-]/g," ");
}
// Small antialiased silver sans letterforms, rendered into the signed artwork.
// All member data remains private and stays inside each member's .pkpass.
function drawMemberText(pixels,w,h,value,x,y,desiredHeight,maxWidth) {
  let chars=walletDisplayText(value).replace(/\s+/g," ").trim();
  const scale=w/358;
  if(!chars)return;
  const advance=6/7,minimumSize=7.5;
  const maxChars=Math.max(3,Math.floor(maxWidth/(minimumSize*advance)));
  // A longer name is readable in full on the pass reverse; ellipsize on
  // artwork rather than allowing it to overlap the private portrait.
  if(chars.length>maxChars)chars=chars.slice(0,maxChars-1).trimEnd()+".";
  const size=Math.max(minimumSize,Math.min(desiredHeight,maxWidth/(chars.length*advance)));
  const unit=size*scale/7;
  let cursor=x*scale;
  for(const ch of chars) {
    const glyph=PERSONAL_GLYPHS[ch]||PERSONAL_GLYPHS[" "];
    for(let row=0;row<7;row++) for(let col=0;col<5;col++) {
      if(glyph[row*5+col]!=="1")continue;
      const x0=cursor+col*unit,y0=y*scale+row*unit;
      const x1=x0+unit*.95,y1=y0+unit*.95;
      for(let yy=Math.max(0,Math.floor(y0));yy<Math.min(h,Math.ceil(y1));yy++) {
        for(let xx=Math.max(0,Math.floor(x0));xx<Math.min(w,Math.ceil(x1));xx++) {
          const alpha=Math.max(0,Math.min(x1,xx+1)-Math.max(x0,xx))*
            Math.max(0,Math.min(y1,yy+1)-Math.max(y0,yy))*.94;
          if(alpha===0)continue;
          const p=(yy*w+xx)*4;
          pixels[p]=clamp(pixels[p]*(1-alpha)+217*alpha);
          pixels[p+1]=clamp(pixels[p+1]*(1-alpha)+221*alpha);
          pixels[p+2]=clamp(pixels[p+2]*(1-alpha)+227*alpha);
        }
      }
    }
    cursor+=6*unit;
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
function drawMarblePoster(w,h,portrait,logo,member) {
  const pixels=Buffer.alloc(w*h*4);
  const scale=w/358;
  for (let y=0;y<h;y++) {
    const yn=y/h;
    const qrZone=Math.max(0,Math.min(1,(yn-.52)*5));
    for(let x=0;x<w;x++) {
      const xn=x/w;
      const swirl=.074*Math.sin(yn*11.7+xn*5.4)+
        .027*Math.sin(yn*25.1-xn*11.3);
      const course=xn*.94-yn*.65+swirl;
      const cloud=.5+.5*Math.sin(course*8.6+1.3*Math.sin(yn*4.1));
      const haze=.5+.5*Math.sin(xn*8.8+yn*7.5+
        .7*Math.sin(xn*13.8-yn*6.7));
      // Blue marble has broad waves and a few elegant white veins.
      const blue=.2+cloud*.49+haze*.31;
      const inset=Math.min(xn,1-xn,yn,1-yn);
      const depth=.75+.25*Math.min(1,inset*7);
      const veinPath=course*11.8+.27*Math.sin(yn*13.4+xn*4.9);
      const thin=Math.exp(-Math.pow(Math.sin(veinPath)/.048,2));
      const faint=Math.exp(-Math.pow(Math.sin(veinPath+1.4)/.11,2));
      const vein=thin*.39+faint*.10;
      // Restrained texture near the identity, stronger toward card edges.
      const edge=Math.min(1,Math.abs(xn-.5)*1.55+.18);
      const fade=1-qrZone*.3;
      const white=(vein*(.32+.68*edge)*fade);
      const darkCenter=1-.16*Math.exp(-Math.pow((xn-.49)/.37,2));
      const p=(y*w+x)*4;
      let red=(8+19*blue)*depth*darkCenter;
      let green=(25+62*blue)*depth*darkCenter;
      let blueChannel=(71+143*blue)*depth*darkCenter;
      // Marble vein appears silver-white rather than a bright neon streak.
      pixels[p]=clamp(red*(1-white)+239*white);
      pixels[p+1]=clamp(green*(1-white)+244*white);
      pixels[p+2]=clamp(blueChannel*(1-white)+251*white);
      pixels[p+3]=255;
    }
  }
  // Restrained silver outline; both native code and artwork remain legible.
  const radius=18*scale,margin=12*scale;
  for(let y=0;y<h;y++){
    const ty=Math.abs(y-h/2)-(h/2-margin-radius);
    for(let x=0;x<w;x++){
      const tx=Math.abs(x-w/2)-(w/2-margin-radius);
      const d=Math.hypot(Math.max(tx,0),Math.max(ty,0))+
        Math.min(Math.max(tx,ty),0)-radius;
      const tint=Math.max(0,1-Math.abs(d)/(1.2*scale))*.50;
      if(tint<=0)continue;
      const p=(y*w+x)*4;
      pixels[p]=clamp(pixels[p]*(1-tint)+216*tint);
      pixels[p+1]=clamp(pixels[p+1]*(1-tint)+224*tint);
      pixels[p+2]=clamp(pixels[p+2]*(1-tint)+235*tint);
    }
  }
  // A restrained silver border around the photograph; no decorative stars.
  if(portrait) {
    const {width:pw,height:ph,data}=portrait;
    if(pw>0&&ph>0&&pw<=1800&&ph<=1800&&data?.length===pw*ph*4) {
      const portraitSide=Math.round(74*scale);
      const x0=Math.round(256*scale), y0=Math.round(144*scale);
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
  // Artwork personalized at signing time, not fields that iOS may relocate.
  // Text and portrait sit in the upper third; the lower half stays free for
  // Apple's native, scannable QR and member-code altText.
  drawMemberText(pixels,w,h,"SOCIO",28,142,9,211);
  drawMemberText(pixels,w,h,member?.name||"",28,155,14.5,214);
  drawMemberText(pixels,w,h,"MEMBRESIA",28,179,9,211);
  drawMemberText(pixels,w,h,member?.membership||"",28,191,12.5,214);
  drawMemberText(pixels,w,h,"AHORRADO",28,218,9,211);
  drawMemberText(pixels,w,h,member?.savings||"",28,231,17,222);
  return pixels;
}
// Member name, tier, savings and portrait are in each individually signed pass.
// The same branded royal-marble design is recreated with deterministic math.
export async function blackWalletArtwork({photo=null,name="",membership="",savings=""}={}) {
  const logo=await posterWordmark();
  const member={name,membership,savings};
  return {
    normal:await encodePng(358,448,drawMarblePoster(358,448,photo,logo,member)),
    retina:await encodePng(716,896,drawMarblePoster(716,896,photo,logo,member))
  };
}
