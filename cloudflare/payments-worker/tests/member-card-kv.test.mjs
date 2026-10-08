import test from "node:test";
import assert from "node:assert/strict";
import memberCardWorker from "../src/entry.js";

const token = "a".repeat(48);
const request = new Request("https://feature-apple-wallet-align-align-payments.alignservice18.workers.dev/api/member-card?token=" + token);
const kv = (value) => ({ get: async (key) => {
  assert.equal(key, "member:" + token);
  return value;
}});

test("Malformed KV JSON returns controlled 422 rather than throwing 1101", async () => {
  const result = await memberCardWorker.fetch(request, {PAYMENT_STATE:kv("not valid json")});
  assert.equal(result.status, 422);
  assert.match((await result.json()).error, /JSON válido/);
});
test("A missing card returns 404, not an uncaught error", async () => {
  const result = await memberCardWorker.fetch(request, {PAYMENT_STATE:kv(null)});
  assert.equal(result.status, 404);
});
test("Malformed record types fail closed", async () => {
  const result = await memberCardWorker.fetch(request, {PAYMENT_STATE:kv("null")});
  assert.equal(result.status, 422);
});
test("Staging member fixture validates when correctly stored", async () => {
  const record = {
    name:"SOCIO PRUEBA ALIGN", level:"The Brotherhood", memberCode:"ALIGN-TEST-0001",
    status:"Activa", validFrom:new Date(Date.now()-3600000).toISOString(),
    validUntil:new Date(Date.now()+3600000).toISOString(),
    photoUrl:"https://alignmembers.com.mx/assets/align-primary.png"
  };
  const result = await memberCardWorker.fetch(request, {PAYMENT_STATE:kv(JSON.stringify(record))});
  assert.equal(result.status, 200);
  const payload = await result.json();
  assert.equal(payload.active, true);
  assert.equal(payload.memberCode, "ALIGN-TEST-0001");
});
