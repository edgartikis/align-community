/**
 * Optional, fail-closed account erasure adapter for the existing ALIGN
 * reporting Google Apps Script. PREVIEW QA ONLY until the production workflow
 * has been accepted. Never export or log the shared secret.
 *
 * The Apps Script endpoint must implement:
 * POST {mode:"ALIGN_PROD_2026", secret, action:"anonymize_account",
 *       username, stripeCustomerId}
 * -> {ok:true, anonymized:true, counts:{socios,afiliados,visitas,pagos}}
 */
const QA_ACTION = "anonymize_account";
const MODE = "ALIGN_PROD_2026";

export async function eraseAccountReporting(env, {username,customerId}, fetcher=fetch) {
  if (env.MEMBER_ACCOUNT_DELETION_REPORTING_ENABLED !== "true") {
    // Production will be blocked by the deletion handler until this is ready.
    return {skipped:true};
  }
  if (env.STRIPE_MODE !== "test") {
    throw new Error("El reporte externo aún no está autorizado fuera de Preview.");
  }
  const rawUrl=String(env.MEMBER_ACCOUNT_DELETION_REPORTING_URL||"").trim();
  const secret=String(env.MEMBER_ACCOUNT_DELETION_REPORTING_SECRET||"").trim();
  if (!secret || !rawUrl) throw new Error("La conexión de anonimización de reportes no está configurada.");
  let url;
  try {url=new URL(rawUrl);} catch {throw new Error("La URL de anonimización no es válida.");}
  if (url.protocol!=="https:" || url.hostname!=="script.google.com" ||
      !/^\/macros\/s\/[^/]+\/exec$/.test(url.pathname) ||
      url.username || url.password || url.search || url.hash) {
    throw new Error("La URL del conector no pertenece a Google Apps Script publicado.");
  }
  if(!/^[a-z0-9._-]{4,24}$/.test(username) || !/^cus_[A-Za-z0-9]+$/.test(customerId)){
    throw new Error("La identidad del socio no es válida para anonimización.");
  }

  // A single request; duplicate deliveries must be idempotent on the Script.
  // Google Apps Script web apps sometimes redirect on successful execution.
  const res=await fetcher(url.toString(),{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({
      mode:MODE,secret,action:QA_ACTION,username,stripeCustomerId:customerId,
    }),
    redirect:"follow",
    signal:AbortSignal.timeout(20000),
  });
  if(!res.ok) throw new Error("El servicio de reportes no respondió correctamente.");
  const data=await res.json().catch(()=>null);
  if(data?.ok!==true || data?.anonymized!==true ||
     !data.counts || !["socios","afiliados","visitas","pagos"].every(
       k=>Number.isSafeInteger(data.counts[k])&&data.counts[k]>=0)) {
    throw new Error("El servicio de reportes no confirmó la anonimización.");
  }
  return {ok:true,counts:data.counts};
}
