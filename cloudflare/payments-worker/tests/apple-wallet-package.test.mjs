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
    assert.deepEqual(stages, ["certificate_setup", "artwork_icon", "artwork_logo", "artwork_black", "signature"]);

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
    assert.ok(properties.generic, "Pass must be generic to display a member thumbnail");
    assert.ok(properties.posterGeneric, "iOS 27 poster style provides Black Edition artwork");
    assert.equal((properties.posterGeneric.headerFields||[]).length,0,"QR altText displays code without cluttering the header");
    assert.equal(properties.posterGeneric.primaryFields[0].value,"SOCIO PRUEBA ALIGN");
    assert.equal(properties.posterGeneric.primaryFields[1].value,"The Brotherhood");
    assert.equal(properties.posterGeneric.primaryFields.length,2);
    assert.equal(properties.posterGeneric.footerFields[0].label,"AHORRADO");
    assert.equal(properties.posterGeneric.footerFields[0].value,"$0 MXN");
    assert.ok(!names.includes("primaryLogo.png"),"No automatic duplicate logo in Poster Generic");
    for(const [asset,width,height] of [["artwork.png",358,448],["artwork@2x.png",716,896]]) {
      const bytes=execFileSync("unzip",["-p",pkpass,asset]);
      assert.equal(bytes.subarray(0,8).toString("hex"),"89504e470d0a1a0a");
      assert.equal(bytes.readUInt32BE(16),width);
      assert.equal(bytes.readUInt32BE(20),height);
      if(asset==="artwork.png") {
        // Assert the approved option 1 is BLACK, with a silver hairline,
        // never a recycled royal-blue or marble backdrop.
        let offset=8;const compressed=[];
        while(offset+8<bytes.length){
          const size=bytes.readUInt32BE(offset),name=bytes.toString("ascii",offset+4,offset+8);
          if(name==="IDAT")compressed.push(bytes.subarray(offset+8,offset+8+size));
          offset+=size+12;
        }
        const raw=inflateSync(Buffer.concat(compressed));
        const pixel=(x,y)=>{const i=y*(width*4+1)+1+x*4;return [...raw.subarray(i,i+3)];};
        const backdrop=pixel(175,210);
        assert.ok(backdrop.every(c=>c<30),"Black Edition must be near-black, not blue");
        const border=pixel(179,14);
        assert.ok(border.every(c=>c>95),"Silver hairline should be visible");
        let visibleLogoPixels=0;
        for(let y=25;y<126;y+=2){
          for(let x=31;x<327;x+=2){
            const channels=pixel(x,y);
            if(channels.every(c=>c>110))visibleLogoPixels++;
          }
        }
        assert.ok(visibleLogoPixels>500,
          "Original ALIGN wordmark must be genuinely large and visible across the top artwork");
        const divider=pixel(160,142);
        assert.ok(divider.every(c=>c>65),"Premium silver header divider should be visible");
      }
    }

    assert.equal(properties.storeCard,undefined);
    assert.equal(properties.logoText,undefined,"Wordmark must not be duplicated");
    assert.equal(properties.generic.primaryFields[0].label,"AHORRADO");
    assert.match(properties.generic.primaryFields[0].value,/\$0(?:\.00)? MXN/);
    assert.equal(properties.generic.secondaryFields[0].value,"SOCIO PRUEBA ALIGN");
    assert.equal(properties.generic.secondaryFields[1].label,"MEMBRESÍA");
    assert.equal(properties.generic.secondaryFields[1].value,"The Brotherhood");
    assert.equal((properties.generic.auxiliaryFields||[]).length,0);
    assert.equal(properties.generic.backFields[0].value,"ALIGN-TEST-0001");
    assert.equal(properties.posterGeneric.backFields[0].value,"ALIGN-TEST-0001");

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
    assert.equal(privatePassFields.posterGeneric.primaryFields[1].value,"The Brotherhood");
    assert.match(privatePassFields.posterGeneric.footerFields[0].value,/231[.,]75 MXN/);
    assert.match(execFileSync("unzip",["-Z","-1",pkpass],{encoding:"utf8"}),/artwork@2x.png/);
    assert.equal(privatePassFields.posterGeneric.backFields[0].value,"ALIGN-PRIVATE-002");

    assert.doesNotMatch(JSON.stringify(privatePassFields),/data:image\/jpeg/);

  } finally {
    globalThis.fetch = previousFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});
