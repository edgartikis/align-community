import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { producePass } from "../src/apple-wallet.js";

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
    assert.deepEqual(stages, ["certificate_setup", "artwork_icon", "artwork_logo", "signature"]);

    assert.equal(result.subarray(0, 2).toString(), "PK");
    writeFileSync(pkpass, result);
    const names = execFileSync("unzip", ["-Z", "-1", pkpass], { encoding: "utf8" }).trim().split("\n");
    for (const file of ["pass.json", "signature", "manifest.json", "icon.png", "icon@2x.png", "logo.png", "logo@2x.png"]) {
      assert.ok(names.includes(file), "Missing Wallet file: " + file);
    }
    const properties = JSON.parse(execFileSync("unzip", ["-p", pkpass, "pass.json"], { encoding: "utf8" }));
    assert.equal(properties.passTypeIdentifier, "pass.mx.com.alignmembers.membership");
    assert.equal(properties.teamIdentifier, "2WG8DN922L");
    assert.equal(properties.serialNumber, id);
    assert.match(JSON.stringify(properties.barcodes), /feature-apple-wallet-align-align-payments\.alignservice18\.workers\.dev/);

    const signature = execFileSync("unzip", ["-p", pkpass, "signature"]);
    assert.ok(signature.length > 200, "Pass signature is missing");
  } finally {
    globalThis.fetch = previousFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});
