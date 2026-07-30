const SPREADSHEET_ID = '1J9p3bN4-Wty1mFkMUS4E8bgJM4Fot33ecGedGdmt99o';
const SHEET_NAME = 'Registros';
const MAX_MEMBERS = 2500;
const VALIDITY_DAYS = 30;

function doGet() {
  return jsonResponse({ ok: true, service: 'Heat Master x Jaiba Brava API' });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const data = JSON.parse(e.postData.contents || '{}');
    if (data.action !== 'register') return jsonResponse({ ok:false, message:'Acción no válida.' });
    return registerMember(data);
  } catch (error) {
    return jsonResponse({ ok:false, message:error.message || 'Error interno.' });
  } finally {
    lock.releaseLock();
  }
}

function registerMember(data) {
  const name = clean(data.fullName, 100);
  const phone = String(data.phone || '').replace(/\D/g, '').slice(-10);
  const email = clean(data.email, 120).toLowerCase();
  if (!name || phone.length !== 10 || !/^\S+@\S+\.\S+$/.test(email) || data.consent !== true) {
    return jsonResponse({ ok:false, message:'Revisa nombre, celular, correo y consentimiento.' });
  }
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  const lastRow = sheet.getLastRow();
  const registered = Math.max(0, lastRow - 1);
  if (registered >= MAX_MEMBERS) return jsonResponse({ ok:false, message:'El cupo de 2,500 registros ya se completó.' });

  if (lastRow >= 2) {
    const existing = sheet.getRange(2, 3, registered, 3).getDisplayValues();
    const duplicate = existing.findIndex(row => row[1].replace(/\D/g,'').slice(-10) === phone || row[2].toLowerCase() === email);
    if (duplicate >= 0) return jsonResponse({ ok:false, message:'Este celular o correo ya está registrado.' });
  }

  const sequence = registered + 1;
  const memberNumber = `HM-JB-${String(sequence).padStart(4,'0')}`;
  const id = Utilities.getUuid();
  const token = Utilities.base64EncodeWebSafe(`${memberNumber}|${id}`).replace(/=+$/,'');
  const now = new Date();
  const expiry = new Date(now.getTime() + VALIDITY_DAYS * 24 * 60 * 60 * 1000);
  const qrPayload = `HMJB:${memberNumber}:${token}`;
  const cardUrl = `https://edgartikis.github.io/align-community/heatmaster-jaibabrava/?member=${encodeURIComponent(memberNumber)}`;

  sheet.appendRow([
    id, memberNumber, name, phone, email, now, expiry, 'ACTIVO', token, cardUrl,
    '', 0, 0, 0, 'SÍ', ''
  ]);
  const row = sheet.getLastRow();
  sheet.getRange(row, 6, 1, 2).setNumberFormat('dd/mm/yyyy hh:mm');
  sheet.getRange(row, 13, 1, 2).setNumberFormat('$#,##0.00');

  return jsonResponse({
    ok:true,
    member:{
      fullName:name,
      memberNumber,
      qrPayload,
      expiryISO:expiry.toISOString(),
      expiryDisplay:Utilities.formatDate(expiry, 'America/Monterrey', 'dd/MM/yyyy')
    }
  });
}

function updateExpiredMembers() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const range = sheet.getRange(2, 7, lastRow - 1, 2);
  const rows = range.getValues();
  const now = new Date();
  rows.forEach(row => {
    const expiry = row[0];
    if (expiry instanceof Date && expiry < now && row[1] === 'ACTIVO') row[1] = 'VENCIDO';
  });
  range.setValues(rows);
}

function createDailyExpiryTrigger() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'updateExpiredMembers').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('updateExpiredMembers').timeBased().everyDays(1).atHour(1).create();
}

function clean(value, max) {
  return String(value || '').trim().replace(/\s+/g,' ').slice(0,max);
}
function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
