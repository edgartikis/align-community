import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, webcrypto } from "node:crypto";
import shortQrWorker from "../cloudflare/payments-worker/src/entry-short-qr.js";
import { currentAppQrMapping } from "../cloudflare/payments-worker/src/entry-app-qr.js";
import { AlignAppQrAuthority } from "../cloudflare/payments-worker/src/app-qr-authority.js";

globalThis.crypto ??= webcrypto;
const API = "https://api.alignmembers.com.mx";
const MEMBER_TOKEN = "t".repeat(64);
const OTHER_TOKEN = "v".repeat(64);
const SESSION_TOKEN = "s".repeat(64);
const SECRET = "sk_test_not_real_local_secret_for_qr_capture_tests";
function setup(enabled = true) {
  const records = new Map();
  const kv = {
    get: async (key) => records.get(key) || null,
    put: async (key, value) => { records.set(key, value); },
    delete: async (key) => { records.delete(key); },
  };
  const validFrom = new Date(Date.now() - 60_000).toISOString();
  const validUntil = new Date(Date.now() + 86_400_000).toISOString();
  const member = {
    groupId: "GRP-A", token: MEMBER_TOKEN, name: "Socio de Pruebas",
    status: "Activa", memberCode: "ALIGN-MOCK-001", level: "Brotherhood",
    planKey: "brotherhood", validFrom, validUntil,
  };
  records.set("member:" + MEMBER_TOKEN, JSON.stringify(member));
  records.set("member:" + OTHER_TOKEN, JSON.stringify({ ...member, token: OTHER_TOKEN, groupId: "GRP-B" }));
  records.set("member-session:" + SESSION_TOKEN, JSON.stringify({
    groupId: "GRP-A", primaryToken: MEMBER_TOKEN, expiresAt: Date.now() + 3600_000
  }));
  // A single DO instance per id provides the same logical authoritative
  // record to callers from different PoPs; unlike the PAYMENT_STATE KV cache.
  const objects = new Map();
  const namespace = {
    idFromName: (name) => name,
    get: (id) => {
      if (!objects.has(id)) {
        const storage = new Map();
        const ctx = { storage: {
          get: async (key) => storage.get(key),
          put: async (key, value) => { storage.set(key, value); },
          transaction: async (fn) => fn({
            get: async (key) => storage.get(key),
            put: async (key, value) => { storage.set(key, value); },
          }),
        } };
        objects.set(id, new AlignAppQrAuthority(ctx));
      }
      return { fetch: (url, init) => objects.get(id).fetch(new Request(url, init)) };
    },
  };
  const env = {
    PAYMENT_STATE: kv,
    APP_QR_AUTHORITY: namespace,
    ALIGN_APP_QR_SECRET: "private-test-only-app-qr-key-not-for-deployment-12345",
    ALIGN_APP_QR_ROTATION_ENABLED: String(enabled),
    STRIPE_MODE: "test", STRIPE_SECRET_KEY: SECRET,
  };
  const auth = { authorization: "Bearer " + SESSION_TOKEN };
  const get = async (token = MEMBER_TOKEN, headers = auth) =>
    shortQrWorker.fetch(new Request(API + "/api/app-qr?token=" + token, { headers }), env);
  const rotate = async (old, token = MEMBER_TOKEN, headers = auth) =>
    shortQrWorker.fetch(new Request(API + "/api/app-qr", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ token, previousCode: old })
    }), env);
  return { env, records, get, rotate };
}
function code(url) { return new URL(url).pathname.split("/").pop(); }
function allySession(env) {
  const payload = Buffer.from(JSON.stringify({ allyId: "ALI-001", exp: Date.now() + 3600_000 })).toString("base64url");
  const signature = createHmac("sha256", env.STRIPE_SECRET_KEY).update("ally-session:" + payload).digest("base64url");
  return payload + "." + signature;
}
async function scan(env, qr) {
  const bearer = allySession(env);
  return shortQrWorker.fetch(new Request(API + "/api/ally/scan", {
    method: "POST",
    headers: { authorization: "Bearer " + bearer, "content-type": "application/json" },
    body: JSON.stringify({ qr })
  }), env);
}
test("App QR is OFF by default; the 15-minute web QR remains available", async () => {
  const { env, get, rotate } = setup(false);
  assert.equal((await get()).status, 404);
  assert.equal((await rotate("A" + "x".repeat(31))).status, 404);
  const web = await shortQrWorker.fetch(new Request(API + "/api/monthly-qr?token=" + MEMBER_TOKEN), env);
  assert.equal(web.status, 200);
  const details = await web.json();
  assert.match(details.validationUrl, /\/q\//);
  assert.equal((await shortQrWorker.fetch(new Request(details.validationUrl), env)).status, 200);
});
test("App QR requires authenticated owner of that exact group; screenshots do not reveal bearer", async () => {
  const { get, rotate } = setup(true);
  assert.equal((await get(MEMBER_TOKEN, {})).status, 401);
  assert.equal((await get(OTHER_TOKEN)).status, 403);
  const current = await (await get()).json();
  assert.equal(current.appRotationEnabled, true);
  assert.doesNotMatch(current.validationUrl, new RegExp(MEMBER_TOKEN));
  assert.equal((await rotate(code(current.validationUrl), OTHER_TOKEN)).status, 403);
  assert.equal((await rotate(code(current.validationUrl), MEMBER_TOKEN, {})).status, 401);
});
test("Screenshot rotation replaces old app QR; old is rejected by link and ally scan", async () => {
  const { env, get, rotate } = setup(true);
  const firstResponse = await get();
  assert.equal(firstResponse.status, 200);
  const first = await firstResponse.json();
  assert.equal((await shortQrWorker.fetch(new Request(first.validationUrl), env)).status, 200);
  assert.equal((await scan(env, first.validationUrl)).status, 200);
  const replaced = await rotate(code(first.validationUrl));
  assert.equal(replaced.status, 200);
  const second = await replaced.json();
  assert.notEqual(second.validationUrl, first.validationUrl);
  assert.equal((await shortQrWorker.fetch(new Request(first.validationUrl), env)).status, 403);
  assert.equal((await scan(env, first.validationUrl)).status, 400);
  assert.equal((await shortQrWorker.fetch(new Request(second.validationUrl), env)).status, 200);
  assert.equal((await scan(env, second.validationUrl)).status, 200);
  assert.equal(await currentAppQrMapping(env, code(first.validationUrl)), null);
  assert.ok(await currentAppQrMapping(env, code(second.validationUrl)));
  assert.equal((await rotate(code(first.validationUrl))).status, 409);
  assert.equal((await (await get()).json()).validationUrl, second.validationUrl);
});
test("Old app QR also fails if someone replays previously expanded validation URL", async () => {
  const { env, get, rotate } = setup(true);
  const first = await (await get()).json();
  // A QR which has already been rewritten for a partner includes appCode.
  const member = JSON.parse(env.PAYMENT_STATE ? await env.PAYMENT_STATE.get("member:" + MEMBER_TOKEN) : "{}");
  const slot = Math.floor(Date.now() / (15 * 60 * 1000));
  const cycle = member.validFrom + "|" + member.validUntil;
  const sig = createHmac("sha256", SECRET).update(MEMBER_TOKEN + ":" + cycle + ":" + slot).digest("base64url");
  const expanded = new URL(API + "/api/validate-member");
  for (const [key, value] of Object.entries({
    token: MEMBER_TOKEN, from: member.validFrom, until: member.validUntil,
    slot: String(slot), sig, appCode: code(first.validationUrl)
  })) expanded.searchParams.set(key, value);
  assert.equal((await scan(env, expanded.toString())).status, 200);
  await rotate(code(first.validationUrl));
  assert.equal((await scan(env, expanded.toString())).status, 400);
});

test("App QR fails closed without its Durable Object binding or private HMAC key", async () => {
  const { env, get } = setup(true);
  delete env.APP_QR_AUTHORITY;
  assert.equal((await get()).status, 503);
  env.APP_QR_AUTHORITY = setup(true).env.APP_QR_AUTHORITY;
  delete env.ALIGN_APP_QR_SECRET;
  assert.equal((await get()).status, 503);
});
test("App and web QRs remain independent when a screenshot rotates the app QR", async () => {
  const { env, get, rotate } = setup(true);
  const web = await (await shortQrWorker.fetch(
    new Request(API + "/api/monthly-qr?token=" + MEMBER_TOKEN), env)).json();
  const first = await (await get()).json();
  await rotate(code(first.validationUrl));
  assert.equal((await shortQrWorker.fetch(new Request(web.validationUrl), env)).status, 200);
  assert.equal((await scan(env, web.validationUrl)).status, 200);
  assert.equal((await shortQrWorker.fetch(new Request(first.validationUrl), env)).status, 403);
});
