const STRIPE_API = 'https://api.stripe.com/v1/checkout/sessions';

const PLANS = {
  brotherhood: { name: 'The Brotherhood', amount: 24900 },
  girls: { name: 'Girls Club', amount: 24900 },
  ranch: { name: 'Ranch Club', amount: 24900 },
  duo: { name: 'Duo Club', amount: 34900 },
  circle: { name: 'Private Circle', amount: 49900 },
};

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    const plan = PLANS[String(body.plan || '').toLowerCase()];
    if (!plan) return json_({ error: 'Plan inválido.' });

    const secret = PropertiesService.getScriptProperties().getProperty('STRIPE_TEST_SECRET');
    if (!secret || !secret.startsWith('sk_test_')) {
      return json_({ error: 'Falta configurar STRIPE_TEST_SECRET en Script Properties.' });
    }

    const origin = String(body.returnOrigin || 'https://edgartikis.github.io').replace(/\/$/, '');
    const planKey = String(body.plan || '').toLowerCase();
    const params = {
      mode: 'payment',
      success_url: `${origin}/align-community/pago.html?plan=${encodeURIComponent(planKey)}&sandbox=success`,
      cancel_url: `${origin}/align-community/pago.html?plan=${encodeURIComponent(planKey)}&sandbox=cancel`,
      'line_items[0][price_data][currency]': 'mxn',
      'line_items[0][price_data][unit_amount]': String(plan.amount),
      'line_items[0][price_data][product_data][name]': `${plan.name} · ALIGN TEST`,
      'line_items[0][quantity]': '1',
      'metadata[align_test]': 'true',
      'metadata[plan]': planKey,
      'metadata[payment_method_requested]': String(body.paymentMethod || 'wallet'),
    };

    const response = UrlFetchApp.fetch(STRIPE_API, {
      method: 'post',
      headers: { Authorization: `Bearer ${secret}` },
      payload: params,
      muteHttpExceptions: true,
    });
    const data = JSON.parse(response.getContentText() || '{}');
    if (response.getResponseCode() >= 400 || !data.url) {
      return json_({ error: data?.error?.message || 'Stripe no pudo crear la sesión de prueba.' });
    }
    return json_({ url: data.url });
  } catch (err) {
    return json_({ error: err.message || 'Error interno.' });
  }
}

function doGet() {
  return json_({ ok: true, service: 'ALIGN Wallet Sandbox', mode: 'TEST' });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
