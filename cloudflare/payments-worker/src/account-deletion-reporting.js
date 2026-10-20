/**
 * Fail-closed Google Apps Script adapter for account deletion.
 * Preview uses separate QA credentials. Live uses a distinct Google Apps Script
 * deployment URL and secret, behind independent explicit live gates.
 * No secrets or personal data are logged. Never call this from a browser.
 */
const MODE = "ALIGN_PROD_2026";
const VALID_USER = /^[a-z0-9._-]{4,24}$/;
const VALID_CUSTOMER = /^cus_[A-Za-z0-9]+$/;

function destination(env) {
  if (env.MEMBER_ACCOUNT_DELETION_REPORTING_ENABLED !== "true") {
    throw new Error("La anonimización externa es obligatoria antes de eliminar una cuenta.");
  }
  let rawUrl, secret;
  if (env.STRIPE_MODE === "test") {
    rawUrl = env.MEMBER_ACCOUNT_DELETION_REPORTING_URL;
    secret = env.MEMBER_ACCOUNT_DELETION_REPORTING_SECRET;
  } else if (env.STRIPE_MODE === "live" &&
      env.MEMBER_ACCOUNT_DELETION_ENABLED === "true" &&
      env.MEMBER_ACCOUNT_DELETION_LIVE_ENABLED === "true" &&
      env.MEMBER_ACCOUNT_DELETION_LIVE_QA_ENABLED === "true" &&
      env.MEMBER_LOGIN_GUARD !== "true" &&
      env.MEMBER_ACCOUNT_DELETION_FOUNDER_ENABLED !== "true") {
    // Separate deployment URL: never replace the billing/reporting web app.
    rawUrl = env.MEMBER_ACCOUNT_DELETION_LIVE_URL;
    secret = env.MEMBER_ACCOUNT_DELETION_LIVE_SECRET;
    if (!rawUrl || !env.ALIGN_DB_URL || String(rawUrl).trim() === String(env.ALIGN_DB_URL).trim()) {
      throw new Error("La URL de eliminación debe ser independiente de la de pagos.");
    }
    if (String(secret || "").length < 32 ||
        String(secret) === String(env.ALIGN_DB_SECRET || "")) {
      throw new Error("Falta una credencial independiente para eliminación de cuentas.");
    }
  } else {
    throw new Error("La conexión de reportes Live no está autorizada.");
  }
  if (!rawUrl || !secret) {
    throw new Error("La conexión de anonimización de reportes no está configurada.");
  }
  let url;
  try {url = new URL(String(rawUrl).trim());}
  catch {throw new Error("La URL de anonimización no es válida.");}
  if (url.protocol !== "https:" || url.hostname !== "script.google.com" ||
      !/^\/macros\/s\/[^/]+\/exec$/.test(url.pathname) ||
      url.username || url.password || url.search || url.hash) {
    throw new Error("La URL del conector no pertenece a Google Apps Script publicado.");
  }
  return { url: url.toString(), secret: String(secret) };
}

async function report(env, {username,customerId}, action, fetcher) {
  if (!VALID_USER.test(username) || !VALID_CUSTOMER.test(customerId)) {
    throw new Error("La identidad del socio no es válida para anonimización.");
  }
  const {url,secret} = destination(env);
  const response = await fetcher(url,{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({mode:MODE,secret,action,username,stripeCustomerId:customerId}),
    redirect:"follow",
    signal:AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error("El servicio de reportes no respondió correctamente.");
  const result = await response.json().catch(()=>null);
  if (result?.ok !== true) throw new Error("El servicio de reportes no confirmó la operación.");
  return result;
}

/**
 * Read-only identity & capability check BEFORE Stripe cancellation.
 * Required in Live. The Apps Script production deployment must explicitly
 * implement 'preflight_account_erasure'; no optimistic fallback.
 */
export async function checkAccountReporting(env, identity, fetcher=fetch) {
  if (env.STRIPE_MODE !== "live") {
    throw new Error("La verificación previa solo corresponde a producción.");
  }
  const result = await report(env, identity, "preflight_account_erasure", fetcher);
  if (result.eligible !== true || result.capability !== "account-erasure-v1") {
    throw new Error("El servicio de reportes no verificó la cuenta ni la funcionalidad.");
  }
  return {eligible:true};
}

export async function eraseAccountReporting(env, identity, fetcher=fetch) {
  const result = await report(env, identity, "anonymize_account", fetcher);
  if (result.anonymized !== true || !result.counts ||
      !["socios","afiliados","visitas","pagos"].every(k =>
        Number.isSafeInteger(result.counts[k]) && result.counts[k] >= 0)) {
    throw new Error("El servicio de reportes no confirmó la anonimización.");
  }
  return {ok:true,counts:result.counts};
}
