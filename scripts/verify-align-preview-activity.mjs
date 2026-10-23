#!/usr/bin/env node
// Preview ONLY: display a synthetic visit in the iPhone Home/Activity screen.
// This DOES NOT call the ally visit endpoint or Google Sheets, and it does NOT
// test ally registration. It writes a single expiring visit:* KV record and
// is compatible with the existing synthetic iPhone fixture. No real payments.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = resolve(root, "cloudflare/payments-worker/wrangler.toml");
const fixturePath = resolve(root, ".align-ios-preview-fixture.json");
const visitMarker = resolve(root, ".align-ios-preview-visit-fixture.json");
const PREVIEW_KV = "4b23fffb26264609b9f18f110baea954";
const PROD_KV = "4504d6bcead74cdfa7e3a76599f641fc";
const PREVIEW = "https://align-qr-pilot-align-payments.alignservice18.workers.dev";
const TTL = 3600;

function safetyChecks() {
  const toml = readFileSync(config, "utf8");
  const p = toml.split("[previews.vars]")[1]?.split("[[previews.kv_namespaces]]")[0] || "";
  const prod = toml.split("[vars]")[1]?.split("[previews]")[0] || "";
  const binding = toml.split("[[previews.kv_namespaces]]")[1]?.split("\n[")[0] || "";
  assert.notEqual(PREVIEW_KV, PROD_KV);
  assert.match(binding, new RegExp('id\\s*=\\s*"' + PREVIEW_KV + '"'));
  assert.match(prod, /ALIGN_APP_QR_ROTATION_ENABLED = "false"/);
  assert.match(prod, /MEMBER_PASSWORD_V2 = "false"/);
  assert.match(p, /ALIGN_APP_QR_ROTATION_ENABLED = "true"/);
  assert.match(p, /MEMBER_PASSWORD_V2 = "true"/);
  assert.match(p, /STRIPE_MODE = "test"/);
}
function kv(action, key, value) {
  const args = ["wrangler", "kv", "key", action, key];
  if (value !== undefined) args.push(value);
  args.push("--namespace-id", PREVIEW_KV, "--remote", "--config", config);
  if (action === "put") args.push("--ttl", String(TTL));
  const result = spawnSync("npx", args, {
    cwd: root, encoding: "utf8", timeout: 90_000, maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) throw new Error("Fallo la operación KV de Preview: " + action + ".");
  return result.stdout.trim();
}
function readFixture() {
  assert.ok(existsSync(fixturePath), "No hay cuenta de prueba: ejecuta primero prepare-align-ios-preview.mjs setup.");
  const data = JSON.parse(readFileSync(fixturePath, "utf8"));
  assert.match(data.username, /^align[a-f0-9]{6}$/);
  assert.ok(Array.isArray(data.keys));
  const cardKeys = data.keys.filter(k => /^member:[a-f0-9]{64}$/.test(k));
  const sessionKeys = data.keys.filter(k => /^member-session:[a-f0-9]{64}$/.test(k));
  assert.equal(cardKeys.length, 1, "Debe existir exactamente una tarjeta ficticia.");
  assert.equal(sessionKeys.length, 1, "Debe existir exactamente una sesión ficticia.");
  return {
    cardToken: cardKeys[0].slice("member:".length),
    session: sessionKeys[0].slice("member-session:".length),
  };
}
async function activity(cardToken, session) {
  const response = await fetch(PREVIEW + "/api/app-member-activity", {
    method: "POST",
    headers: { authorization: "Bearer " + session,
      "content-type": "application/json", "cache-control": "no-store" },
    body: JSON.stringify({ token: cardToken }),
    signal: AbortSignal.timeout(25000),
  });
  assert.equal(response.status, 200, "La sesión ficticia expiró o la actividad no está disponible en Preview.");
  return (await response.json()).activity;
}
async function setup() {
  assert.ok(!existsSync(visitMarker), "Ya hay una visita temporal registrada. Ejecuta cleanup antes de repetir.");
  const { cardToken, session } = readFixture();
  const [member, record] = [
    JSON.parse(kv("get", "member:" + cardToken)),
    JSON.parse(kv("get", "member-session:" + session)),
  ];
  assert.equal(member.memberCode, "TEST-PREVIEW");
  assert.equal(member.integranteId, "PREVIEW-IOS-ONLY");
  assert.match(member.groupId, /^grp_align_preview_[a-f0-9]{16}$/);
  assert.equal(record.groupId, member.groupId);
  assert.ok(Number(record.expiresAt) > Date.now(), "Sesión ficticia expirada: crea otra.");
  const before = await activity(cardToken, session);
  const visitId = "VIS-PREVIEW-" + randomBytes(8).toString("hex").toUpperCase();
  const key = "visit:" + visitId;
  const saved = 20, spent = 100;
  const visit = {
    visitId, createdAt: new Date().toISOString(),
    socioId: member.groupId, integranteId: member.integranteId,
    visitorName: member.name, memberCode: member.memberCode,
    planName: member.level, planKey: member.planKey,
    allyId: "ALI-PREVIEW-ONLY", place: "Aliado de prueba (Preview)",
    category: "Prueba interna", registeredBy: "ALI-PREVIEW-ONLY",
    people: 1, gross: 120, spent, saved,
    benefit: "SIMULACIÓN DE PRUEBA — no es promoción real",
    dbSynced: false, syntheticPreviewOnly: true,
  };
  let inserted = false;
  try {
    kv("put", key, JSON.stringify(visit));
    inserted = true;
    // KV listing/reads can be eventually consistent across locations.
    let after;
    for (let i = 0; i < 12; i++) {
      after = await activity(cardToken, session);
      if (after.recentVisits?.some(v => v.visitId === visitId)) break;
      await sleep(5000);
    }
    assert.ok(after.recentVisits?.some(v => v.visitId === visitId),
      "El historial aún no refleja el registro (KV puede tardar en propagarse).");
    assert.ok(after.visits >= before.visits + 1);
    assert.ok(after.savings >= before.savings + saved);
    assert.ok(after.spent >= before.spent + spent);
    writeFileSync(visitMarker, JSON.stringify({ key, createdAt: new Date().toISOString() }) + "\n", {
      mode: 0o600, flag: "wx",
    });
    console.log("✓ Visita sintética guardada exclusivamente en KV Preview.");
    console.log("✓ El endpoint de actividad devuelve 1 visita adicional.");
    console.log("✓ Consumo de prueba $100 y ahorro simulado $20 detectados.");
    console.log("✓ No se llamó al portal de aliados, Google Sheets ni Stripe.");
    console.log("✓ Registro temporal (1 hora). Actualiza Inicio en el iPhone.");
    console.log("Al terminar: node scripts/verify-align-preview-activity.mjs cleanup");
  } catch (error) {
    if (inserted) {
      try { kv("delete", key); } catch {
        console.error("No se pudo confirmar limpieza del registro temporal; expirará en una hora.");
      }
    }
    throw error;
  }
}
function cleanup() {
  if (!existsSync(visitMarker)) {
    console.log("No hay visita temporal local; no se modificó nada.");
    return;
  }
  const { key } = JSON.parse(readFileSync(visitMarker, "utf8"));
  assert.match(key, /^visit:VIS-PREVIEW-[A-F0-9]{16}$/);
  kv("delete", key);
  unlinkSync(visitMarker);
  console.log("✓ Visita de prueba eliminada de KV Preview.");
}
safetyChecks();
const action = process.argv[2];
if (action === "setup") await setup();
else if (action === "cleanup") cleanup();
else throw new Error("Uso: node scripts/verify-align-preview-activity.mjs setup | cleanup");
