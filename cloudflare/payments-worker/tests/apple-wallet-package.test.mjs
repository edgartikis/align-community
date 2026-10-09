import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { inflateSync } from "node:zlib";
import { producePass } from "../src/apple-wallet.js";
import jpeg from "jpeg-js";

// Uses a temporary, intentionally untrusted certificate. This verifies package
// construction and cryptographic signing locally, NOT acceptance by Apple Wallet.
test("generates a complete, cryptographically signed .pkpass with preview QR", { timeout: 30000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "align-wallet-ci-"));
  const key = join(dir, "test.key.pem"), encryptedKey = join(dir, "test.encrypted.key.pem");
  const cert = join(dir, "test.cert.pem"), pkpass = join(dir, "test.pkpass");
  const previousFetch = globalThis.fetch;
  try {
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes",
      "-keyout", key, "-out", cert, "-days", "1",
      "-subj", "/CN=ALIGN Wallet Test"], { stdio: "ignore" });
    execFileSync("openssl", ["pkey", "-in", key, "-aes256", "-out", encryptedKey,
      "-passout", "pass:test-only-key-passphrase"], { stdio: "ignore" });

    // The pass must not rely on the public website to serve PNG images.
    globalThis.fetch = async () => { throw new Error("Unexpected Wallet external fetch"); };

    const origin = "https://feature-apple-wallet-align-align-payments.alignservice18.workers.dev";
    const id = "0123456789abcdef0123456789abcdef";
    const fakeMember = {
      name: "SOCIO PRUEBA ALIGN", level: "The Brotherhood",
      memberCode: "ALIGN-TEST-0001", status: "Activa",
    };
    const stages = [];
    const result = await producePass({
      WALLET_SIGNER_CERT_PEM: readFileSync(cert, "utf8"),
      WALLET_SIGNER_KEY_PEM: readFileSync(encryptedKey, "utf8"),
      WALLET_SIGNER_KEY_PASSPHRASE: "test-only-key-passphrase",
      WALLET_WWDR_PEM: readFileSync(cert, "utf8"),
      WALLET_TEAM_ID: "2WG8DN922L",
      SITE_ORIGIN: "https://alignmembers.com.mx",
    }, fakeMember, id, origin + "/api/wallet/apple", (stage) => stages.push(stage));
    assert.deepEqual(stages, ["certificate_setup", "artwork_icon", "artwork_logo", "artwork_poster", "signature"]);

    assert.equal(result.subarray(0, 2).toString(), "PK");
    writeFileSync(pkpass, result);
    const names = execFileSync("unzip", ["-Z", "-1", pkpass], { encoding: "utf8" }).trim().split("\n");
    for (const file of ["pass.json", "signature", "manifest.json", "icon.png", "icon@2x.png", "logo.png", "logo@2x.png", "artwork.png", "artwork@2x.png"]) {
      assert.ok(names.includes(file), "Missing Wallet file: " + file);
    }
    const properties = JSON.parse(execFileSync("unzip", ["-p", pkpass, "pass.json"], { encoding: "utf8" }));
    assert.equal(properties.passTypeIdentifier, "pass.mx.com.alignmembers.membership");
    assert.equal(properties.teamIdentifier, "2WG8DN922L");
    assert.equal(properties.serialNumber, id);
    assert.equal(properties.backgroundColor,"rgb(5,5,5)");
    assert.equal(properties.foregroundColor,"rgb(217,221,227)");
    assert.equal(properties.labelColor,"rgb(194,198,207)");
    assert.ok(properties.generic, "Generic style is required for native top-fields / bottom-QR");
    assert.ok(properties.posterGeneric,"Poster Generic is enabled on iOS 27");
    assert.equal((properties.posterGeneric.primaryFields||[]).length,0,
      "No duplicate front-facing text; personalized text is part of artwork");
    assert.equal((properties.posterGeneric.footerFields||[]).length,0,
      "Avoid a duplicated savings value below the native QR");
    assert.equal(properties.posterGeneric.backFields[0].value,"SOCIO PRUEBA ALIGN");
    assert.equal(properties.posterGeneric.backFields[1].value,"$0 MXN");
    assert.equal(properties.posterGeneric.backFields[3].value,"ALIGN-TEST-0001");
    const imageBytes=execFileSync("unzip",["-p",pkpass,"artwork.png"]);
    const image2x=execFileSync("unzip",["-p",pkpass,"artwork@2x.png"]);
    assert.equal(imageBytes.subarray(0,8).toString("hex"),"89504e470d0a1a0a");
    assert.equal(imageBytes.readUInt32BE(16),358);
    assert.equal(imageBytes.readUInt32BE(20),448);
    assert.equal(image2x.readUInt32BE(16),716);
    assert.equal(image2x.readUInt32BE(20),896);
    const unpackArtworkPixels=(png)=>{
      let off=8;const compressed=[];
      while(off<png.length) {
        const size=png.readUInt32BE(off),type=png.toString("ascii",off+4,off+8);
        if(type==="IDAT") compressed.push(png.subarray(off+8,off+8+size));
        off+=12+size;
      }
      return inflateSync(Buffer.concat(compressed));
    };
    const basePixel=unpackArtworkPixels(imageBytes);
    const rgbAt=(raw,x,y)=>([...raw.subarray(y*(358*4+1)+1+x*4,y*(358*4+1)+1+x*4+3)]);
    let brightLogoPixels=0;
    for(let yy=20;yy<123;yy+=2) for(let xx=28;xx<330;xx+=2)
      if(rgbAt(basePixel,xx,yy).every(c=>c>95))brightLogoPixels++;
    assert.ok(brightLogoPixels>300,"Prominent original silver ALIGN wordmark must span the top");
    assert.ok(rgbAt(basePixel,90,173).every(c=>c>45),"Silver divider is visible between sections");
    assert.ok(!names.includes("primaryLogo.png"));

    assert.equal(properties.storeCard,undefined);
    assert.equal(properties.logoText,undefined,"Wordmark must not be duplicated");
    // The iPhone Generic display emphasizes the primary savings field.
    // Names and tiers stay in smaller secondary text, with the QR below.
    assert.equal(properties.generic.primaryFields.length,1);
    assert.equal(properties.generic.primaryFields[0].label,"AHORRADO");
    assert.equal(properties.generic.primaryFields[0].value,"$0 MXN");
    assert.equal(properties.generic.secondaryFields.length,2);
    assert.equal(properties.generic.secondaryFields[0].label,"SOCIO");
    assert.equal(properties.generic.secondaryFields[0].value,"SOCIO PRUEBA ALIGN");
    assert.equal(properties.generic.secondaryFields[1].label,"MEMBRESÍA");
    assert.equal(properties.generic.secondaryFields[1].value,"The Brotherhood");
    assert.equal((properties.generic.auxiliaryFields||[]).length,0);
    assert.equal(properties.generic.backFields[0].value,"ALIGN-TEST-0001");
    assert.equal(properties.generic.backFields[1].value,"SOCIO PRUEBA ALIGN");
    assert.equal(properties.barcodes[0].altText,"ALIGN-TEST-0001");

    assert.match(JSON.stringify(properties.barcodes), /feature-apple-wallet-align-align-payments\.alignservice18\.workers\.dev/);

    const signature = execFileSync("unzip", ["-p", pkpass, "signature"]);
    assert.ok(signature.length > 200, "Pass signature is missing");
    // When the member has an actual PNG photo from the ALIGN asset origin,
    // embed it as the native Apple Wallet thumbnail rather than a rendered mockup.
    const memberPhotoUrl="https://alignmembers.com.mx/assets/socios/test-member.png";
    const localPng=readFileSync(new URL("../../../assets/align-primary.png",import.meta.url));
    let photoRequests=0;
    globalThis.fetch=async (url) => {
      photoRequests++;
      assert.equal(url,memberPhotoUrl);
      return new Response(localPng,{status:200,headers:{"content-type":"image/png"}});
    };
    const withPhoto=await producePass({
      WALLET_SIGNER_CERT_PEM:readFileSync(cert,"utf8"),
      WALLET_SIGNER_KEY_PEM:readFileSync(encryptedKey,"utf8"),
      WALLET_SIGNER_KEY_PASSPHRASE:"test-only-key-passphrase",
      WALLET_WWDR_PEM:readFileSync(cert,"utf8"),
      WALLET_TEAM_ID:"2WG8DN922L",
    }, {...fakeMember,photoUrl:memberPhotoUrl,savings:125.50},id,origin+"/api/wallet/apple");
    assert.equal(photoRequests,1);
    writeFileSync(pkpass,withPhoto);
    const filesWithPhoto=execFileSync("unzip",["-Z","-1",pkpass],{encoding:"utf8"});
    assert.match(filesWithPhoto,/thumbnail.png/);
    assert.match(filesWithPhoto,/thumbnail@2x.png/);
    const propsWithPhoto=JSON.parse(execFileSync("unzip",["-p",pkpass,"pass.json"],{encoding:"utf8"}));
    assert.match(propsWithPhoto.generic.primaryFields[0].value,/125[.,]50 MXN/);
    assert.equal(propsWithPhoto.posterGeneric.backFields[1].value,propsWithPhoto.generic.primaryFields[0].value);
    const savingsArtwork=execFileSync("unzip",["-p",pkpass,"artwork.png"]);
    assert.notDeepEqual(savingsArtwork,imageBytes,"Artwork must personalize savings per member");

    // Actual member enrollment sends a private data:image/jpeg;base64 string,
    // not an HTTPS PNG. Confirm Wallet receives correctly encoded PNGs.
    const pixels=Buffer.alloc(120*120*4,255);
    for(let i=0;i<pixels.length;i+=4){ pixels[i]=40;pixels[i+1]=85;pixels[i+2]=170; }
    const privateJpeg="data:image/jpeg;base64,"+
      Buffer.from(jpeg.encode({data:pixels,width:120,height:120},78).data).toString("base64");
    globalThis.fetch=async()=>{throw new Error("Private photo must never be fetched externally");};
    const privatePass=await producePass({
      WALLET_SIGNER_CERT_PEM:readFileSync(cert,"utf8"),
      WALLET_SIGNER_KEY_PEM:readFileSync(encryptedKey,"utf8"),
      WALLET_SIGNER_KEY_PASSPHRASE:"test-only-key-passphrase",
      WALLET_WWDR_PEM:readFileSync(cert,"utf8"),
      WALLET_TEAM_ID:"2WG8DN922L",
    }, {...fakeMember,photoUrl:privateJpeg,memberCode:"ALIGN-PRIVATE-002",savings:231.75},id,origin+"/api/wallet/apple");
    writeFileSync(pkpass,privatePass);
    for(const [name,side] of [["thumbnail.png",90],["thumbnail@2x.png",180]]) {
      const png=execFileSync("unzip",["-p",pkpass,name]);
      assert.equal(png.subarray(0,8).toString("hex"),"89504e470d0a1a0a");
      assert.equal(png.readUInt32BE(16),side);
      assert.equal(png.readUInt32BE(20),side);
    }
    const privatePassFields=JSON.parse(execFileSync("unzip",["-p",pkpass,"pass.json"],{encoding:"utf8"}));
    assert.equal(privatePassFields.generic.backFields[0].value,"ALIGN-PRIVATE-002");
    assert.match(privatePassFields.barcodes[0].message,/\/api\/wallet\/verify\//);
    assert.equal(privatePassFields.generic.secondaryFields[1].value,"The Brotherhood");
    assert.match(privatePassFields.generic.primaryFields[0].value,/231[.,]75 MXN/);
    assert.equal(privatePassFields.barcodes[0].altText,"ALIGN-PRIVATE-002");
    assert.equal(privatePassFields.posterGeneric.backFields[0].value,"SOCIO PRUEBA ALIGN");
    assert.equal(privatePassFields.posterGeneric.backFields[3].value,"ALIGN-PRIVATE-002");
    assert.notDeepEqual(execFileSync("unzip",["-p",pkpass,"artwork.png"]),savingsArtwork,
      "Different members must have different private portrait/savings artwork");

    assert.doesNotMatch(JSON.stringify(privatePassFields),/data:image\/jpeg/);

  } finally {
    globalThis.fetch = previousFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});
