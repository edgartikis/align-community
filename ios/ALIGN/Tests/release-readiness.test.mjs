import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("iOS build is named ALIGN, with an increased TestFlight candidate build number", () => {
  const project = read("ios/ALIGN/project.yml");
  assert.match(project, /INFOPLIST_KEY_CFBundleDisplayName: ALIGN/);
  assert.match(project, /MARKETING_VERSION: "0\.2\.0"/);
  assert.match(project, /CURRENT_PROJECT_VERSION: "3"/);
  assert.match(project, /PRODUCT_BUNDLE_IDENTIFIER: mx\.com\.alignmembers\.app/);
});

test("iOS member QR uses the existing 15-minute backend with immediate expiration masking", () => {
  const qr = read("ios/ALIGN/Sources/MemberQRScreen.swift");
  const entry = read("cloudflare/payments-worker/src/entry.js");
  const visits = read("cloudflare/payments-worker/src/entry-visits.js");
  assert.match(entry, /const QR_ROTATION_MS = 15 \* 60 \* 1000/);
  assert.match(visits, /const QR_ROTATION_MS = 15 \* 60 \* 1000/);
  assert.match(qr, /refreshAfterMs \/ 1000\.0 \+ 0\.25/);
  assert.match(qr, /context\.date < validUntil && scenePhase == \.active/);
  assert.match(qr, /TimelineView\(\.periodic\(from: \.now, by: 1\)\)/);
  assert.match(qr, /privacySensitive\(\)/);
  assert.doesNotMatch(qr, /3 minutos|180\s*\*|180\.0/);
});

test("No active session data should be shown in the iOS app switcher", () => {
  const app = read("ios/ALIGN/Sources/ALIGNApp.swift");
  assert.match(app, /if scenePhase != \.active/);
  assert.match(app, /ALIGNPrivacyCover\(\)/);
  assert.match(app, /Text\("USUARIO"\)/);
  assert.match(app, /Text\("CONTRASEÑA"\)/);
  assert.match(app, /\.foregroundStyle\(ALIGNStyle\.ivory\)/);
});

test("Privacy shield synchronously covers UIKit window on scene resignation", () => {
  const shield = read("ios/ALIGN/Sources/ALIGNPrivacyShield.swift");
  const app = read("ios/ALIGN/Sources/ALIGNApp.swift");
  assert.match(shield, /UIScene\.willDeactivateNotification/);
  assert.match(shield, /UIApplication\.willResignActiveNotification/);
  assert.match(shield, /UIScene\.didActivateNotification/);
  assert.match(shield, /window\.addSubview\(cover\)/);
  assert.match(shield, /window\.bringSubviewToFront\(cover\)/);
  assert.match(shield, /window\.viewWithTag\(shieldTag\)\?\.removeFromSuperview\(\)/);
  assert.match(app, /privacyShield\.activate\(\)/);
  assert.match(app, /if scenePhase != \.active/);
});

test("Keychain and short-lived HTTPS in-memory requests, no public Apple Wallet issuance", () => {
  const keys = read("ios/ALIGN/Sources/SecureSession.swift");
  const api = read("ios/ALIGN/Sources/ALIGNAPI.swift");
  const app = read("ios/ALIGN/Sources/ALIGNApp.swift");
  assert.match(keys, /kSecAttrAccessibleWhenUnlockedThisDeviceOnly/);
  assert.match(api, /URLSessionConfiguration\.ephemeral/);
  assert.match(api, /https:\/\/api\.alignmembers\.com\.mx/);
  assert.doesNotMatch(app, /addToWallet|wallet\/pilot|wallet\/owner/);
});

test("History and QR views reserve bottom space above iOS floating tab bar", () => {
  for (const f of ["HomeScreen.swift", "MemberQRScreen.swift"]) {
    assert.match(read("ios/ALIGN/Sources/" + f), /\.padding\(\.bottom, 88\)/);
  }
});

test("Production Owner Wallet remains exclusive; beta must not switch on issuance", () => {
  const config = read("cloudflare/payments-worker/wrangler.toml");
  const production = config.split("[vars]")[1].split("[previews]")[0];
  const preview = config.split("[previews.vars]")[1].split("[[previews.kv_namespaces]]")[0];
  assert.match(production, /WALLET_OWNER_ENABLED\s*=\s*"true"/);
  assert.match(preview, /WALLET_OWNER_ENABLED\s*=\s*"false"/);
  for (const env of [production, preview]) {
    assert.match(env, /WALLET_ENABLED\s*=\s*"false"/);
    assert.match(env, /WALLET_PILOT_ENABLED\s*=\s*"false"/);
  }
});
