const SPREADSHEET_ID = '1J9p3bN4-Wty1mFkMUS4E8bgJM4Fot33ecGedGdmt99o';
const SHEET_NAME = 'Registros';
const MAX_MEMBERS = 2500;
const VALIDITY_DAYS = 30;
const SITE_URL = 'https://edgartikis.github.io/align-community/heatmaster-jaibabrava/';

function doGet() {
  return jsonResponse({ ok: true, service: 'Heat Master x Jaiba Brava API' });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const data = JSON.parse((e.postData && e.postData.contents) || '{}');
    if (data.action === 'register') return registerMember(data);
    if (data.action === 'login') return loginMember(data);
    if (data.action === 'verify') return verifyMember(data);
    return jsonResponse({ ok: false, message: 'Acción no válida.' });
  } catch (error) {
    return jsonResponse({ ok: false, message: error.message || 'Error interno.' });
  } finally {
    lock.releaseLock();
  }
}

function registerMember(data) {
  const name = clean(data.fullName, 100);
  const phone = normalizePhone(data.phone);
  const email = clean(data.email, 120).toLowerCase();
  if (!name || phone.length !== 10 || !/^\S+@\S+\.\S+$/.test(email) || data.consent !== true) {
    return jsonResponse({ ok: false, message: 'Revisa nombre, celular, correo y consentimiento.' });
  }

  const sheet = getSheet();
  const lastRow = sheet.getLastRow();
  const registered = Math.max(0, lastRow - 1);
  if (registered >= MAX_MEMBERS) return jsonResponse({ ok: false, message: 'El cupo de 2,500 registros ya se completó.' });

  if (lastRow >= 2) {
    const existing = sheet.getRange(2, 3, registered, 3).getDisplayValues();
    const duplicate = existing.findIndex(row => normalizePhone(row[1]) === phone || String(row[2]).toLowerCase() === email);
    if (duplicate >= 0) return jsonResponse({ ok: false, message: 'Este celular o correo ya está registrado.' });
  }

  const memberNumber = `HM-JB-${String(registered + 1).padStart(4, '0')}`;
  const id = Utilities.getUuid();
  const token = Utilities.base64EncodeWebSafe(`${memberNumber}|${id}`).replace(/=+$/, '');
  const now = new Date();
  const expiry = new Date(now.getTime() + VALIDITY_DAYS * 86400000);
  const cardUrl = buildVerificationUrl(memberNumber, token);
  const rowData = [id, memberNumber, name, phone, email, now, expiry, 'ACTIVO', token, cardUrl, '', 0, 0, 0, 'SÍ', ''];

  sheet.appendRow(rowData);
  const row = sheet.getLastRow();
  sheet.getRange(row, 6, 1, 2).setNumberFormat('dd/mm/yyyy hh:mm');
  sheet.getRange(row, 13, 1, 2).setNumberFormat('$#,##0.00');
  return jsonResponse({ ok: true, member: buildMemberResponse(rowData, true) });
}

function loginMember(data) {
  const memberNumber = clean(data.memberNumber, 20).toUpperCase();
  const phone = normalizePhone(data.phone);
  if (!/^HM-JB-\d{4}$/.test(memberNumber) || phone.length !== 10) {
    return jsonResponse({ ok: false, message: 'Revisa tu número de socio y celular.' });
  }

  const found = findMember(memberNumber);
  if (!found || normalizePhone(found.row[3]) !== phone) {
    return jsonResponse({ ok: false, message: 'Número de socio o celular incorrectos.' });
  }
  refreshStatus(found);
  return jsonResponse({ ok: true, member: buildMemberResponse(found.row, true) });
}

function verifyMember(data) {
  const memberNumber = clean(data.memberNumber, 20).toUpperCase();
  const token = clean(data.token, 300);
  if (!/^HM-JB-\d{4}$/.test(memberNumber) || !token) {
    return jsonResponse({ ok: false, message: 'QR inválido.' });
  }

  const found = findMember(memberNumber);
  if (!found || String(found.row[8] || '') !== token) {
    return jsonResponse({ ok: false, message: 'Este QR no es válido.' });
  }
  refreshStatus(found);
  return jsonResponse({ ok: true, member: buildMemberResponse(found.row, false) });
}

function findMember(memberNumber) {
  const sheet = getSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const rows = sheet.getRange(2, 1, lastRow - 1, 16).getValues();
  const index = rows.findIndex(row => String(row[1]).trim().toUpperCase() === memberNumber);
  return index < 0 ? null : { sheet, row: rows[index], sheetRow: index + 2 };
}

function refreshStatus(found) {
  const expiry = found.row[6];
  if (expiry instanceof Date && expiry < new Date() && found.row[7] === 'ACTIVO') {
    found.row[7] = 'VENCIDO';
    found.sheet.getRange(found.sheetRow, 8).setValue('VENCIDO');
  }
}

function buildMemberResponse(row, includePrivateMetrics) {
  const expiry = row[6] instanceof Date ? row[6] : new Date(row[6]);
  const token = String(row[8] || '');
  const memberNumber = String(row[1] || '');
  const response = {
    fullName: String(row[2] || ''),
    memberNumber,
    status: String(row[7] || 'VENCIDO'),
    qrPayload: buildVerificationUrl(memberNumber, token),
    expiryISO: isNaN(expiry.getTime()) ? '' : expiry.toISOString(),
    expiryDisplay: isNaN(expiry.getTime()) ? '--/--/----' : Utilities.formatDate(expiry, 'America/Monterrey', 'dd/MM/yyyy')
  };
  if (includePrivateMetrics) {
    response.visits = Number(row[11] || 0);
    response.consumption = Number(row[12] || 0);
    response.savings = Number(row[13] || 0);
  }
  return response;
}

function buildVerificationUrl(memberNumber, token) {
  return `${SITE_URL}?verify=${encodeURIComponent(memberNumber)}&token=${encodeURIComponent(token)}`;
}

function getSheet() {
  return SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
}

function updateExpiredMembers() {
  const sheet = getSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const range = sheet.getRange(2, 7, lastRow - 1, 2);
  const rows = range.getValues();
  const now = new Date();
  rows.forEach(row => {
    if (row[0] instanceof Date && row[0] < now && row[1] === 'ACTIVO') row[1] = 'VENCIDO';
  });
  range.setValues(rows);
}

function createDailyExpiryTrigger() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'updateExpiredMembers').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('updateExpiredMembers').timeBased().everyDays(1).atHour(1).create();
}

function normalizePhone(value) { return String(value || '').replace(/\D/g, '').slice(-10); }
function clean(value, max) { return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max); }
function jsonResponse(data) { return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON); }
