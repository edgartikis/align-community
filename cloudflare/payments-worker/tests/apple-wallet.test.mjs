import test from "node:test";
import assert from "node:assert/strict";
import { walletRoute } from "../src/apple-wallet.js";

test("wallet availability fails closed without signer", async () => {
  const response = walletRoute(new Request("https://api.alignmembers.com.mx/api/wallet/status"));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).available, false);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("pass download cannot serve unsigned pass", async () => {
  const response = walletRoute(new Request("https://api.alignmembers.com.mx/api/wallet/apple?token=example"));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
});

test("unrelated payment and QR routes pass through unchanged", () => {
  assert.equal(walletRoute(new Request("https://api.alignmembers.com.mx/api/checkout")), null);
  assert.equal(walletRoute(new Request("https://api.alignmembers.com.mx/api/monthly-qr")), null);
});
