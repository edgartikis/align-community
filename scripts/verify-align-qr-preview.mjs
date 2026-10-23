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
const FOREIGN_TOKEN = randomBytes(32).toString("hex");
const SESSION = randomBytes(32).toString("hex");
const GROUP = "grp_synthetic_preview_" + randomBytes(6).toString("hex");
const FOREIGN_GROUP = "grp_other_preview_" + randomBytes(6).toString("hex");
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
  assert.match(toml, /QR_SIGNING_CUTOVER = "true"/,
    "Preview ally-scanner signing must use its own private key");
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
async function loginPreviewAlly() {
  // Existing static ally fixture, exercised only against the Preview URL.
  // Do not print credentials, authorization headers or QR values.
  const name = "Global Gym";
  const username = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const password = username.replace(/[aeiou]/g, "");
  const response = await fakeRequest("/api/ally/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (response.status !== 200) {
    throw new Error("El inicio de sesión del aliado en Preview no está preparado: HTTP "
      + response.status + ". Verifica la firma QR_SIGNING_SECRET y la configuración de Preview.");
  }
  const result = await response.json();
  assert.equal(result.ok, true);
  assert.equal(result.ally?.key, "global");
  assert.ok(result.token);
  return result.token;
}
async function partnerScan(allyToken, qrUrl) {
  return fakeRequest("/api/ally/scan", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + allyToken },
    body: JSON.stringify({ qr: qrUrl, allyKey: "global" }),
  });
}
async function partnerVisitAttempt(allyToken, qrUrl) {
  // Only send a revoked code; must be rejected BEFORE any visit can be recorded.
  return fakeRequest("/api/ally/visit", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + allyToken },
    body: JSON.stringify({ qr: qrUrl, allyKey: "global", gross: 0, spent: 0 }),
  });
}
async function privateMemberRequest(path, memberToken = TOKEN, sessionToken = SESSION) {
  // Only POST JSON to Preview. Do not place membership tokens in external URLs.
  return fakeRequest(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(sessionToken ? { authorization: "Bearer " + sessionToken } : {}),
    },
    body: JSON.stringify({ token: memberToken }),
  });
}
async function privateMemberChecks() {
  const cardPath = "/api/app-member-card";
  const activityPath = "/api/app-member-activity";
  assert.equal((await privateMemberRequest(cardPath, TOKEN, "")).status, 401,
    "Anonymous callers must not read membership details");
  assert.equal((await privateMemberRequest(activityPath, TOKEN, "")).status, 401,
    "Anonymous callers must not read activity");
  console.log("✓ Sin sesión: tarjeta e historial rechazados (401).");

  // Wait for Preview KV propagation; avoid false negatives caused by eventual KV reads.
  let status;
  for (let attempt = 0; attempt < 12; attempt++) {
    status = await privateMemberRequest(cardPath);
    if (status.status === 200) break;
    if (status.status !== 403 && status.status !== 404) break;
    await sleep(3000);
  }
  assert.equal(status.status, 200, "Valid group session must access its own card");
  const card = await status.json();
  assert.equal(card.memberCode, "TEST-NO-REAL");
  assert.equal(card.active, true);

  const activityRes = await privateMemberRequest(activityPath);
  assert.equal(activityRes.status, 200, "Valid group session must access its activity");
  const activity = await activityRes.json();
  assert.equal(activity.ok, true);
  assert.equal(activity.member.memberCode, "TEST-NO-REAL");
  console.log("✓ Socio autenticado puede consultar únicamente su tarjeta e historial (200).");

  let foreign;
  for (let attempt = 0; attempt < 12; attempt++) {
    foreign = await privateMemberRequest(cardPath, FOREIGN_TOKEN);
    if (foreign.status === 403) break;
    if (foreign.status !== 404) break;
    await sleep(3000);
  }
  assert.equal(foreign.status, 403,
    "Group A must not read a card owned by group B");
  assert.equal((await privateMemberRequest(activityPath, FOREIGN_TOKEN)).status, 403,
    "Group A must not read the activity owned by group B");
  console.log("✓ Intento de consultar tarjeta e historial de otro grupo rechazado (403).");

  const noGet = await fakeRequest(cardPath + "?token=" + TOKEN, {
    headers: { authorization: "Bearer " + SESSION },
  });
  assert.equal(noGet.status, 405, "Member-specific native GET must be disabled");
  console.log("✓ Ruta nativa no admite consultas GET con tokens en la URL (405).");
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
  const group = { groupId: GROUP, tokens: [TOKEN] };
  const foreignMember = { ...member, token: FOREIGN_TOKEN, groupId: FOREIGN_GROUP,
    integranteId: "ALIGN-FOREIGN-PREVIEW", memberCode: "TEST-FOREIGN-NO-REAL" };
  const session = {
    username: "align.preview.test", groupId: GROUP, primaryToken: TOKEN,
    createdAt: new Date().toISOString(), expiresAt: Date.now() + TTL * 1000,
  };
  for (const [key, value] of [
    ["member:" + TOKEN, JSON.stringify(member)],
    ["member:" + FOREIGN_TOKEN, JSON.stringify(foreignMember)],
    ["group:" + GROUP, JSON.stringify(group)],
    ["member-session:" + SESSION, JSON.stringify(session)],
  ]) {
    wrangler("put", key, value);
    keys.push(key);
  }
  console.log("✓ Socio y sesión ficticios creados exclusivamente en KV Preview.");
  const original = await waitForMember();
  console.log("✓ Emisión autenticada del primer QR.");
  await privateMemberChecks();
  const originalCode = shortCode(original.validationUrl);
  const firstStatus = await fakeRequest("/q/" + originalCode);
  assert.equal(firstStatus.status, 200, "First QR must initially validate");
  console.log("✓ Primer QR válido antes de renovar.");
  const allyToken = await loginPreviewAlly();
  assert.equal((await partnerScan(allyToken, original.validationUrl)).status, 200,
    "El portal del aliado debe aceptar el primer QR vigente");
  console.log("✓ Escáner de aliado acepta el QR vigente.");
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
  assert.equal((await partnerScan(allyToken, original.validationUrl)).status, 400,
    "El escáner debe rechazar el QR anterior a la captura");
  assert.equal((await partnerScan(allyToken, renewed.validationUrl)).status, 200,
    "El escáner debe aceptar el QR renovado");
  assert.equal((await partnerVisitAttempt(allyToken, original.validationUrl)).status, 400,
    "Registrar una visita con el QR viejo debe rechazarse antes de escribir datos");
  console.log("✓ Escáner y registro de visita rechazan el QR anterior; escáner acepta el nuevo.");
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
