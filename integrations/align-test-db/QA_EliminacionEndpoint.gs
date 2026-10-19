/**
 * ALIGN QA ONLY — inbound HTTP adapter for testing Cloudflare Preview ->
 * Google Apps Script -> synthetic QA spreadsheet.
 *
 * Add as a SECOND .gs file to the isolated Apps Script project.
 * Script Property required: ALIGN_QA_DELETE_SECRET (do not store in source).
 * NEVER copy this to the real reporting Apps Script / business spreadsheet.
 *
 * Fail closed on spreadsheet ID, actor, Stripe customer, secret and action.
 * Only fake records may be anonymized. All financial amounts are synthetic.
 */
function doPost(e) {
  function respond(data) {
    return ContentService.createTextOutput(JSON.stringify(data))
      .setMimeType(ContentService.MimeType.JSON);
  }
  try {
    const raw=String(e && e.postData && e.postData.contents || "");
    if (!raw || raw.length>4096) throw new Error("Solicitud inválida.");
    const payload=JSON.parse(raw);
    const secret=PropertiesService.getScriptProperties().getProperty("ALIGN_QA_DELETE_SECRET");
    if (!secret || String(payload.secret||"")!==secret ||
        payload.mode!=="ALIGN_PROD_2026" ||
        payload.action!=="anonymize_account") {
      throw new Error("Solicitud QA no autorizada.");
    }
    if (payload.username!=="qa.delete.fixture2" ||
        payload.stripeCustomerId!=="cus_fakeqa1") {
      throw new Error("Solo puede anonimizarse la cuenta ficticia QA autorizada.");
    }
    // spreadsheet_ validates the exact synthetic spreadsheet identifier.
    const db=spreadsheet_();
    const otherUser="qa.other.member";
    const otherAccount=db.getSheetByName("SOCIOS").getRange(6,2).getValue();
    if (otherAccount!==otherUser) throw new Error("La cuenta QA de control cambió.");
    const result=anonymizeAccount_(payload);
    if (!result || result.ok!==true || result.anonymized!==true) {
      throw new Error("La anonimización no pudo confirmarse.");
    }
    if (db.getSheetByName("SOCIOS").getRange(6,2).getValue()!==otherUser) {
      throw new Error("No se puede garantizar la integridad del socio QA de control.");
    }
    return respond(result);
  } catch(err) {
    // Never echo the provided secret, account info or raw HTTP body.
    console.error("ALIGN QA endpoint rejected request:", err && err.name || "Error");
    return respond({ok:false,error:"La petición de prueba fue rechazada."});
  }
}