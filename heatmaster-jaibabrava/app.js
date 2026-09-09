const API_URL = "https://script.google.com/macros/s/AKfycby_aQm7IcWaAfKEHL_sh-GrE8hogVtr3zMQ4j3qHM587pNaHhzUehkFxpzVM774Han7sw/exec";

const form = document.getElementById('registrationForm');
const button = document.getElementById('submitButton');
const message = document.getElementById('formMessage');
const downloadButton = document.getElementById('downloadCard');
const loginForm = document.getElementById('loginForm');
const loginButton = document.getElementById('loginButton');
const loginMessage = document.getElementById('loginMessage');
const accountSummary = document.getElementById('accountSummary');
const verificationPanel = document.getElementById('verificationPanel');
const purchasePanel = document.getElementById('purchasePanel');
const purchaseForm = document.getElementById('purchaseForm');
const subtotalInput = document.getElementById('purchaseSubtotal');
const pinInput = document.getElementById('cashierPin');
const purchaseButton = document.getElementById('purchaseButton');
const purchaseMessage = document.getElementById('purchaseMessage');
let latestMember = null;
let verificationCredentials = null;

function normalizePhone(value) { return value.replace(/\D/g, '').slice(-10); }
function setMessage(target, text, type='') { target.textContent = text; target.className = `form-message ${type}`; }
function money(value) { return new Intl.NumberFormat('es-MX', { style:'currency', currency:'MXN' }).format(Number(value || 0)); }
function roundMoney(value) { return Math.round((Number(value) + Number.EPSILON) * 100) / 100; }

function buildQrUrl(member) {
  const payload = String(member.qrPayload || '').trim();
  if (/^https?:\/\//i.test(payload)) return payload;
  const legacy = payload.match(/^HMJB:([^:]+):(.+)$/);
  if (legacy) {
    const base = `${window.location.origin}${window.location.pathname}`;
    return `${base}?verify=${encodeURIComponent(legacy[1])}&token=${encodeURIComponent(legacy[2])}`;
  }
  return payload;
}

function keepSingleQrCanvas(qr, qrSize) {
  const canvases = Array.from(qr.querySelectorAll('canvas'));
  const keep = canvases[0] || null;
  Array.from(qr.children).forEach(child => { if (child !== keep) child.remove(); });
  if (keep) {
    keep.style.setProperty('width', `${qrSize}px`, 'important');
    keep.style.setProperty('height', `${qrSize}px`, 'important');
    keep.style.setProperty('display', 'block', 'important');
    keep.style.setProperty('margin', '0 auto', 'important');
    keep.style.setProperty('max-width', 'none', 'important');
    keep.style.setProperty('max-height', 'none', 'important');
  }
}

function renderCard(member) {
  document.getElementById('cardName').textContent = member.fullName;
  document.getElementById('cardMember').textContent = `SOCIO: ${member.memberNumber}`;
  document.getElementById('cardExpiry').textContent = member.expiryDisplay;
  document.getElementById('cardStatus').textContent = member.status || 'ACTIVO';

  const qr = document.getElementById('qrCode');
  qr.replaceChildren();
  const qrSize = window.matchMedia('(max-width: 620px)').matches ? 132 : 144;
  new QRCode(qr, {
    text: buildQrUrl(member), width: qrSize, height: qrSize,
    colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.L
  });
  requestAnimationFrame(() => requestAnimationFrame(() => keepSingleQrCanvas(qr, qrSize)));
  setTimeout(() => keepSingleQrCanvas(qr, qrSize), 150);
  downloadButton.disabled = false;
}

async function callApi(payload) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  });
  return response.json();
}

function updatePurchasePreview() {
  const subtotal = roundMoney(Number(subtotalInput.value || 0));
  const discount = roundMoney(subtotal * 0.15);
  const total = roundMoney(subtotal - discount);
  document.getElementById('previewSubtotal').textContent = money(subtotal);
  document.getElementById('previewDiscount').textContent = `−${money(discount)}`;
  document.getElementById('previewTotal').textContent = money(total);
}

async function openVerificationFromQr() {
  const params = new URLSearchParams(window.location.search);
  const memberNumber = (params.get('verify') || '').trim().toUpperCase();
  const token = params.get('token') || '';
  if (!memberNumber || !token) return;

  verificationCredentials = { memberNumber, token };
  document.body.classList.add('verify-mode');
  verificationPanel.classList.add('visible');
  document.getElementById('verificationTitle').textContent = 'VALIDANDO QR...';
  document.getElementById('verificationText').textContent = 'Consultando la membresía en tiempo real.';

  try {
    const result = await callApi({ action:'verify', memberNumber, token });
    if (!result.ok) throw new Error(result.message || 'QR inválido.');
    latestMember = result.member;
    renderCard(latestMember);
    const active = latestMember.status === 'ACTIVO';
    document.body.classList.toggle('verification-valid', active);
    document.body.classList.toggle('verification-invalid', !active);
    document.getElementById('verificationTitle').textContent = active ? 'SOCIO ACTIVO' : 'MEMBRESÍA VENCIDA';
    document.getElementById('verificationText').textContent = active
      ? 'Captura la cuenta para aplicar y registrar el 15% de descuento.'
      : 'No aplicar el descuento. La vigencia ha terminado.';
    purchasePanel.classList.toggle('visible', active);
  } catch (error) {
    document.body.classList.add('verification-invalid');
    document.getElementById('verificationTitle').textContent = 'QR NO VÁLIDO';
    document.getElementById('verificationText').textContent = error.message || 'No fue posible validar este código.';
    document.getElementById('cardSection').style.display = 'none';
    purchasePanel.classList.remove('visible');
  }
}

purchaseForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!verificationCredentials || !latestMember) return;
  const subtotal = roundMoney(Number(subtotalInput.value));
  const pin = pinInput.value.trim();
  if (!Number.isFinite(subtotal) || subtotal <= 0) {
    setMessage(purchaseMessage, 'Ingresa el monto original de la cuenta.', 'error');
    return;
  }
  if (!/^\d{6}$/.test(pin)) {
    setMessage(purchaseMessage, 'Ingresa el NIP de caja de 6 dígitos.', 'error');
    return;
  }

  purchaseButton.disabled = true;
  purchaseButton.textContent = 'REGISTRANDO...';
  setMessage(purchaseMessage, '');
  try {
    const result = await callApi({
      action: 'purchase',
      memberNumber: verificationCredentials.memberNumber,
      token: verificationCredentials.token,
      subtotal,
      pin
    });
    if (!result.ok) throw new Error(result.message || 'No se pudo registrar el consumo.');
    document.getElementById('previewSubtotal').textContent = money(result.purchase.subtotal);
    document.getElementById('previewDiscount').textContent = `−${money(result.purchase.discount)}`;
    document.getElementById('previewTotal').textContent = money(result.purchase.total);
    setMessage(purchaseMessage, `Consumo registrado. Cobrar ${money(result.purchase.total)}.`, 'success');
    purchaseButton.textContent = 'CONSUMO REGISTRADO';
    subtotalInput.disabled = true;
    pinInput.disabled = true;
    purchaseButton.disabled = true;
  } catch (error) {
    setMessage(purchaseMessage, error.message || 'Ocurrió un error. Intenta nuevamente.', 'error');
    purchaseButton.disabled = false;
    purchaseButton.textContent = 'APLICAR Y REGISTRAR DESCUENTO';
  }
});

subtotalInput.addEventListener('input', updatePurchasePreview);

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!loginForm.reportValidity()) return;
  const memberNumber = document.getElementById('loginMemberNumber').value.trim().toUpperCase();
  const phone = normalizePhone(document.getElementById('loginPhone').value);
  if (!/^HM-JB-\d{4}$/.test(memberNumber) || phone.length !== 10) {
    setMessage(loginMessage, 'Ingresa un número de socio válido y tu celular de 10 dígitos.', 'error');
    return;
  }
  loginButton.disabled = true;
  loginButton.textContent = 'CONSULTANDO...';
  setMessage(loginMessage, '');
  try {
    const result = await callApi({ action:'login', memberNumber, phone });
    if (!result.ok) throw new Error(result.message || 'No se pudo consultar la tarjeta.');
    latestMember = result.member;
    renderCard(latestMember);
    document.getElementById('accountName').textContent = `Hola, ${latestMember.fullName}`;
    document.getElementById('accountStatus').textContent = latestMember.status;
    document.getElementById('accountSavings').textContent = money(latestMember.savings);
    document.getElementById('accountConsumption').textContent = money(latestMember.consumption);
    document.getElementById('accountVisits').textContent = String(latestMember.visits || 0);
    accountSummary.classList.add('visible');
    document.body.classList.add('member-mode');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (error) {
    accountSummary.classList.remove('visible');
    document.body.classList.remove('member-mode');
    setMessage(loginMessage, error.message || 'Ocurrió un error. Intenta nuevamente.', 'error');
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = 'VER MI TARJETA';
  }
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const payload = {
    action: 'register',
    fullName: document.getElementById('fullName').value.trim(),
    phone: normalizePhone(document.getElementById('phone').value),
    email: document.getElementById('email').value.trim().toLowerCase(),
    consent: document.getElementById('consent').checked
  };
  if (payload.phone.length !== 10) { setMessage(message, 'Ingresa un celular de 10 dígitos.', 'error'); return; }
  button.disabled = true;
  button.textContent = 'GENERANDO...';
  setMessage(message, '');
  try {
    const result = await callApi(payload);
    if (!result.ok) throw new Error(result.message || 'No se pudo completar el registro.');
    latestMember = result.member;
    renderCard(latestMember);
    setMessage(message, `Registro completado. Tu número es ${latestMember.memberNumber}.`, 'success');
    form.reset();
  } catch (error) {
    setMessage(message, error.message || 'Ocurrió un error. Intenta nuevamente.', 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'GENERAR MI TARJETA';
  }
});

downloadButton.addEventListener('click', async () => {
  if (!latestMember) return;
  const card = document.getElementById('memberCard');
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const canvas = await html2canvas(card, { scale: 3, backgroundColor: null, useCORS: true, logging: false });
  const link = document.createElement('a');
  link.download = `Tarjeta-${latestMember.memberNumber}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
});

updatePurchasePreview();
openVerificationFromQr();
