import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("iOS build is named ALIGN, with an increased TestFlight candidate build number", () => {
  const project = read("ios/ALIGN/project.yml");
  assert.match(project, /INFOPLIST_KEY_CFBundleDisplayName: ALIGN/);
  assert.match(project, /MARKETING_VERSION: "0\.2\.0"/);
  assert.match(project, /CURRENT_PROJECT_VERSION: "5"/);
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

test("Screenshot notice appears only on member card after iOS capture notification", () => {
  const qr = read("ios/ALIGN/Sources/MemberQRScreen.swift");
  assert.match(qr, /UIApplication\.userDidTakeScreenshotNotification/);
  assert.match(qr, /isCardVisible && scenePhase == \.active/);
  assert.match(qr, /\.alert\("Captura de pantalla detectada"/);
  assert.match(qr, /if isSceneCaptured/);
  assert.match(qr, /QR oculto durante grabación/);
});

test("Member card web pages conceal QR while backgrounded or printed", () => {
  const guard = read("qr-privacy-guard.js");
  const main = read("member.html");
  const members = read("mi-membresia.html");
  assert.match(guard, /visibilitychange/);
  assert.match(guard, /window\.addEventListener\("blur", mask\)/);
  assert.match(guard, /window\.addEventListener\("pagehide", mask\)/);
  assert.match(guard, /@media print/);
  assert.match(guard, /Browsers cannot block or reliably detect OS screenshots/);
  assert.match(main, /qr-privacy-guard\.js/);
  assert.match(members, /qr-privacy-guard\.js/);
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

test("Preview-only screenshots rotate the last protected QR even during SwiftUI refresh", () => {
  const qr = read("ios/ALIGN/Sources/MemberQRScreen.swift");
  const api = read("ios/ALIGN/Sources/ALIGNAPI.swift");
  const config = read("ios/ALIGN/project.yml");
  assert.match(qr, /lastProtectedQRCode/);
  assert.match(qr, /qr\?\.currentAppCode \?\? lastCode/);
  assert.match(qr, /lastProtectedQRCode = next\.currentAppCode/);
  assert.match(qr, /QR protegido · renovación por captura/);
  assert.match(api, /ALIGN Preview no tiene habilitado el QR protegido/);
  assert.match(api, /https:\/\/align-qr-pilot-align-payments\.alignservice18\.workers\.dev/);
  assert.match(config, /PRODUCT_BUNDLE_IDENTIFIER: mx\.com\.alignmembers\.app\.preview/);
});

test("Removed member card presents re-login action, not an endless error loop", () => {
  const screen = read("ios/ALIGN/Sources/MemberQRScreen.swift");
  const api = read("ios/ALIGN/Sources/ALIGNAPI.swift");
  const models = read("ios/ALIGN/Sources/Models.swift");
  assert.match(api, /response\.statusCode == 404/);
  assert.match(api, /missingCardIsGone: true/);
  assert.match(models, /case cardUnavailable/);
  assert.match(screen, /catch AppFailure\.cardUnavailable/);
  assert.match(screen, /Button\("Volver a iniciar sesión"\)/);
  assert.match(screen, /session\.signOut\(\)/);
  assert.match(screen, /A deleted card requires a fresh sign-in/);
});

test("Release uses production, Debug is isolated Preview, production QR flag remains disabled", () => {
  const api = read("ios/ALIGN/Sources/ALIGNAPI.swift");
  const project = read("ios/ALIGN/project.yml");
  const config = read("cloudflare/payments-worker/wrangler.toml");
  const workflow = read(".github/workflows/ios-native-check.yml");
  assert.match(api, /#if DEBUG \|\| ALIGN_PREVIEW\s+private let base = URL\(string: "https:\/\/align-qr-pilot-align-payments\.alignservice18\.workers\.dev"\)!/);
  assert.match(api, /#else\s+private let base = URL\(string: "https:\/\/api\.alignmembers\.com\.mx"\)!/);
  assert.match(project, /configs:\s+Debug:\s+PRODUCT_BUNDLE_IDENTIFIER: mx\.com\.alignmembers\.app\.preview/);
  const prod = config.split("[vars]")[1].split("[previews]")[0];
  assert.match(prod, /ALIGN_APP_QR_ROTATION_ENABLED = "false"/);
  assert.match(workflow, /-configuration Release/);
  assert.match(workflow, /CODE_SIGNING_ALLOWED=NO build/);
});

test("Private TestFlight has its own production-optimized Preview archive scheme", () => {
  const config = read("ios/ALIGN/project.yml");
  const workflow = read(".github/workflows/ios-native-check.yml");
  const api = read("ios/ALIGN/Sources/ALIGNAPI.swift");
  assert.match(config, /configs:\s+Debug: debug\s+Release: release\s+PreviewRelease: release/);
  assert.match(config, /PreviewRelease:\s+PRODUCT_BUNDLE_IDENTIFIER: mx\.com\.alignmembers\.app\.preview\s+INFOPLIST_KEY_CFBundleDisplayName: ALIGN Preview\s+SWIFT_ACTIVE_COMPILATION_CONDITIONS: ALIGN_PREVIEW/);
  assert.match(config, /ALIGN Private TestFlight:[\s\S]*?archive:\s+config: PreviewRelease/);
  assert.match(config, /schemes:\s+ALIGN:[\s\S]*?archive:\s+config: Release/);
  assert.match(api, /#if DEBUG \|\| ALIGN_PREVIEW/);
  assert.match(workflow, /-configuration PreviewRelease/);
  assert.match(workflow, /-scheme ['"]ALIGN Private TestFlight['"]/);
});

test("Preview member card/activity requests use authenticated POST while public Release retains legacy website compatibility", () => {
  const ios = read("ios/ALIGN/Sources/ALIGNAPI.swift");
  const privateApi = read("cloudflare/payments-worker/src/entry-app-member-private.js");
  const worker = read("cloudflare/payments-worker/src/main.js");
  assert.match(ios, /authorizedMemberRequest\(path: "\/api\/app-member-card"/);
  assert.match(ios, /authorizedMemberRequest\(path: "\/api\/app-member-activity"/);
  assert.match(ios, /call\.httpMethod = "POST"/);
  assert.match(ios, /call\.setValue\("Bearer " \+ bearer, forHTTPHeaderField: "Authorization"\)/);
  assert.match(ios, /#else\s+let request = request\(\s+path: "\/api\/member-card"/);
  assert.match(privateApi, /if \(!appQrEnabled\(env\)\)/);
  assert.match(privateApi, /member\.groupId !== record\.groupId/);
  assert.match(worker, /handleAppMemberPrivate\(request, env\)/);
});

test("Preview TestFlight build 7 is isolated; official Release build remains 5", () => {
  const project = read("ios/ALIGN/project.yml");
  assert.match(project, /CURRENT_PROJECT_VERSION: "5"/);
  assert.match(project, /PreviewRelease:[\s\S]*?CURRENT_PROJECT_VERSION: "7"/);
  assert.match(project, /PreviewRelease:[\s\S]*?PRODUCT_BUNDLE_IDENTIFIER: mx\.com\.alignmembers\.app\.preview/);
});
