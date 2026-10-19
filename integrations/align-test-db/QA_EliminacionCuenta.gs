/**
 * ALIGN — QA aislado de eliminación de datos.
 * Datos enteramente ficticios. NO DESPLEGAR como servicio web.
 * Vincular solamente con la hoja ficticia indicada a continuación.
 * No contiene doPost ni claves privadas ni acceso a Stripe/Cloudflare.
 * La función anonymizeAccount_ es copia literal de la rutina en Code.gs
 * del conector de reportes, para probar su comportamiento real.
 */
const QA_SHEET_ID = "1SGcKQHHlmC3O1eM0PnWO_XQiKm_QDrNKTeBLiiYE2P8";
const DATA_START_ROW = 5;
const VISIT_SOURCE = "Cloudflare Worker";

function spreadsheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss || ss.getId() !== QA_SHEET_ID) {
    throw new Error("BLOQUEADO: este código solo puede usarse con la hoja QA ficticia de ALIGN.");
  }
  return ss;
}

function inspeccionarCuentaQA() {
  const ss = spreadsheet_();
  const names = ["SOCIOS", "AFILIADOS", "PAGOS", "VISITAS", "ALIADOS"];
  for (const n of names) if (!ss.getSheetByName(n)) throw new Error("Falta pestaña " + n);
  const rows = n => {
    const s=ss.getSheetByName(n), len=Math.max(0,s.getLastRow()-4);
    return len ? s.getRange(5,1,len,n==="SOCIOS"?22:n==="AFILIADOS"?10:n==="PAGOS"?12:16).getValues()
      .filter(r=>r.some(v=>String(v).trim())) : [];
  };
  const cols = [["SOCIOS",1],["AFILIADOS",2],["PAGOS",3],["VISITAS",4]];
  for (const [n,col] of cols) {
    const list=rows(n);
    if (list.length!==2) throw new Error(n + ": esperaba exactamente dos registros ficticios; hay "+list.length);
    const usernames=list.map(r=>String(r[col]||"").toLowerCase()).sort();
    if (usernames.join("|")!=="qa.delete.fixture2|qa.other.member")
      throw new Error(n+": hay registros no esperados; abortar.");
  }
  const own=rows("SOCIOS").find(r=>r[1]==="qa.delete.fixture2");
  if (String(own[17])!=="cus_fakeqa1")
    throw new Error("El identificador del socio ficticio es diferente; abortar.");
  console.log("QA AISLADA VALIDADA: dos socios ficticios, sin registros reales.");
  console.log("Inspección de solo lectura. No se borró ningún dato.");
  return true;
}

function ejecutarEliminacionQA() {
  // Bloqueo rígido antes de cualquier escritura en Google Sheets.
  inspeccionarCuentaQA();
  const outcome=anonymizeAccount_({
    username:"qa.delete.fixture2",
    stripeCustomerId:"cus_fakeqa1"
  });
  const ss=spreadsheet_();
  const rows=(tab,cols)=>{
    const sh=ss.getSheetByName(tab), len=Math.max(0,sh.getLastRow()-4);
    return len?sh.getRange(5,1,len,cols).getValues():[];
  };
  if(rows("SOCIOS",22).some(r=>r[1]==="qa.delete.fixture2"))throw Error("No se eliminó la cuenta QA.");
  if(!rows("SOCIOS",22).some(r=>r[1]==="qa.other.member"))throw Error("Cuenta de control alterada.");
  if(rows("AFILIADOS",10).some(r=>r[7]==="qa-a@example.invalid"))throw Error("El correo QA persiste.");
  if(!rows("AFILIADOS",10).some(r=>r[7]==="qa-b@example.invalid"))throw Error("Se alteró el control.");
  if(rows("VISITAS",16).some(r=>r[4]==="qa.delete.fixture2"))throw Error("La visita QA conserva usuario.");
  if(!rows("VISITAS",16).some(r=>r[4]==="qa.other.member"))throw Error("Se alteró la visita de control.");
  console.log("QA FINALIZADA. Resultado: "+JSON.stringify(outcome));
  console.log("No se modificó ninguna cuenta real ni se hizo un despliegue.");
  return outcome;
}

// Inicio de funciones originales reutilizadas del conector de reportes.


function sheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  sheet.getRange(4, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(4, 1, 1, headers.length).setFontWeight('bold');
  return sheet;
}

function sheets_() {
  const ss = spreadsheet_();
  return {
    ss: ss,
    socios: sheet_(ss, 'SOCIOS', [
      'Socio ID','Usuario','Titular','Plan','Estado','Alta','Integrantes','Pagos acumulados','Gasto aliados','Valor total','Ahorro','Visitas','Personas','Última visita','Notas','Fuente','Password hash','Stripe Customer','Stripe Subscription','Último pago','Estado Stripe','Tarifa'
    ]),
    afiliados: sheet_(ss, 'AFILIADOS', [
      'Integrante ID','Socio ID','Usuario','Nombre','Rol','Código','Estado','Email','Teléfono','Token'
    ]),
    pagos: sheet_(ss, 'PAGOS', [
      'Pago ID','Fecha','Socio ID','Usuario','Plan','Importe','Moneda','Estado','Fuente','Referencia','Stripe Customer','Stripe Subscription'
    ]),
    visitas: sheet_(ss, 'VISITAS', [
      'Visita ID','Fecha','Socio ID','Integrante ID','Usuario','Nombre','Plan','Aliado ID','Aliado','Categoría','Personas','Gasto real','Ahorro','Beneficio','Fuente','Notas'
    ]),
    aliados: sheet_(ss, 'ALIADOS', [
      'Aliado ID','Aliado','Categoría','Planes','Visitas','Personas','Gasto generado','Ahorro generado','Última visita','Miembros únicos'
    ])
  };
}

function anonymizeAccount_(body) {
  const username = clean_(body.username, 24).toLowerCase();
  if (!/^[a-z0-9._-]{4,24}$/.test(username)) {
    throw new Error('Cuenta no válida para anonimización.');
  }
  const expectedCustomer = clean_(body.stripeCustomerId, 100);
  if (expectedCustomer && !/^cus_[A-Za-z0-9]+$/.test(expectedCustomer)) {
    throw new Error('Stripe Customer no válido.');
  }
  const db = sheets_();
  const socioIds = {};
  const counts = { socios: 0, afiliados: 0, visitas: 0, pagos: 0 };

  function rows_(sheet, width) {
    const count = Math.max(0, sheet.getLastRow() - DATA_START_ROW + 1);
    return count ? sheet.getRange(DATA_START_ROW, 1, count, width).getValues() : [];
  }

  // Match the account username AND, when supplied, its Stripe customer. A
  // mismatch fails CLOSED and does not anonymize a similarly named account.
  const socios = rows_(db.socios, 22);
  for (let i = 0; i < socios.length; i += 1) {
    const row = socios[i];
    if (clean_(row[1], 24).toLowerCase() !== username) continue;
    if (expectedCustomer && clean_(row[17], 100) !== expectedCustomer) {
      throw new Error('La identidad de Stripe no coincide con el socio.');
    }
    if (row[0]) socioIds[clean_(row[0], 80)] = true;
  }

  // Discover linked group records from the secondary affiliate table. This is
  // needed for legacy accounts whose SOCIOS row was already removed.
  const affiliates = rows_(db.afiliados, 10);
  for (let i = 0; i < affiliates.length; i += 1) {
    const row = affiliates[i];
    if (clean_(row[2], 24).toLowerCase() === username && row[1]) {
      socioIds[clean_(row[1], 80)] = true;
    }
  }

  // Preflight complete before any mutation: reject conflicting Stripe owner ID.
  // Payment rows may be preserved for statutory accounting obligations.
  for (let i = 0; i < socios.length; i += 1) {
    if (clean_(socios[i][1], 24).toLowerCase() === username) {
      db.socios.getRange(DATA_START_ROW + i, 1, 1, 22).clearContent();
      counts.socios++;
    }
  }
  for (let i = 0; i < affiliates.length; i += 1) {
    const row = affiliates[i];
    if (clean_(row[2], 24).toLowerCase() === username ||
        socioIds[clean_(row[1], 80)]) {
      db.afiliados.getRange(DATA_START_ROW + i, 1, 1, 10).clearContent();
      counts.afiliados++;
    }
  }
  const visits = rows_(db.visitas, 16);
  for (let i = 0; i < visits.length; i += 1) {
    const row = visits[i];
    if (clean_(row[4], 24).toLowerCase() !== username &&
        !socioIds[clean_(row[2], 80)]) continue;
    const n = DATA_START_ROW + i;
    // Keep date, ally, people, amounts and discounts for anonymized reporting.
    db.visitas.getRange(n, 3, 1, 4).setValues([['', '', '', 'Cuenta eliminada']]);
    db.visitas.getRange(n, 16).clearContent(); // Free-text notes can contain PII
    counts.visitas++;
  }
  const payments = rows_(db.pagos, 12);
  for (let i = 0; i < payments.length; i += 1) {
    const row = payments[i];
    if (clean_(row[3], 24).toLowerCase() !== username &&
        !socioIds[clean_(row[2], 80)]) continue;
    db.pagos.getRange(DATA_START_ROW + i, 3, 1, 2).clearContent();
    counts.pagos++;
  }
  refreshAllies_(db);
  return { ok: true, anonymized: true, counts: counts };
}

function refreshAllies_(db) {
  const last = db.visitas.getLastRow();
  const rows = last >= DATA_START_ROW ? db.visitas.getRange(DATA_START_ROW, 1, last - DATA_START_ROW + 1, 16).getValues() : [];
  const summary = {};
  rows.forEach(function(row) {
    const allyId = clean_(row[7], 30);
    if (!allyId) return;
    if (!summary[allyId]) summary[allyId] = { name: clean_(row[8], 100), category: clean_(row[9], 80), visits: 0, people: 0, spent: 0, saved: 0, last: '', members: [] };
    const s = summary[allyId];
    s.visits += 1;
    s.people += number_(row[10]);
    s.spent += number_(row[11]);
    s.saved += number_(row[12]);
    if (row[1] instanceof Date && (!s.last || row[1] > s.last)) s.last = row[1];
    const member = clean_(row[5], 100);
    if (member && s.members.indexOf(member) < 0) s.members.push(member);
  });

  Object.keys(summary).forEach(function(allyId) {
    const s = summary[allyId];
    let row = findRow_(db.aliados, 1, allyId);
    if (!row) row = Math.max(DATA_START_ROW, db.aliados.getLastRow() + 1);
    const existingPlans = clean_(db.aliados.getRange(row, 4).getValue(), 200);
    db.aliados.getRange(row, 1, 1, 10).setValues([[
      allyId, s.name, s.category, existingPlans, s.visits, s.people, s.spent, s.saved, s.last || '', s.members.join(', ')
    ]]);
  });
}

function findRow_(sheet, column, value) {
  const target = clean_(value, 160);
  const last = sheet.getLastRow();
  if (!target || last < DATA_START_ROW) return 0;
  const hit = sheet.getRange(DATA_START_ROW, column, last - DATA_START_ROW + 1, 1).createTextFinder(target).matchEntireCell(true).findNext();
  return hit ? hit.getRow() : 0;
}

function clean_(value, max) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max || 200);
}

function number_(value) {
  const n = Number(value);
  return isFinite(n) ? n : 0;
}
