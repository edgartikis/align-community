/**
 * ALIGN · conector de base de datos de PRUEBAS
 * Hoja independiente: ALIGN · Base de Pruebas + Dashboard
 * No almacena contraseñas, hashes ni datos bancarios.
 */
const SPREADSHEET_ID = '1tk5XrObvkVXe8g69IE-lWf52SDFy1PZZnxrNuWQ-nUI';
const TEST_SOURCE = 'GitHub Pages demo';

function doGet() {
  return json_({ ok: true, service: 'ALIGN test database', mode: 'PRUEBAS' });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.mode !== 'ALIGN_TEST_2026') throw new Error('Solicitud de prueba no válida.');
    if (body.action === 'register_payment') return json_(registerPayment_(body));
    if (body.action === 'register_visit') return json_(registerVisit_(body));
    throw new Error('Acción no reconocida.');
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function registerPayment_(body) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const socios = ss.getSheetByName('SOCIOS');
  const afiliados = ss.getSheetByName('AFILIADOS');
  const pagos = ss.getSheetByName('PAGOS');
  const username = clean_(body.username, 24).toLowerCase();
  const socioId = clean_(body.socioId, 40);
  const planName = clean_(body.planName, 40);
  const members = Array.isArray(body.members) ? body.members.slice(0, 12) : [];
  if (!socioId || !username || !planName || !members.length) throw new Error('Registro incompleto.');
  if (findRow_(socios, 1, socioId) || findRow_(socios, 2, username)) {
    return { ok: true, duplicate: true, socioId: socioId };
  }

  const now = new Date();
  const memberRow = socios.getLastRow() + 1;
  socios.getRange(memberRow, 1, 1, 15).setValues([[
    socioId,
    username,
    clean_(members[0].name, 80),
    planName,
    'Activo',
    now,
    members.length,
    '', '', '', '', '', '', '',
    TEST_SOURCE
  ]]);
  socios.getRange(memberRow, 8, 1, 7).setFormulas([[
    '=SUMIF(PAGOS!$C$5:$C$2000,A' + memberRow + ',PAGOS!$F$5:$F$2000)',
    '=SUMIF(VISITAS!$C$5:$C$5000,A' + memberRow + ',VISITAS!$L$5:$L$5000)',
    '=H' + memberRow + '+I' + memberRow,
    '=SUMIF(VISITAS!$C$5:$C$5000,A' + memberRow + ',VISITAS!$M$5:$M$5000)',
    '=COUNTIF(VISITAS!$C$5:$C$5000,A' + memberRow + ')',
    '=SUMIF(VISITAS!$C$5:$C$5000,A' + memberRow + ',VISITAS!$K$5:$K$5000)',
    '=IFERROR(MAXIFS(VISITAS!$B$5:$B$5000,VISITAS!$C$5:$C$5000,A' + memberRow + '),"")'
  ]]);

  members.forEach(function(person, index) {
    afiliados.appendRow([
      clean_(person.integranteId || socioId + '-P' + (index + 1), 50),
      socioId,
      username,
      clean_(person.name, 80),
      index === 0 ? 'Titular' : 'Afiliado ' + (index + 1),
      clean_(person.memberCode, 40),
      'Activo',
      clean_(person.email, 120),
      clean_(person.phone, 30)
    ]);
  });

  pagos.appendRow([
    clean_(body.paymentId || 'PAY-' + Date.now(), 50),
    now,
    socioId,
    username,
    planName,
    number_(body.amount),
    'MXN',
    'Pagado',
    TEST_SOURCE,
    clean_(body.reference || 'DEMO-' + Date.now(), 80)
  ]);
  return { ok: true, socioId: socioId, members: members.length };
}

function registerVisit_(body) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const visitas = ss.getSheetByName('VISITAS');
  const socioId = clean_(body.socioId, 50);
  const visitId = clean_(body.visitId || 'VIS-' + Date.now(), 50);
  if (!socioId || !clean_(body.place, 100)) throw new Error('Visita incompleta.');
  if (findRow_(visitas, 1, visitId)) return { ok: true, duplicate: true, visitId: visitId };
  visitas.appendRow([
    visitId,
    new Date(),
    socioId,
    clean_(body.integranteId, 50),
    clean_(body.username, 24).toLowerCase(),
    clean_(body.visitorName, 80),
    clean_(body.planName, 40),
    clean_(body.allyId, 30),
    clean_(body.place, 100),
    clean_(body.category, 80),
    Math.max(1, Math.min(50, Math.round(number_(body.people) || 1))),
    Math.max(0, number_(body.spent)),
    Math.max(0, number_(body.saved)),
    clean_(body.benefit, 160),
    TEST_SOURCE,
    clean_(body.notes, 200)
  ]);
  refreshAllies_(ss);
  return { ok: true, visitId: visitId };
}

function refreshAllies_(ss) {
  const visitas = ss.getSheetByName('VISITAS');
  const aliados = ss.getSheetByName('ALIADOS');
  const raw = visitas.getLastRow() >= 5
    ? visitas.getRange(5, 1, visitas.getLastRow() - 4, 16).getValues()
    : [];
  const summary = {};
  raw.forEach(function(row) {
    const place = String(row[8] || '').trim();
    if (!place) return;
    if (!summary[place]) summary[place] = { visits: 0, people: 0, spent: 0, saved: 0, last: null, names: [] };
    const s = summary[place];
    s.visits += 1;
    s.people += number_(row[10]);
    s.spent += number_(row[11]);
    s.saved += number_(row[12]);
    if (row[1] instanceof Date && (!s.last || row[1] > s.last)) s.last = row[1];
    const name = String(row[5] || '').trim();
    if (name && s.names.indexOf(name) < 0) s.names.push(name);
  });
  if (aliados.getLastRow() < 5) return;
  const places = aliados.getRange(5, 2, aliados.getLastRow() - 4, 1).getValues();
  const output = places.map(function(row) {
    const s = summary[String(row[0] || '').trim()] || { visits: 0, people: 0, spent: 0, saved: 0, last: '', names: [] };
    return [s.visits, s.people, s.spent, s.saved, s.last || '', s.names.join(', ') || 'Sin visitas'];
  });
  aliados.getRange(5, 5, output.length, 6).setValues(output);
}

function findRow_(sheet, column, value) {
  const last = sheet.getLastRow();
  if (last < 5 || !value) return 0;
  const hit = sheet.getRange(5, column, last - 4, 1).createTextFinder(String(value)).matchEntireCell(true).findNext();
  return hit ? hit.getRow() : 0;
}

function clean_(value, max) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max || 200);
}

function number_(value) {
  const n = Number(value);
  return isFinite(n) ? n : 0;
}

function json_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}
