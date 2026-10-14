#!/usr/bin/env node
// Synthetic iOS Preview-only login fixture. Never touches production data,
// Stripe, Wallet, or real memberships. Explicit commands: setup | cleanup.
import assert from "node:assert/strict";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = resolve(root, "cloudflare/payments-worker/wrangler.toml");
const kvId = "4b23fffb26264609b9f18f110baea954";
const prodId = "4504d6bcead74cdfa7e3a76599f641fc";
const previewUrl = "https://align-qr-pilot-align-payments.alignservice18.workers.dev";
const fixturePath = resolve(root, ".align-ios-preview-fixture.json");
const TTL = 7200;

function assertSafe() {
  const toml = readFileSync(config, "utf8");
  const preview = toml.split("[[previews.kv_namespaces]]")[1] || "";
  assert.notEqual(kvId, prodId);
  assert.match(preview, new RegExp('id\\s*=\\s*"' + kvId + '"'));
  assert.match(toml, /ALIGN_APP_QR_ROTATION_ENABLED = "false"/);
  assert.match(toml, /STRIPE_MODE = "test"/);
  assert.match(toml, /QR_SIGNING_CUTOVER = "true"/);
  const prod = toml.split("[vars]")[1]?.split("[previews]")[0] || "";
  const previewVars = toml.split("[previews.vars]")[1]?.split("[[previews.kv_namespaces]]")[0] || "";
  assert.match(prod, /MEMBER_PASSWORD_V2 = "false"/);
  assert.match(previewVars, /MEMBER_PASSWORD_V2 = "true"/);
  assert.equal(new URL(previewUrl).hostname.endsWith(".workers.dev"), true);
}
function kv(command, key, value = null) {
  const args = ["wrangler", "kv", "key", command, key];
  if (value !== null) args.push(value);
  args.push("--namespace-id", kvId, "--remote", "--config", config);
  if (command === "put") args.push("--ttl", String(TTL));
  const result = spawnSync("npx", args, { cwd: root, encoding: "utf8",
    timeout: 90000, maxBuffer: 1024 * 1024 });
  if (result.status !== 0) {
    // Do not print Wrangler's raw args: they may include test credentials.
    throw new Error("No se pudo " + command + " en la KV de Preview. Código: " + result.status);
  }
}

async function setup() {
  if (existsSync(fixturePath)) {
    throw new Error("Ya existe una cuenta de prueba local. Ejecútala o primero usa cleanup; no la sobrescribiremos.");
  }
  const username = "align" + randomBytes(3).toString("hex");
  const password = "Prueba" + randomInt(1000, 9999) + "!";
  const passwordHash = createHash("sha256").update(password).digest("hex");
  const memberToken = randomBytes(32).toString("hex");
  const groupId = "grp_align_preview_" + randomBytes(8).toString("hex");
  const now = Date.now();
  const joined = new Date(now - 60000).toISOString();
  const expires = new Date(now + 90 * 60000).toISOString();
  const member = {
    token: memberToken, groupId, integranteId: "PREVIEW-IOS-ONLY",
    name: "Socio de Prueba", memberCode: "TEST-PREVIEW", status: "Activa",
    level: "Prueba ALIGN", planKey: "brotherhood", position: 1,
    joinedAt: joined, validFrom: joined, validUntil: expires, savings: 0, photoUrl: ""
  };
  const group = { groupId, tokens: [memberToken], planKey: "brotherhood",
    membershipType: "synthetic_test" };
  const account = { version: 1, username, passwordHash, groupId,
    primaryToken: memberToken, tokens: [memberToken], createdAt: joined };
  const entries = [
    ["member:" + memberToken, member],
    ["group:" + groupId, group],
    ["account:" + username, account],
  ];
  const keys = [];
  try {
    for (const [key, value] of entries) {
      kv("put", key, JSON.stringify(value));
      keys.push(key);
    }
    // Test the real login endpoint without printing or storing the bearer.
    // Preview V2 migrates the synthetic V1 SHA-256 record after its first successful login.
    const response = await fetch(previewUrl + "/api/member-login-v2", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
      signal: AbortSignal.timeout(25000),
    });
    if (response.status !== 200) {
      throw new Error("Preview no aceptó el usuario ficticio: HTTP " + response.status);
    }
    const login = await response.json();
    assert.equal(login.ok, true);
    assert.equal(login.primary.memberCode, "TEST-PREVIEW");
    assert.equal(login.primary.token, memberToken);
    assert.ok(login.sessionToken);
    keys.push("member-session:" + login.sessionToken);
    const qr = await fetch(previewUrl + "/api/app-qr?token=" + memberToken, {
      headers: { authorization: "Bearer " + login.sessionToken },
      signal: AbortSignal.timeout(25000),
    });
    assert.equal(qr.status, 200, "Preview QR route must be available");
    const details = await qr.json();
    assert.equal(details.appRotationEnabled, true);
    writeFileSync(fixturePath, JSON.stringify({ keys, username, createdAt: joined,
      expiresAt: expires }, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    console.log("\n✓ Cuenta ficticia creada en Cloudflare Preview.");
    console.log("✓ Inicio de sesión y QR protegido comprobados.");
    console.log("✓ Los datos caducan automáticamente en un máximo de 2 horas.");
    console.log("\nUSA SOLO EN LA APP «ALIGN Preview»:");
    console.log("Usuario: " + username);
    console.log("Contraseña temporal: " + password);
    console.log("\nNo envíes capturas donde se vea la contraseña.");
    console.log("Al terminar: node scripts/prepare-align-ios-preview.mjs cleanup");
  } catch (error) {
    for (const key of keys.reverse()) {
      try { kv("delete", key); } catch {}
    }
    throw error;
  }
}
function cleanup() {
  if (!existsSync(fixturePath)) {
    console.log("No hay cuenta de prueba registrada localmente. No se modificó nada.");
    return;
  }
  const file = JSON.parse(readFileSync(fixturePath, "utf8"));
  assert.ok(Array.isArray(file.keys));
  assert.ok(file.keys.every(key =>
    /^(member:|group:|account:|member-session:)[A-Za-z0-9._-]+$/.test(key)));
  let failures = 0;
  for (const key of [...file.keys].reverse()) {
    try { kv("delete", key); } catch { failures += 1; }
  }
  if (failures) {
    console.log("⚠ No se pudieron borrar todos los datos. Reintenta cleanup.");
  } else {
    unlinkSync(fixturePath);
    console.log("✓ Cuenta ficticia eliminada de KV Preview.");
  }
}
assertSafe();
const action = process.argv[2];
if (action === "setup") await setup();
else if (action === "cleanup") cleanup();
else throw new Error("Uso: node scripts/prepare-align-ios-preview.mjs setup | cleanup");
