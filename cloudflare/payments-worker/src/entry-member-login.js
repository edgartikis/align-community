import memberActivityWorker from "./entry-member-activity.js";

const ALLOWED_ORIGINS = new Set([
  "https://alignmembers.com.mx",
  "https://www.alignmembers.com.mx",
  "https://edgartikis.github.io",
]);

function cors(origin = "") {
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : "https://alignmembers.com.mx";
  return {
    "access-control-allow-origin": allowed,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
    vary: "Origin",
  };
}

function json(body, status = 200, origin = "") {
  return Response.json(body, {
    status,
    headers: { ...cors(origin), "cache-control": "no-store" },
  });
}

function clean(value, max = 200) {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .trim()
    .slice(0, max);
}

function normalizeUsername(value) {
  return clean(value, 24)
    .toLowerCase()
    .replace(/\s+/g, ".")
    .replace(/\.{2,}/g, ".")
    .replace(/^\.+|\.+$/g, "");
}

function validUsername(value) {
  return /^[a-z0-9._-]{4,24}$/i.test(value);
}

function validHash(value) {
  return /^[a-f0-9]{64}$/.test(value);
}

function constantTimeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function readJson(env, key) {
  const raw = await env.PAYMENT_STATE.get(key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) { return null; }
}

function stripeSecret(env) {
  const value = String(env.STRIPE_SECRET_KEY || "").trim();
  return /^([sr]k)_(test|live)_/.test(value) ? value : "";
}

function siteOrigin(env) {
  return String(env.SITE_ORIGIN || "https://alignmembers.com.mx").replace(/\/$/, "");
}

async function stripeRequest(env, method, path, params = null) {
  const secret = stripeSecret(env);
  if (!secret) throw new Error("Stripe no está configurado.");
  const options = { method, headers: { authorization: `Bearer ${secret}` } };
  if (params) {
    options.headers["content-type"] = "application/x-www-form-urlencoded";
    options.body = new URLSearchParams(params);
  }
  const response = await fetch(`https://api.stripe.com/v1/${path}`, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || "Stripe rechazó la solicitud.");
  return data;
}

function memberSessionToken() {
  return `${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`;
}

async function issueMemberSession(env, account) {
  const token = memberSessionToken();
  const record = {
    username: account.username,
    groupId: account.groupId,
    primaryToken: account.primaryToken,
    createdAt: new Date().toISOString(),
    expiresAt: Date.now() + 12 * 60 * 60 * 1000,
  };
  await env.PAYMENT_STATE.put(`member-session:${token}`, JSON.stringify(record), { expirationTtl: 12 * 60 * 60 });
  return token;
}

function bearerToken(request) {
  const header = String(request.headers.get("authorization") || "");
  const match = /^Bearer\s+([A-Za-z0-9_-]{40,})$/i.exec(header);
  return match ? match[1] : "";
}

async function requireMemberSession(request, env) {
  const token = bearerToken(request);
  if (!token) throw new Error("Tu sesión de miembro expiró. Inicia sesión nuevamente.");
  const record = await readJson(env, `member-session:${token}`);
  if (!record?.groupId || Number(record.expiresAt || 0) <= Date.now()) {
    if (token) await env.PAYMENT_STATE.delete(`member-session:${token}`);
    throw new Error("Tu sesión de miembro expiró. Inicia sesión nuevamente.");
  }
  return record;
}

async function subscriptionIdsForGroup(env, groupId) {
  const ids = new Set();
  let cursor = undefined;
  let inspected = 0;
  do {
    const page = await env.PAYMENT_STATE.list({ prefix: "subscription:", limit: 100, cursor });
    for (const key of page.keys || []) {
      inspected += 1;
      if (inspected > 2500) break;
      const mappedGroup = clean(await env.PAYMENT_STATE.get(key.name), 100);
      if (mappedGroup === groupId) ids.add(clean(key.name.slice("subscription:".length), 120));
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor && inspected <= 2500);

  cursor = undefined;
  inspected = 0;
  do {
    const page = await env.PAYMENT_STATE.list({ prefix: "activation:", limit: 100, cursor });
    for (const key of page.keys || []) {
      inspected += 1;
      if (inspected > 1500) break;
      const activation = await readJson(env, key.name);
      if (clean(activation?.groupId, 100) === groupId && activation?.subscriptionId) {
        ids.add(clean(activation.subscriptionId, 120));
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor && inspected <= 1500);

  return [...ids].filter((id) => /^sub_/.test(id));
}

function subscriptionPriority(status) {
  const value = String(status || "").toLowerCase();
  if (["active", "trialing"].includes(value)) return 5;
  if (["past_due", "unpaid"].includes(value)) return 4;
  if (["incomplete"].includes(value)) return 3;
  if (["paused"].includes(value)) return 2;
  return 1;
}

async function subscriptionsForGroup(env, groupId) {
  const ids = await subscriptionIdsForGroup(env, groupId);
  const subscriptions = [];
  for (const id of ids) {
    try {
      subscriptions.push(await stripeRequest(env, "GET", `subscriptions/${encodeURIComponent(id)}`));
    } catch (_) {}
  }
  subscriptions.sort((a, b) =>
    subscriptionPriority(b.status) - subscriptionPriority(a.status) ||
    Number(b.created || 0) - Number(a.created || 0)
  );
  return subscriptions;
}

function subscriptionPeriod(subscription) {
  const item = subscription?.items?.data?.[0] || {};
  return {
    start: Number(item.current_period_start || subscription?.current_period_start || 0),
    end: Number(item.current_period_end || subscription?.current_period_end || 0),
  };
}

function subscriptionPrice(subscription) {
  const item = subscription?.items?.data?.[0] || {};
  return item?.price?.id || item?.plan?.id || "";
}

async function paymentMethodLabel(env, customer, subscription) {
  const paymentMethodId = typeof subscription?.default_payment_method === "string"
    ? subscription.default_payment_method
    : typeof customer?.invoice_settings?.default_payment_method === "string"
      ? customer.invoice_settings.default_payment_method
      : "";
  if (paymentMethodId && /^pm_/.test(paymentMethodId)) {
    try {
      const pm = await stripeRequest(env, "GET", `payment_methods/${encodeURIComponent(paymentMethodId)}`);
      if (pm?.card?.last4) {
        return { type: "card", brand: clean(pm.card.brand, 30), last4: clean(pm.card.last4, 4) };
      }
    } catch (_) {}
  }

  const sourceId = typeof subscription?.default_source === "string"
    ? subscription.default_source
    : typeof customer?.default_source === "string"
      ? customer.default_source
      : "";
  if (sourceId && /^card_/.test(sourceId) && customer?.id) {
    try {
      const card = await stripeRequest(env, "GET", `customers/${encodeURIComponent(customer.id)}/sources/${encodeURIComponent(sourceId)}`);
      if (card?.last4) return { type: "card", brand: clean(card.brand, 30), last4: clean(card.last4, 4) };
    } catch (_) {}
  }
  return null;
}

async function billingSummary(env, memberSession) {
  const subscriptions = await subscriptionsForGroup(env, memberSession.groupId);
  const subscription = subscriptions[0] || null;
  const customerId = typeof subscription?.customer === "string" ? subscription.customer : "";
  const customer = customerId
    ? await stripeRequest(env, "GET", `customers/${encodeURIComponent(customerId)}`).catch(() => null)
    : null;
  const status = String(subscription?.status || "canceled").toLowerCase();
  const period = subscriptionPeriod(subscription);
  const activeish = ["active", "trialing", "past_due", "unpaid", "incomplete"].includes(status);
  const canceled = ["canceled", "incomplete_expired"].includes(status);
  return {
    subscription,
    customer,
    public: {
      status,
      cancelAtPeriodEnd: Boolean(subscription?.cancel_at_period_end),
      periodStart: period.start || null,
      periodEnd: period.end || null,
      paymentMethod: await paymentMethodLabel(env, customer, subscription),
      canCancel: ["active", "trialing"].includes(status) && !subscription?.cancel_at_period_end,
      canResume: ["active", "trialing"].includes(status) && Boolean(subscription?.cancel_at_period_end),
      canChangePayment: Boolean(customerId && activeish),
      canResubscribe: Boolean(customerId && subscriptionPrice(subscription) && canceled),
    },
  };
}

function billingReturnTarget(request, env, memberSession, result, includeSetupId = false) {
  const url = new URL(request.url);
  const isPreview = url.hostname.startsWith("member-self-service-billing-") && url.hostname.endsWith(".workers.dev");
  if (isPreview) {
    const suffix = includeSetupId ? `&setup_session_id={CHECKOUT_SESSION_ID}` : "";
    return `${url.origin}/billing-preview?billing=${encodeURIComponent(result)}${suffix}`;
  }
  const base = siteOrigin(env);
  const token = encodeURIComponent(memberSession.primaryToken);
  const suffix = includeSetupId ? `&setup_session_id={CHECKOUT_SESSION_ID}` : "";
  return `${base}/portal.html?token=${token}&billing=${encodeURIComponent(result)}${suffix}`;
}

async function createSetupCheckout(request, env, memberSession, summary) {
  if (!summary.customer?.id) throw new Error("No encontramos el cliente de Stripe.");
  return stripeRequest(env, "POST", "checkout/sessions", {
    mode: "setup",
    customer: summary.customer.id,
    "payment_method_types[0]": "card",
    locale: "es",
    success_url: billingReturnTarget(request, env, memberSession, "payment-updated", true),
    cancel_url: billingReturnTarget(request, env, memberSession, "payment-canceled"),
    "metadata[align_group_id]": memberSession.groupId,
    "metadata[align_action]": "payment_method_update",
  });
}

async function confirmSetupCheckout(env, memberSession, summary, setupSessionId) {
  if (!/^cs_(test_|live_)?[A-Za-z0-9_]+$/.test(setupSessionId)) throw new Error("Sesión de Stripe no válida.");
  const checkout = await stripeRequest(env, "GET", `checkout/sessions/${encodeURIComponent(setupSessionId)}`);
  if (checkout.mode !== "setup" || checkout.status !== "complete") throw new Error("El cambio de tarjeta todavía no está completo.");
  if (!summary.customer?.id || checkout.customer !== summary.customer.id) throw new Error("La sesión de pago no corresponde a esta membresía.");
  const setupIntentId = typeof checkout.setup_intent === "string" ? checkout.setup_intent : checkout.setup_intent?.id || "";
  if (!setupIntentId) throw new Error("Stripe no devolvió el método de pago.");
  const intent = await stripeRequest(env, "GET", `setup_intents/${encodeURIComponent(setupIntentId)}`);
  const paymentMethodId = typeof intent.payment_method === "string" ? intent.payment_method : intent.payment_method?.id || "";
  if (!/^pm_/.test(paymentMethodId)) throw new Error("Stripe no devolvió una tarjeta válida.");

  await stripeRequest(env, "POST", `customers/${encodeURIComponent(summary.customer.id)}`, {
    "invoice_settings[default_payment_method]": paymentMethodId,
  });
  if (summary.subscription?.id && summary.subscription.status !== "canceled") {
    await stripeRequest(env, "POST", `subscriptions/${encodeURIComponent(summary.subscription.id)}`, {
      default_payment_method: paymentMethodId,
    });
  }

  const recoverable = ["past_due", "unpaid", "incomplete"].includes(String(summary.subscription?.status || "").toLowerCase());
  const latestInvoiceId = typeof summary.subscription?.latest_invoice === "string"
    ? summary.subscription.latest_invoice
    : summary.subscription?.latest_invoice?.id || "";
  if (recoverable && /^in_/.test(latestInvoiceId)) {
    try {
      await stripeRequest(env, "POST", `invoices/${encodeURIComponent(latestInvoiceId)}/pay`, {
        payment_method: paymentMethodId,
      });
    } catch (error) {
      console.error("ALIGN invoice retry after payment method update", error);
    }
  }
}

async function createResubscribeCheckout(request, env, memberSession, summary) {
  const subscription = summary.subscription;
  const priceId = subscriptionPrice(subscription);
  const customerId = summary.customer?.id || "";
  if (!customerId || !/^price_/.test(priceId)) throw new Error("No encontramos los datos necesarios para reactivar la membresía.");
  const plan = clean(subscription?.metadata?.align_plan, 30) || "brotherhood";
  const tier = clean(subscription?.metadata?.align_pricing_tier, 30) || "founder";
  return stripeRequest(env, "POST", "checkout/sessions", {
    mode: "subscription",
    customer: customerId,
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    "payment_method_collection": "always",
    locale: "es",
    success_url: billingReturnTarget(request, env, memberSession, "resubscribed"),
    cancel_url: billingReturnTarget(request, env, memberSession, "resubscribe-canceled"),
    "metadata[align_group_id]": memberSession.groupId,
    "metadata[align_plan]": plan,
    "metadata[align_pricing_tier]": tier,
    "metadata[align_recovery]": "member_self_service",
    "subscription_data[metadata][align_group_id]": memberSession.groupId,
    "subscription_data[metadata][align_plan]": plan,
    "subscription_data[metadata][align_pricing_tier]": tier,
    "subscription_data[metadata][align_recovery]": "member_self_service",
  });
}

async function handleBilling(request, env) {
  const origin = request.headers.get("origin") || "";
  const memberSession = await requireMemberSession(request, env);
  if (request.method === "GET") {
    const summary = await billingSummary(env, memberSession);
    return json({ ok: true, ...summary.public }, 200, origin);
  }

  const body = await request.json().catch(() => ({}));
  const action = clean(body.action, 40);
  let summary = await billingSummary(env, memberSession);

  if (action === "cancel") {
    if (!summary.public.canCancel || !summary.subscription?.id) throw new Error("Esta membresía no se puede cancelar en este momento.");
    await stripeRequest(env, "POST", `subscriptions/${encodeURIComponent(summary.subscription.id)}`, { cancel_at_period_end: "true" });
  } else if (action === "resume") {
    if (!summary.public.canResume || !summary.subscription?.id) throw new Error("Esta membresía no tiene una cancelación pendiente.");
    await stripeRequest(env, "POST", `subscriptions/${encodeURIComponent(summary.subscription.id)}`, { cancel_at_period_end: "false" });
  } else if (action === "change_payment") {
    const checkout = await createSetupCheckout(request, env, memberSession, summary);
    return json({ ok: true, url: checkout.url }, 200, origin);
  } else if (action === "confirm_payment") {
    await confirmSetupCheckout(env, memberSession, summary, clean(body.setupSessionId, 180));
  } else if (action === "resubscribe") {
    if (!summary.public.canResubscribe) throw new Error("Esta membresía no necesita una reactivación completa.");
    const checkout = await createResubscribeCheckout(request, env, memberSession, summary);
    return json({ ok: true, url: checkout.url }, 200, origin);
  } else {
    throw new Error("Acción de mensualidad no válida.");
  }

  summary = await billingSummary(env, memberSession);
  return json({ ok: true, ...summary.public }, 200, origin);
}


function billingPreviewPage(request) {
  const url = new URL(request.url);
  if (!(url.hostname.startsWith("member-self-service-billing-") && url.hostname.endsWith(".workers.dev"))) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(`<!doctype html><html lang="es-MX"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ALIGN Billing Preview</title><style>body{margin:0;background:#080b10;color:#f3eee4;font:16px system-ui,sans-serif}.wrap{max-width:760px;margin:40px auto;padding:24px}.card{padding:24px;border:1px solid #445;background:#10243d;margin-bottom:16px}input,button{width:100%;box-sizing:border-box;padding:13px;margin:7px 0;border:1px solid #667;background:#0b1119;color:#fff}button{cursor:pointer;background:#f3eee4;color:#080b10;font-weight:700}.row{display:grid;grid-template-columns:1fr 1fr;gap:10px}.muted{color:#aeb4bd}.ok{color:#b8d9b8}.warn{color:#e0c99f}pre{white-space:pre-wrap;word-break:break-word;background:#05070a;padding:14px;border:1px solid #334}@media(max-width:620px){.row{grid-template-columns:1fr}}</style></head><body><main class="wrap"><h1>ALIGN · Billing Preview</h1><p class="muted">Solo rama de prueba. Stripe Sandbox.</p><section class="card" id="loginBox"><input id="username" placeholder="Usuario" autocomplete="username"><input id="password" type="password" placeholder="Contraseña" autocomplete="current-password"><button id="login">Entrar</button><div id="loginMsg" class="warn"></div></section><section class="card" id="billingBox" hidden><h2>Mensualidad</h2><pre id="summary">Cargando…</pre><div class="row"><button data-action="change_payment">Cambiar tarjeta</button><button data-action="cancel">Cancelar renovación</button><button data-action="resume">Reactivar renovación</button><button data-action="resubscribe">Reactivar membresía</button></div><div id="msg" class="warn"></div></section></main><script>
const qs=new URLSearchParams(location.search);
const key='align_preview_billing_session';
let session=sessionStorage.getItem(key)||'';
const enc=new TextEncoder();
const hex=b=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
async function sha256(v){return hex(await crypto.subtle.digest('SHA-256',enc.encode(v)))}
async function api(action,payload={}){
 const opt={method:action?'POST':'GET',headers:{'content-type':'application/json',authorization:'Bearer '+session}};
 if(action)opt.body=JSON.stringify({action,...payload});
 const r=await fetch('/api/member-billing',opt),d=await r.json().catch(()=>({}));
 if(!r.ok)throw new Error(d.error||'Error');
 return d;
}
async function refresh(){if(!session)return;document.querySelector('#loginBox').hidden=true;document.querySelector('#billingBox').hidden=false;try{const d=await api();document.querySelector('#summary').textContent=JSON.stringify(d,null,2)}catch(e){document.querySelector('#msg').textContent=e.message}}
document.querySelector('#login').onclick=async()=>{const u=document.querySelector('#username').value.trim(),p=document.querySelector('#password').value;const m=document.querySelector('#loginMsg');m.textContent='';try{const r=await fetch('/api/member-login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:u,passwordHash:await sha256(p)})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'No se pudo iniciar sesión');session=d.sessionToken||'';if(!session)throw new Error('No se creó sesión de billing');sessionStorage.setItem(key,session);await refresh()}catch(e){m.textContent=e.message}};
document.querySelectorAll('[data-action]').forEach(b=>b.onclick=async()=>{const a=b.dataset.action,m=document.querySelector('#msg');m.textContent='';try{if(a==='cancel'&&!confirm('¿Programar cancelación al final del periodo?'))return;const d=await api(a);if(d.url){location.assign(d.url);return}m.textContent='OK';await refresh()}catch(e){m.textContent=e.message}});
(async()=>{if(qs.get('billing')==='payment-updated'&&qs.get('setup_session_id')&&session){try{await api('confirm_payment',{setupSessionId:qs.get('setup_session_id')});history.replaceState({},'',location.pathname+'?billing=payment-saved')}catch(e){document.querySelector('#loginMsg').textContent=e.message}}await refresh()})();
</script></body></html>`, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

async function recoverDraftIdFromStripe(env, sessionId) {
  const secret = stripeSecret(env);
  if (!secret || !/^cs_(test|live)_/.test(sessionId)) return "";
  try {
    const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
      headers: { authorization: `Bearer ${secret}` },
    });
    if (!response.ok) return "";
    const session = await response.json();
    return clean(session?.metadata?.align_draft_id || session?.client_reference_id, 100);
  } catch (_) {
    return "";
  }
}

async function draftIdForSession(env, sessionId) {
  let draftId = clean(await env.PAYMENT_STATE.get(`session:${sessionId}`), 100);
  if (draftId) return draftId;

  draftId = clean(await env.PAYMENT_STATE.get(`sessions:${sessionId}`), 100);
  if (draftId) {
    await env.PAYMENT_STATE.put(`session:${sessionId}`, draftId, { expirationTtl: 60 * 60 * 48 });
    return draftId;
  }

  draftId = await recoverDraftIdFromStripe(env, sessionId);
  if (draftId) {
    await env.PAYMENT_STATE.put(`session:${sessionId}`, draftId, { expirationTtl: 60 * 60 * 48 });
  }
  return draftId;
}

async function accountFromSession(env, sessionId, expectedUsername = "") {
  if (!sessionId) return null;
  const activation = await readJson(env, `activation:${sessionId}`);
  if (!activation?.groupId) return null;

  const draftId = await draftIdForSession(env, sessionId);
  if (!draftId) return null;
  const draft = await readJson(env, `draft:${draftId}`);
  const username = normalizeUsername(activation.username || draft?.username);
  const passwordHash = clean(draft?.passwordHash, 64).toLowerCase();
  if (!validUsername(username) || !validHash(passwordHash)) return null;
  if (expectedUsername && username !== expectedUsername) return null;

  const group = await readJson(env, `group:${activation.groupId}`);
  const tokens = Array.isArray(group?.tokens)
    ? group.tokens.filter((token) => /^[A-Za-z0-9_-]{20,}$/.test(String(token || "")))
    : Array.isArray(activation.members)
      ? activation.members.map((member) => member?.token).filter((token) => /^[A-Za-z0-9_-]{20,}$/.test(String(token || "")))
      : [];
  if (!tokens.length) return null;

  const account = {
    version: 1,
    username,
    passwordHash,
    groupId: activation.groupId,
    primaryToken: tokens[0],
    tokens,
    createdAt: activation.members?.[0]?.joinedAt || new Date().toISOString(),
  };
  await env.PAYMENT_STATE.put(`account:${username}`, JSON.stringify(account));
  return account;
}

async function findSessionForDraft(env, draftId) {
  for (const prefix of ["session:", "sessions:"]) {
    let cursor = undefined;
    do {
      const page = await env.PAYMENT_STATE.list({ prefix, limit: 100, cursor });
      for (const key of page.keys || []) {
        const mappedDraft = clean(await env.PAYMENT_STATE.get(key.name), 100);
        if (mappedDraft === draftId) return clean(key.name.slice(prefix.length), 180);
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
  }
  return "";
}

async function migrateAccount(env, username) {
  const direct = await readJson(env, `account:${username}`);
  if (direct) return direct;

  let cursor = undefined;
  let inspected = 0;
  do {
    const page = await env.PAYMENT_STATE.list({ prefix: "activation:", limit: 100, cursor });
    for (const key of page.keys || []) {
      inspected += 1;
      if (inspected > 1500) break;
      const activation = await readJson(env, key.name);
      if (!activation) continue;
      const sessionId = clean(activation.sessionId || key.name.slice("activation:".length), 180);
      const account = await accountFromSession(env, sessionId, username);
      if (account) return account;
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor && inspected <= 1500);

  cursor = undefined;
  do {
    const page = await env.PAYMENT_STATE.list({ prefix: "draft:", limit: 100, cursor });
    for (const key of page.keys || []) {
      const draft = await readJson(env, key.name);
      if (!draft || normalizeUsername(draft.username) !== username) continue;
      const draftId = clean(draft.draftId || key.name.slice("draft:".length), 100);
      const sessionId = await findSessionForDraft(env, draftId);
      if (!sessionId) continue;
      const account = await accountFromSession(env, sessionId, username);
      if (account) return account;
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  return null;
}

async function cardsForAccount(env, account) {
  const group = await readJson(env, `group:${account.groupId}`);
  const tokens = Array.isArray(group?.tokens) && group.tokens.length ? group.tokens : account.tokens || [];
  const cards = [];
  for (const token of tokens) {
    const member = await readJson(env, `member:${token}`);
    if (!member) continue;
    cards.push({
      token,
      name: clean(member.name, 100),
      level: clean(member.level, 60),
      planKey: clean(member.planKey, 30),
      memberCode: clean(member.memberCode, 60),
      status: clean(member.status, 30),
      position: Math.max(1, Math.round(Number(member.position) || 1)),
      photoUrl: String(member.photoUrl || ""),
      savings: Math.max(0, Number(member.savings || 0)),
      groupId: clean(member.groupId || account.groupId, 100),
    });
  }
  cards.sort((a, b) => a.position - b.position);
  return cards;
}

async function handleLogin(request, env) {
  const origin = request.headers.get("origin") || "";
  if (!env.PAYMENT_STATE) return json({ error: "La base de miembros no está conectada." }, 503, origin);

  const body = await request.json().catch(() => ({}));
  const username = normalizeUsername(body.username);
  const passwordHash = clean(body.passwordHash, 64).toLowerCase();
  if (!validUsername(username) || !validHash(passwordHash)) {
    return json({ error: "Usuario o contraseña incorrectos." }, 401, origin);
  }

  const account = await migrateAccount(env, username);
  if (!account || !constantTimeEqual(clean(account.passwordHash, 64).toLowerCase(), passwordHash)) {
    return json({ error: "Usuario o contraseña incorrectos." }, 401, origin);
  }

  const cards = await cardsForAccount(env, account);
  if (!cards.length) return json({ error: "La membresía no tiene tarjetas disponibles." }, 404, origin);

  const primary = cards.find((card) => card.position === 1) || cards[0];
  const active = cards.some((card) => card.status === "Activa");
  const sessionToken = await issueMemberSession(env, { ...account, primaryToken: primary.token });
  return json({
    ok: true,
    username,
    groupId: account.groupId,
    planKey: primary.planKey,
    planName: primary.level,
    primary,
    cards,
    active,
    billingOnly: !active,
    sessionToken,
  }, 200, origin);
}

async function captureActivation(request, env) {
  const response = await memberActivityWorker.fetch(request, env);
  if (!response.ok) return response;
  try {
    const url = new URL(request.url);
    const sessionId = clean(url.searchParams.get("session_id"), 180);
    if (sessionId) await accountFromSession(env, sessionId);
  } catch (error) {
    console.error("ALIGN login account capture", error);
  }
  return response;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/billing-preview" && request.method === "GET") {
      return billingPreviewPage(request);
    }

    if ((url.pathname === "/api/member-login" || url.pathname === "/api/member-billing") && request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(request.headers.get("origin") || "") });
    }

    if (url.pathname === "/api/member-login" && request.method === "POST") {
      try {
        return await handleLogin(request, env);
      } catch (error) {
        console.error("ALIGN member login", error);
        return json({ error: "No pudimos iniciar sesión." }, 500, request.headers.get("origin") || "");
      }
    }

    if (url.pathname === "/api/member-billing" && ["GET", "POST"].includes(request.method)) {
      try {
        return await handleBilling(request, env);
      } catch (error) {
        console.error("ALIGN member billing", error);
        const status = /sesión/i.test(error?.message || "") ? 401 : 400;
        return json({ error: error?.message || "No pudimos administrar tu mensualidad." }, status, request.headers.get("origin") || "");
      }
    }

    if (url.pathname === "/api/activate-membership" && request.method === "GET") {
      return captureActivation(request, env);
    }

    return memberActivityWorker.fetch(request, env);
  },
};
