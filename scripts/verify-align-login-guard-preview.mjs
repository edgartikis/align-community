#!/usr/bin/env node
// Isolated smoke check of Preview-only login lockout: uses a random,
// NONEXISTENT username; no membership records, passwords, or production data.
// The failed attempt counter in Preview expires after 15 minutes.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = readFileSync(resolve(root, "cloudflare/payments-worker/wrangler.toml"), "utf8");
const production = config.split("[vars]")[1]?.split("[previews]")[0] || "";
const preview = config.split("[previews.vars]")[1]?.split("[[previews.kv_namespaces]]")[0] || "";
assert.match(production, /MEMBER_LOGIN_GUARD = "false"/);
assert.match(production, /ALIGN_APP_QR_ROTATION_ENABLED = "false"/);
assert.match(preview, /MEMBER_LOGIN_GUARD = "true"/);
assert.match(preview, /ALIGN_APP_QR_ROTATION_ENABLED = "true"/);

const hostname = "align-qr-pilot-align-payments.alignservice18.workers.dev";
const username = "testguard" + randomBytes(5).toString("hex");
const passwordHash = randomBytes(32).toString("hex");
const results = [];
for (let n = 0; n < 6; n++) {
  const res = await fetch("https://" + hostname + "/api/member-login", {
    method: "POST",
    headers: { "content-type": "application/json", "cache-control": "no-store" },
    body: JSON.stringify({ username, passwordHash }),
    signal: AbortSignal.timeout(25000),
  });
  results.push(res.status);
}
assert.deepEqual(results, [401, 401, 401, 401, 401, 429],
  "Preview must return five invalid-login errors and then lock out the sixth.");
console.log("✓ Cinco inicios de sesión ficticios e incorrectos rechazados (401).");
console.log("✓ Sexto intento bloqueado temporalmente (429).");
console.log("✓ Solo se usó un nombre de usuario inexistente y aleatorio en Preview.");
console.log("✓ El contador falso caducará automáticamente en 15 minutos.");
