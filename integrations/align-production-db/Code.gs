/**
 * ALIGN · conector de producción para membresías y pagos.
 *
 * Script Properties requeridas:
 * - SPREADSHEET_ID
 * - ALIGN_DB_SECRET
 *
 * El secreto nunca se escribe en el frontend ni en GitHub.
 */
const MODE = 'ALIGN_PROD_2026';
const DATA_START_ROW = 5;

function doGet() {
  return json_({ ok: true, service: 'ALIGN production database' });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const props = PropertiesService.getScriptProperties();
    const expected = String(props.getProperty('ALIGN_DB_SECRET') || '');
    if (body.mode !== MODE || !expected || String(body.secret || '') !== expected) {
      throw new Error('Solicitud no autorizada.');
    }

    if (body.action === 'register_payment') return json_(registerPayment_(body));
    if (body.action === 'subscription_renewed') return json_(subscriptionRenewed_(body));
    if (body.action === 'subscription_payment_failed') return json_(subscriptionPaymentFailed_(body));
    if (body.action === 'subscription_status') return json_(subscriptionStatus_(body));
    throw new Error('Acción no reconocida.');
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function spreadsheet_() {
  const id = String(PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '');
  if (!id) throw new Error('Falta SPREADSHEET_ID en Script Properties.');
  return SpreadsheetApp.openById(id);
}

function sheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() < 4) {
    sheet.getRange(4, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(4, 1, 1, headers.length).setFontWeight('bold');
  }
  return sheet;
}

function sheets_() {
  const ss = spreadsheet_();
  return {
    ss: ss,
    socios: sheet_(ss, 'SOCIOS', [
      'Socio ID','Usuario','Titular','Plan','Estado','Alta','Integrantes','Pagos acumulados','Gasto aliados','Valor total','Visitas','Personas','Última visita','Notas','Fuente','Password hash','Stripe Customer','Stripe Subscription','Último pago','Estado Stripe','Tarifa'
    ]),
    afiliados: sheet_(ss, 'AFILIADOS', [
      'Integrante ID','Socio ID','Usuario','Nombre','Rol','Código','Estado','Email','Teléfono','Token'
    ]),
    pagos: sheet_(ss, 'PAGOS', [
      'Pago ID','Fecha','Socio ID','Usuario','Plan','Importe','Moneda','Estado','Fuente','Referencia','Stripe Customer','Stripe Subscription'
    ])
  };
}

function registerPayment_(body) {
  const db = sheets_();
  const username = clean_(body.username, 24).toLowerCase();
  const socioId = clean_(body.socioId, 80);
  const planName = clean_(body.planName, 50);
  const customerId = clean_(body.stripeCustomerId, 80);
  const subscriptionId = clean_(body.stripeSubscriptionId, 80);
  const passwordHash = hash_(body.passwordHash);
  const pricingTier = clean_(body.pricingTier || 'standard', 30);
  const members = Array.isArray(body.members) ? body.members.slice(0, 12) : [];
  if (!socioId || !username || !planName || !customerId || !subscriptionId || !members.length) {
    throw new Error('Registro de pago incompleto.');
  }

  const duplicatePayment = findRow_(db.pagos, 1, clean_(body.paymentId, 100));
  if (duplicatePayment) return { ok: true, duplicate: true, socioId: socioId };

  let socioRow = findRow_(db.socios, 18, subscriptionId) || findRow_(db.socios, 2, username);
  const now = new Date();
  if (!socioRow) {
    socioRow = Math.max(DATA_START_ROW, db.socios.getLastRow() + 1);
    db.socios.getRange(socioRow, 1, 1, 21).setValues([[
      socioId,
      username,
      clean_(members[0] && members[0].name, 100),
      planName,
      'Activo',
      now,
      members.length,
      0,0,0,0,0,'','',
      'Stripe + Cloudflare',
      passwordHash,
      customerId,
      subscriptionId,
      now,
      'active',
      pricingTier
    ]]);
  } else {
    db.socios.getRange(socioRow, 1).setValue(socioId);
    db.socios.getRange(socioRow, 4).setValue(planName);
    db.socios.getRange(socioRow, 5).setValue('Activo');
    db.socios.getRange(socioRow, 7).setValue(members.length);
    if (passwordHash) db.socios.getRange(socioRow, 16).setValue(passwordHash);
    db.socios.getRange(socioRow, 17).setValue(customerId);
    db.socios.getRange(socioRow, 18).setValue(subscriptionId);
    db.socios.getRange(socioRow, 19).setValue(now);
    db.socios.getRange(socioRow, 20).setValue('active');
    db.socios.getRange(socioRow, 21).setValue(pricingTier);
  }

  ensureAffiliateCards_(db.afiliados, socioId, username, members);
  appendPayment_(db.pagos, {
    id: clean_(body.paymentId, 100),
    socioId: socioId,
    username: username,
    planName: planName,
    amount: number_(body.amount),
    currency: clean_(body.currency || 'MXN', 10).toUpperCase(),
    status: 'Pagado',
    reference: clean_(body.reference, 120),
    customerId: customerId,
    subscriptionId: subscriptionId
  });
  refreshPaymentTotal_(db.socios, db.pagos, socioRow, socioId);
  return { ok: true, socioId: socioId, members: members.length };
}

function subscriptionRenewed_(body) {
  const db = sheets_();
  const subscriptionId = clean_(body.stripeSubscriptionId, 80);
  if (!subscriptionId) throw new Error('Falta la suscripción de Stripe.');
  const row = findRow_(db.socios, 18, subscriptionId);
  if (!row) throw new Error('La suscripción no existe en SOCIOS.');
  const socioId = clean_(db.socios.getRange(row, 1).getValue(), 80);
  const username = clean_(db.socios.getRange(row, 2).getValue(), 24);
  const planName = clean_(db.socios.getRange(row, 4).getValue(), 50);
  const invoiceId = clean_(body.invoiceId, 100);
  if (invoiceId && !findRow_(db.pagos, 1, invoiceId)) {
    appendPayment_(db.pagos, {
      id: invoiceId,
      socioId: socioId,
      username: username,
      planName: planName,
      amount: number_(body.amount),
      currency: clean_(body.currency || 'MXN', 10).toUpperCase(),
      status: 'Pagado',
      reference: invoiceId,
      customerId: clean_(body.stripeCustomerId, 80),
      subscriptionId: subscriptionId
    });
  }
  db.socios.getRange(row, 5).setValue('Activo');
  db.socios.getRange(row, 19).setValue(new Date());
  db.socios.getRange(row, 20).setValue('active');
  refreshPaymentTotal_(db.socios, db.pagos, row, socioId);
  return { ok: true, socioId: socioId };
}

function subscriptionPaymentFailed_(body) {
  const db = sheets_();
  const subscriptionId = clean_(body.stripeSubscriptionId, 80);
  const row = findRow_(db.socios, 18, subscriptionId);
  if (!row) return { ok: true, missing: true };
  db.socios.getRange(row, 5).setValue('Pago pendiente');
  db.socios.getRange(row, 20).setValue('past_due');
  const socioId = clean_(db.socios.getRange(row, 1).getValue(), 80);
  const username = clean_(db.socios.getRange(row, 2).getValue(), 24);
  const planName = clean_(db.socios.getRange(row, 4).getValue(), 50);
  const invoiceId = clean_(body.invoiceId, 100);
  if (invoiceId && !findRow_(db.pagos, 1, invoiceId)) {
    appendPayment_(db.pagos, {
      id: invoiceId,
      socioId: socioId,
      username: username,
      planName: planName,
      amount: 0,
      currency: 'MXN',
      status: 'Fallido',
      reference: invoiceId,
      customerId: clean_(body.stripeCustomerId, 80),
      subscriptionId: subscriptionId
    });
  }
  return { ok: true, socioId: socioId };
}

function subscriptionStatus_(body) {
  const db = sheets_();
  const subscriptionId = clean_(body.stripeSubscriptionId, 80);
  const row = findRow_(db.socios, 18, subscriptionId);
  if (!row) return { ok: true, missing: true };
  const stripeStatus = clean_(body.status, 40).toLowerCase();
  const active = ['active','trialing'].indexOf(stripeStatus) >= 0;
  const pending = ['past_due','unpaid','incomplete'].indexOf(stripeStatus) >= 0;
  db.socios.getRange(row, 5).setValue(active ? 'Activo' : pending ? 'Pago pendiente' : 'Inactiva');
  db.socios.getRange(row, 20).setValue(stripeStatus || 'unknown');
  return { ok: true, socioId: clean_(db.socios.getRange(row, 1).getValue(), 80) };
}

function ensureAffiliateCards_(sheet, socioId, username, members) {
  members.forEach(function(member, index) {
    const email = clean_(member.email, 120).toLowerCase();
    let row = findAffiliateRow_(sheet, socioId, email);
    const memberCode = clean_(member.memberCode, 40) || generateMemberCode_(socioId, index + 1);
    const token = clean_(member.token, 120) || Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    const values = [[
      clean_(member.integranteId, 60) || socioId + '-P' + (index + 1),
      socioId,
      username,
      clean_(member.name, 100),
      index === 0 ? 'Titular' : 'Afiliado ' + (index + 1),
      memberCode,
      'Activo',
      email,
      clean_(member.phone, 30),
      token
    ]];
    if (row) sheet.getRange(row, 1, 1, 10).setValues(values);
    else sheet.getRange(Math.max(DATA_START_ROW, sheet.getLastRow() + 1), 1, 1, 10).setValues(values);
  });
}

function generateMemberCode_(socioId, position) {
  const base = Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, socioId + ':' + position + ':' + Date.now()))
    .replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase();
  return 'AL-' + base;
}

function appendPayment_(sheet, payment) {
  const row = Math.max(DATA_START_ROW, sheet.getLastRow() + 1);
  sheet.getRange(row, 1, 1, 12).setValues([[
    payment.id || 'PAY-' + Date.now(),
    new Date(),
    payment.socioId,
    payment.username,
    payment.planName,
    number_(payment.amount),
    payment.currency || 'MXN',
    payment.status || 'Pagado',
    'Stripe',
    payment.reference || '',
    payment.customerId || '',
    payment.subscriptionId || ''
  ]]);
}

function refreshPaymentTotal_(socios, pagos, socioRow, socioId) {
  const last = pagos.getLastRow();
  if (last < DATA_START_ROW) return;
  const rows = pagos.getRange(DATA_START_ROW, 1, last - DATA_START_ROW + 1, 12).getValues();
  const total = rows.reduce(function(sum, row) {
    return clean_(row[2], 80) === socioId && clean_(row[7], 30).toLowerCase() === 'pagado'
      ? sum + number_(row[5])
      : sum;
  }, 0);
  socios.getRange(socioRow, 8).setValue(total);
}

function findAffiliateRow_(sheet, socioId, email) {
  const last = sheet.getLastRow();
  if (last < DATA_START_ROW) return 0;
  const values = sheet.getRange(DATA_START_ROW, 1, last - DATA_START_ROW + 1, 10).getValues();
  for (let i = 0; i < values.length; i++) {
    if (clean_(values[i][1], 80) === socioId && clean_(values[i][7], 120).toLowerCase() === email) return i + DATA_START_ROW;
  }
  return 0;
}

function findRow_(sheet, column, value) {
  const target = clean_(value, 160);
  const last = sheet.getLastRow();
  if (!target || last < DATA_START_ROW) return 0;
  const hit = sheet.getRange(DATA_START_ROW, column, last - DATA_START_ROW + 1, 1)
    .createTextFinder(target).matchEntireCell(true).findNext();
  return hit ? hit.getRow() : 0;
}

function clean_(value, max) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max || 200);
}

function hash_(value) {
  const v = clean_(value, 64).toLowerCase();
  return /^[a-f0-9]{64}$/.test(v) ? v : '';
}

function number_(value) {
  const n = Number(value);
  return isFinite(n) ? n : 0;
}

function json_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}
