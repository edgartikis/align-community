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
    const data = JSON.parse((e.postData && e.postData.contents) || '{}');

    if (data.action === 'register') return registerMember(data);
    if (data.action === 'login') return loginMember(data);

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

  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  const lastRow = sheet.getLastRow();
  const registered = Math.max(0, lastRow - 1);

  if (registered >= MAX_MEMBERS) {
    return jsonResponse({ ok: false, message: 'El cupo de 2,500 registros ya se completó.' });
  }

  if (lastRow >= 2) {
    const existing = sheet.getRange(2, 3, registered, 3).getDisplayValues();
    const duplicate = existing.findIndex(row =>
      normalizePhone(row[1]) === phone || String(row[2]).toLowerCase() === email
    );

    if (duplicate >= 0) {
      return jsonResponse({ ok: false, message: 'Este celular o correo ya está registrado.' });
    }
  }

  const sequence = registered + 1;
  const memberNumber = `HM-JB-${String(sequence).padStart(4, '0')}`;
  const id = Utilities.getUuid();
  const token = Utilities.base64EncodeWebSafe(`${memberNumber}|${id}`).replace(/=+$/, '');
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
    ok: true,
    member: buildMemberResponse([
      id, memberNumber, name, phone, email, now, expiry, 'ACTIVO', token, cardUrl,
      '', 0, 0, 0, 'SÍ', ''
    ])
  });
}

function loginMember(data) {
  const memberNumber = clean(data.memberNumber, 20).toUpperCase();
  const phone = normalizePhone(data.phone);

  if (!/^HM-JB-\d{4}$/.test(memberNumber) || phone.length !== 10) {
    return jsonResponse({ ok: false, message: 'Revisa tu número de socio y celular.' });
  }

  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return jsonResponse({ ok: false, message: 'No encontramos ese socio.' });
  }

  const rows = sheet.getRange(2, 1, lastRow - 1, 16).getValues();
  const match = rows.find(row =>
    String(row[1]).trim().toUpperCase() === memberNumber &&
    normalizePhone(row[3]) === phone
  );

  if (!match) {
    return jsonResponse({ ok: false, message: 'Número de socio o celular incorrectos.' });
  }

  const expiry = match[6];
  if (expiry instanceof Date && expiry < new Date() && match[7] === 'ACTIVO') {
    match[7] = 'VENCIDO';
    const sheetRow = rows.indexOf(match) + 2;
    sheet.getRange(sheetRow, 8).setValue('VENCIDO');
  }

  return jsonResponse({ ok: true, member: buildMemberResponse(match) });
}

function buildMemberResponse(row) {
  const expiry = row[6] instanceof Date ? row[6] : new Date(row[6]);
  const token = String(row[8] || '');
  const memberNumber = String(row[1] || '');

  return {
    fullName: String(row[2] || ''),
    memberNumber,
    phone: normalizePhone(row[3]),
    status: String(row[7] || 'VENCIDO'),
    qrPayload: `HMJB:${memberNumber}:${token}`,
    expiryISO: isNaN(expiry.getTime()) ? '' : expiry.toISOString(),
    expiryDisplay: isNaN(expiry.getTime())
      ? '--/--/----'
      : Utilities.formatDate(expiry, 'America/Monterrey', 'dd/MM/yyyy'),
    visits: Number(row[11] || 0),
    consumption: Number(row[12] || 0),
    savings: Number(row[13] || 0)
  };
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
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === 'updateExpiredMembers')
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));

  ScriptApp.newTrigger('updateExpiredMembers').timeBased().everyDays(1).atHour(1).create();
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '').slice(-10);
}

function clean(value, max) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
