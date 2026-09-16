import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import worker from '../src/main.js';

const token = 'sandbox-member-token-for-regression-only';
const initial = { validFrom: '2026-09-15T18:00:00.000Z', validUntil: '2026-10-15T18:00:00.000Z' };
const renewed = { validFrom: '2026-10-15T18:00:00.000Z', validUntil: '2026-11-15T18:00:00.000Z' };
const seconds = (iso) => Date.parse(iso) / 1000;

function fixture(t, subscription) {
  const kv = new Map([
    [`member:${token}`, JSON.stringify({ token, name: 'Sandbox regression', status: 'Activa', ...initial })],
    ['subscription:sub_test', 'group_test'],
    ['group:group_test', JSON.stringify({ tokens: [token] })],
  ]);
  const env = {
    PAYMENT_STATE: { get: async (key) => kv.get(key) ?? null, put: async (key, value) => kv.set(key, value) },
    STRIPE_SECRET_KEY: 'sk_test_local_fixture', STRIPE_WEBHOOK_SECRET: 'local-fixture-signature',
    ALIGN_DB_URL: 'https://reports.example.test', ALIGN_DB_SECRET: 'local-report-fixture',
  };
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url) === 'https://api.stripe.com/v1/subscriptions/sub_test') return Response.json(subscription);
    if (String(url) === env.ALIGN_DB_URL) return Response.json({ ok: true });
    throw new Error(`Unexpected external call: ${url}`);
  });
  return { env, member: () => JSON.parse(kv.get(`member:${token}`)) };
}

async function event(env, type, object, id = type) {
  const body = JSON.stringify({ id, type, data: { object } });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', env.STRIPE_WEBHOOK_SECRET).update(`${timestamp}.${body}`).digest('hex');
  return worker.fetch(new Request('https://api.alignmembers.com.mx/api/stripe/webhook', {
    method: 'POST', headers: { 'stripe-signature': `t=${timestamp},v1=${signature}` }, body,
  }), env);
}

for (const shape of ['item', 'legacy']) {
  test(`paid renewal keeps exact Stripe ${shape} period, including replay`, async (t) => {
    const dates = { current_period_start: seconds(renewed.validFrom), current_period_end: seconds(renewed.validUntil) };
    const subscription = shape === 'item' ? { items: { data: [dates] } } : dates;
    const f = fixture(t, subscription);
    const invoice = { id: 'in_test', parent: { subscription_details: { subscription: 'sub_test' } }, amount_paid: 24900 };
    for (let i = 0; i < 2; i++) {
      assert.equal((await event(f.env, 'invoice.paid', invoice)).status, 200);
      assert.equal(f.member().validFrom, renewed.validFrom);
      assert.equal(f.member().validUntil, renewed.validUntil);
      assert.equal(f.member().status, 'Activa');
    }
  });
}

test('missing Stripe period preserves existing expiry instead of granting another month', async (t) => {
  const f = fixture(t, { items: { data: [{}] } });
  t.mock.method(console, 'error', () => {});
  assert.equal((await event(f.env, 'customer.subscription.updated', { id: 'sub_test', status: 'active' })).status, 200);
  assert.equal(f.member().validFrom, initial.validFrom);
  assert.equal(f.member().validUntil, initial.validUntil);
});

test('failed renewal blocks the existing QR; payment recovery restores access', async (t) => {
  const now = Math.floor(Date.now() / 1000);
  const f = fixture(t, { items: { data: [{ current_period_start: now - 60, current_period_end: now + 86400 }] } });
  const invoice = { id: 'in_test', parent: { subscription_details: { subscription: 'sub_test' } }, amount_paid: 24900 };
  await event(f.env, 'invoice.paid', invoice, 'evt_initial');
  const qrRequest = () => new Request(`https://api.alignmembers.com.mx/api/monthly-qr?token=${token}`);
  const qr = await (await worker.fetch(qrRequest(), f.env)).json();
  assert.ok(qr.validationUrl);
  assert.equal((await worker.fetch(new Request(qr.validationUrl), f.env)).status, 200);
  assert.equal((await event(f.env, 'invoice.payment_failed', invoice)).status, 200);
  assert.equal(f.member().status, 'Pago pendiente');
  assert.equal((await worker.fetch(qrRequest(), f.env)).status, 403);
  assert.equal((await worker.fetch(new Request(qr.validationUrl), f.env)).status, 403);
  assert.equal((await event(f.env, 'invoice.paid', invoice, 'evt_recovered')).status, 200);
  assert.equal(f.member().status, 'Activa');
  assert.equal((await worker.fetch(new Request(qr.validationUrl), f.env)).status, 200);
});

test('invalid webhook signature cannot change membership', async (t) => {
  const f = fixture(t, {});
  const response = await worker.fetch(new Request('https://api.alignmembers.com.mx/api/stripe/webhook', {
    method: 'POST', headers: { 'stripe-signature': 't=1,v1=invalid' },
    body: JSON.stringify({ id: 'evt_invalid', type: 'invoice.payment_failed', data: { object: { subscription: 'sub_test' } } }),
  }), f.env);
  assert.equal(response.status, 400);
  assert.equal(f.member().status, 'Activa');
});
