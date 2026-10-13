#!/usr/bin/env node
// ALIGN preview-only end-to-end QR rotation smoke test.
// Does not deploy, access production KV, use real membership data, or need
// Cloudflare credentials in source. Temporary fake records are cleaned up.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = resolve(root, "cloudflare/payments-worker/wrangler.toml");
const PREVIEW_KV = "4b23fffb26264609b9f18f110baea954";
const PRODUCTION_KV = "4504d6bcead74cdfa7e3a76599f641fc";
const PREVIEW_URL = "https://align-qr-pilot-align-payments.alignservice18.workers.dev";
const TOKEN = randomBytes(32).toString("hex");
const SESSION = randomBytes(32).toString("hex");
const GROUP = "grp_synthetic_preview_" + randomBytes(6).toString("hex");
const TTL = 3600;
const keys = [];
function checkPreviewBinding() {
  const toml = readFileSync(configPath, "utf8");
  const preview = toml.split("[[previews.kv_namespaces]]")[1]?.split("\n[")[0] || "";
  assert.notEqual(PREVIEW_KV, PRODUCTION_KV, "Production and Preview IDs must differ");
  assert.match(preview, new RegExp('id\\s*=\\s*"' + PREVIEW_KV + '"'),
    "Preview KV namespace ID differs from the approved namespace");
  assert.match(toml, /ALIGN_APP_QR_ROTATION_ENABLED = "false"/,
    "Production app QR flag must remain OFF");
  assert.match(toml, /STRIPE_MODE = "test"/,
    "Preview must use Stripe TEST mode");
}
function wrangler(command, key, value) {
  const args = ["wrangler", "kv", "key", command, key];
  if (value !== undefined) args.push(value);
  args.push("--namespace-id", PREVIEW_KV, "--remote",
    "--config", configPath);
  if (command === "put") args.push("--ttl", String(TTL));
  const result = spawnSync("npx", args, {
    cwd: root, encoding: "utf8", timeout: 75_000, maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) {
    // Do not leak test session tokens into copied Terminal screenshots.
    throw new Error("Cloudflare rechazó la operación KV de Preview. " +
      (result.stderr || result.stdout || "").slice(-350)
        .replaceAll(TOKEN, "[test-token]").replaceAll(SESSION, "[test-session]"));
  }
}
async function fakeRequest(path, options = {}) {
  const res = await fetch(PREVIEW_URL + path, {
    ...options,
    headers: { "cache-control": "no-cache", ...(options.headers || {}) },
    signal: AbortSignal.timeout(20_000),
  });
  return res;
}
async function waitForMember() {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const response = await fakeRequest("/api/app-qr?token=" + TOKEN, {
      headers: { authorization: "Bearer " + SESSION },
    });
    if (response.status === 200) return response.json();
    if (response.status === 503) {
      throw new Error("El servicio Preview no tiene listo el Durable Object o su secreto.");
    }
    if (![401, 403, 404].includes(response.status)) {
      throw new Error("Respuesta inesperada de Preview: HTTP " + response.status);
    }
    await sleep(5000);
  }
  throw new Error("El socio ficticio aún no se propagó a la KV de Preview.");
}
function shortCode(qrUrl) {
  const url = new URL(qrUrl);
  assert.equal(url.host, new URL(PREVIEW_URL).host);
  assert.match(url.pathname, /^\/q\/A[A-Za-z0-9_-]{31}$/);
  return url.pathname.slice(3);
}

checkPreviewBinding();
let cleanupFailure = false;
try {
  const start = new Date(Date.now() - 60_000).toISOString();
  const end = new Date(Date.now() + 30 * 60_000).toISOString();
  const member = {
    token: TOKEN, groupId: GROUP, integranteId: "ALIGN-PREVIEW-TEST",
    name: "Socio Ficticio Preview", memberCode: "TEST-NO-REAL",
    status: "Activa", level: "Prueba ALIGN", planKey: "brotherhood",
    position: 1, joinedAt: start, validFrom: start, validUntil: end,
    savings: 0, photoUrl: "",
  };
  const session = {
    username: "align.preview.test", groupId: GROUP, primaryToken: TOKEN,
    createdAt: new Date().toISOString(), expiresAt: Date.now() + TTL * 1000,
  };
  for (const [key, value] of [
    ["member:" + TOKEN, JSON.stringify(member)],
    ["member-session:" + SESSION, JSON.stringify(session)],
  ]) {
    wrangler("put", key, value);
    keys.push(key);
  }
  console.log("✓ Socio y sesión ficticios creados exclusivamente en KV Preview.");
  const original = await waitForMember();
  console.log("✓ Emisión autenticada del primer QR.");
  const originalCode = shortCode(original.validationUrl);
  const firstStatus = await fakeRequest("/q/" + originalCode);
  assert.equal(firstStatus.status, 200, "First QR must initially validate");
  console.log("✓ Primer QR válido antes de renovar.");
  const rotate = await fakeRequest("/api/app-qr", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + SESSION },
    body: JSON.stringify({ token: TOKEN, previousCode: originalCode }),
  });
  assert.equal(rotate.status, 200, "Server-side rotation must succeed");
  const renewed = await rotate.json();
  const renewedCode = shortCode(renewed.validationUrl);
  assert.notEqual(renewedCode, originalCode, "Renewed code must differ");
  console.log("✓ Nuevo QR generado en Durable Objects.");
  assert.equal((await fakeRequest("/q/" + originalCode)).status, 403,
    "Screenshot of old QR must fail validation");
  assert.equal((await fakeRequest("/q/" + renewedCode)).status, 200,
    "Only the new QR must validate");
  console.log("✓ QR anterior rechazado (403) y QR nuevo aceptado (200).");
  const replay = await fakeRequest("/api/app-qr", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + SESSION },
    body: JSON.stringify({ token: TOKEN, previousCode: originalCode }),
  });
  assert.equal(replay.status, 409, "Replaying earlier rotation must fail");
  console.log("✓ Doble renovación del código anterior rechazada (409).");
} finally {
  for (const key of keys.reverse()) {
    try { wrangler("delete", key); } catch { cleanupFailure = true; }
  }
  console.log(cleanupFailure
    ? "⚠ No se confirmó la limpieza; los registros ficticios caducan en 1 hora."
    : "✓ Registros ficticios eliminados de Preview.");
}
