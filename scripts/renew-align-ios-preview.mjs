#!/usr/bin/env node
// Renew ONLY the previously created synthetic ALIGN Preview account.
// Keeps username and the password entered locally on stdin; never handles real members.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = resolve(root, ".align-ios-preview-fixture.json");
const config = resolve(root, "cloudflare/payments-worker/wrangler.toml");
const previewKV = "4b23fffb26264609b9f18f110baea954";
const liveKV = "4504d6bcead74cdfa7e3a76599f641fc";
const previewUrl = "https://align-qr-pilot-align-payments.alignservice18.workers.dev";
const ttlSeconds = 7200;

async function safetyCheck() {
  const toml = readFileSync(config, "utf8");
  const preview = toml.split("[[previews.kv_namespaces]]")[1] || "";
  const vars = toml.split("[previews.vars]")[1]?.split("[[previews.kv_namespaces]]")[0] || "";
  const live = toml.split("[vars]")[1]?.split("[previews]")[0] || "";
  assert.notEqual(previewKV, liveKV);
  assert.match(preview, new RegExp('id\\s*=\\s*"' + previewKV + '"'));
  assert.match(vars, /STRIPE_MODE = "test"/);
  assert.match(vars, /ALIGN_APP_QR_ROTATION_ENABLED = "true"/);
  assert.match(vars, /MEMBER_PASSWORD_V2 = "true"/);
  assert.match(vars, /QR_SIGNING_CUTOVER = "true"/);
  assert.match(live, /ALIGN_APP_QR_ROTATION_ENABLED = "false"/);
  assert.match(live, /MEMBER_PASSWORD_V2 = "false"/);
  const response = await fetch(previewUrl + "/api/health", {
    headers: { "cache-control": "no-cache" },
    signal: AbortSignal.timeout(15000),
  });
  const health = await response.json();
  assert.equal(health.stripeMode, "test", "Preview no está en Stripe TEST");
  assert.equal(health.storage, "kv-ready", "Preview KV no está disponible");
  assert.equal(health.reportingDb, "optional-unconfigured", "Preview apunta a reportes externos");
  assert.equal(health.qrSigningMode, "dedicated", "Preview QR no está aislado");
}

function kv(action, key, value) {
  const args = ["wrangler", "kv", "key", action, key];
  if (action === "put") args.push(JSON.stringify(value));
  args.push("--namespace-id", previewKV, "--remote", "--config", config);
  if (action === "put") args.push("--ttl", String(ttlSeconds));
  const output = spawnSync("npx", args, {
    cwd: root, encoding: "utf8", timeout: 90000, maxBuffer: 1024 * 1024,
  });
  if (output.status !== 0) {
    throw Error("Cloudflare Preview no completó la operación KV: " + action +
      " (" + output.status + "). No se muestran secretos.");
  }
}

function checkFixture(file) {
  assert.match(file?.username || "", /^align[a-f0-9]{6}$/,
    "No existe un usuario temporal reconocido en esta Mac");
  assert.ok(Array.isArray(file.keys) && file.keys.length >= 3);
  assert.ok(file.keys.every(key =>
    /^(member:|group:|account:|member-session:)[A-Za-z0-9._-]+$/.test(key)));
  assert.ok(file.keys.includes("account:" + file.username),
    "La cuenta local no corresponde al registro temporal");
}

if (!existsSync(fixturePath)) {
  throw Error("No encontré la cuenta anterior en esta Mac. No se modificó nada.");
}
const previous = JSON.parse(readFileSync(fixturePath, "utf8"));
checkFixture(previous);
const password = readFileSync(0, "utf8").replace(/\r?\n$/, "");
if (!password || Buffer.byteLength(password) > 256) {
  throw Error("Introduce tu contraseña anterior (máximo 256 bytes). No se modificó nada.");
}
await safetyCheck();

const token = randomBytes(32).toString("hex");
const groupId = "grp_align_preview_" + randomBytes(8).toString("hex");
const joinedAt = new Date(Date.now() - 60000).toISOString();
const expiresAt = new Date(Date.now() + 90 * 60000).toISOString();
const accountKey = "account:" + previous.username;
const member = {
  token, groupId, integranteId: "PREVIEW-IOS-ONLY",
  name: "Socio de Prueba", memberCode: "TEST-PREVIEW", status: "Activa",
  level: "Prueba ALIGN", planKey: "brotherhood", position: 1,
  joinedAt, validFrom: joinedAt, validUntil: expiresAt,
  savings: 0, photoUrl: "",
};
const group = {
  groupId, tokens: [token], planKey: "brotherhood",
  membershipType: "synthetic_test",
};
const account = {
  version: 1, username: previous.username,
  passwordHash: createHash("sha256").update(password).digest("hex"),
  groupId, primaryToken: token, tokens: [token], createdAt: joinedAt,
};
const newKeys = ["member:" + token, "group:" + groupId, accountKey];
let accountSaved = false;
let loginSessionKey = "";
try {
  kv("put", newKeys[0], member);
  kv("put", newKeys[1], group);
  kv("put", accountKey, account);
  accountSaved = true;

  const loginResponse = await fetch(previewUrl + "/api/member-login-v2", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: previous.username, password }),
    signal: AbortSignal.timeout(25000),
  });
  assert.equal(loginResponse.status, 200, "El login Preview no confirmó la renovación");
  const login = await loginResponse.json();
  assert.equal(login.ok, true);
  assert.equal(login.primary?.memberCode, "TEST-PREVIEW");
  assert.equal(login.primary?.token, token);
  assert.ok(login.sessionToken);
  loginSessionKey = "member-session:" + login.sessionToken;
  newKeys.push(loginSessionKey);

  const qrResponse = await fetch(previewUrl + "/api/app-qr?token=" + token, {
    headers: { authorization: "Bearer " + login.sessionToken },
    signal: AbortSignal.timeout(25000),
  });
  assert.equal(qrResponse.status, 200, "No se pudo emitir el QR de prueba");
  const qr = await qrResponse.json();
  assert.equal(qr.appRotationEnabled, true);

  writeFileSync(fixturePath, JSON.stringify({
    keys: newKeys, username: previous.username, createdAt: joinedAt,
    expiresAt,
  }, null, 2) + "\n", { mode: 0o600 });

  // Remove previous synthetic cards/sessions; never delete the renewed account key.
  for (const key of previous.keys) {
    if (key === accountKey || newKeys.includes(key)) continue;
    try { kv("delete", key); } catch {
      // Previous synthetic KV entries retain their existing short TTL.
    }
  }
  console.log("\n✓ MISMO USUARIO renovado en ALIGN Preview: " + previous.username);
  console.log("✓ Conserva la contraseña que acabas de introducir.");
  console.log("✓ Tarjeta ficticia activa unos 90 minutos; registros caducan en 2 horas.");
  console.log("✓ QR renovado y validado en el servidor de pruebas.");
  console.log("✓ Sin pagos reales, Stripe Live ni registros de socios oficiales.");
  console.log("En el iPhone, cierra sesión en ALIGN Preview y vuelve a entrar.");
} catch (error) {
  // If the account was written, DO NOT delete its key: doing so could
  // destroy the only working access. The user can retry this same renewal.
  for (const key of newKeys.slice(0, 2)) {
    try { kv("delete", key); } catch {}
  }
  if (loginSessionKey) {
    try { kv("delete", loginSessionKey); } catch {}
  }
  console.error("No se confirmó la renovación. El registro local anterior permanece intacto.");
  if (accountSaved) console.error("La cuenta remota podría requerir reintentar el mismo comando.");
  throw error;
}
