import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { walletRoute, rewriteWalletAllyRequest, walletQrUrl } from "../src/apple-wallet.js";

test("Wallet remains unavailable without signing secrets and opt-in", async () => {
  const response = await walletRoute(new Request("https://api.alignmembers.com.mx/api/wallet/status"), {});
  assert.equal(response.status, 200);
  assert.equal((await response.json()).available, false);
  assert.equal(response.headers.get("cache-control"), "no-store");
});
test("Wallet does not return an unsigned pass", async () => {
  const response = await walletRoute(new Request("https://api.alignmembers.com.mx/api/wallet/apple?token=example"), {});
  assert.equal(response.status, 503);
});
test("Payments and existing QR routes bypass Wallet", async () => {
  assert.equal(await walletRoute(new Request("https://api.alignmembers.com.mx/api/checkout"),{}), null);
  assert.equal(await walletRoute(new Request("https://api.alignmembers.com.mx/api/monthly-qr"),{}), null);
});
test("Ally scan request is unchanged while Wallet is disabled", async () => {
  const request = new Request("https://api.alignmembers.com.mx/api/ally/scan",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({qr:"https://api.alignmembers.com.mx/api/wallet/verify/11111111111111111111111111111111"})});
  const next=await rewriteWalletAllyRequest(request,{},null);
  assert.equal(next,request);
});
test("Unknown Wallet QR never validates as an active membership", async () => {
  const env={PAYMENT_STATE:{get:async()=>null}};
  const response=await walletRoute(new Request("https://api.alignmembers.com.mx/api/wallet/verify/11111111111111111111111111111111"),env);
  assert.equal(response.status,403);
});


test("Preview KV binding never points to the production namespace", () => {
  const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  const prod = toml.match(/\[\[kv_namespaces\]\]\s*binding\s*=\s*"PAYMENT_STATE"\s*id\s*=\s*"([0-9a-f]{32})"/);
  const preview = toml.match(/\[\[previews\.kv_namespaces\]\]\s*binding\s*=\s*"PAYMENT_STATE"\s*id\s*=\s*"([0-9a-f]{32})"/);
  assert.ok(prod, "Production KV binding must be explicit");
  assert.ok(preview, "Preview KV binding must be explicit");
  assert.notEqual(prod[1], preview[1], "Never reuse production KV in previews");
  const productionVars = toml.split("[vars]")[1].split("[previews]")[0];
  const previewVars = toml.split("[previews.vars]")[1].split("[[previews.kv_namespaces]]")[0];
  assert.match(productionVars, /WALLET_ENABLED\s*=\s*"false"/);
  assert.match(previewVars, /WALLET_ENABLED\s*=\s*"true"/);
});

test("Wallet QR uses Preview origin and never redirects testing scans to live API", () => {
  const url="https://feature-apple-wallet-align-align-payments.alignservice18.workers.dev/api/wallet/apple";
  const id="11111111111111111111111111111111";
  assert.equal(walletQrUrl(url,id), "https://feature-apple-wallet-align-align-payments.alignservice18.workers.dev/api/wallet/verify/"+id);
  assert.equal(walletQrUrl("https://api.alignmembers.com.mx/api/wallet/apple",id),"https://api.alignmembers.com.mx/api/wallet/verify/"+id);
  assert.throws(()=>walletQrUrl("https://evil.example/api/wallet/apple",id));
});
