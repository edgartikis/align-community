const API_URL = "https://script.google.com/macros/s/AKfycby_aQm7IcWaAfKEHL_sh-GrE8hogVtr3zMQ4j3qHM587pNaHhzUehkFxpzVM774Han7sw/exec";

const form = document.getElementById('registrationForm');
const button = document.getElementById('submitButton');
const message = document.getElementById('formMessage');
const downloadButton = document.getElementById('downloadCard');
const loginForm = document.getElementById('loginForm');
const loginButton = document.getElementById('loginButton');
const loginMessage = document.getElementById('loginMessage');
const accountSummary = document.getElementById('accountSummary');
let latestMember = null;

function normalizePhone(value) { return value.replace(/\D/g, '').slice(-10); }
function setMessage(target, text, type='') { target.textContent = text; target.className = `form-message ${type}`; }
function money(value) { return new Intl.NumberFormat('es-MX', { style:'currency', currency:'MXN' }).format(Number(value || 0)); }

function renderCard(member) {
  document.getElementById('cardName').textContent = member.fullName;
  document.getElementById('cardMember').textContent = `SOCIO: ${member.memberNumber}`;
  document.getElementById('cardExpiry').textContent = member.expiryDisplay;
  document.getElementById('cardStatus').textContent = member.status || 'ACTIVO';

  const qr = document.getElementById('qrCode');
  qr.innerHTML = '';
  const qrSize = window.matchMedia('(max-width: 620px)').matches ? 70 : 82;
  new QRCode(qr, {
    text: member.qrPayload,
    width: qrSize,
    height: qrSize,
    colorDark: '#000000',
    colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.M
  });

  requestAnimationFrame(() => {
    qr.querySelectorAll('canvas, img').forEach((qrGraphic) => {
      qrGraphic.style.width = `${qrSize}px`;
      qrGraphic.style.height = `${qrSize}px`;
      qrGraphic.style.display = 'block';
      qrGraphic.style.margin = '0';
      qrGraphic.style.maxWidth = '100%';
      qrGraphic.style.maxHeight = '100%';
    });
  });
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

loginForm.addEventListener('submit', async (event) => {
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

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const payload = {
    action: 'register',
    fullName: document.getElementById('fullName').value.trim(),
    phone: normalizePhone(document.getElementById('phone').value),
    email: document.getElementById('email').value.trim().toLowerCase(),
    consent: document.getElementById('consent').checked
  };
  if (payload.phone.length !== 10) {
    setMessage(message, 'Ingresa un celular de 10 dígitos.', 'error');
    return;
  }
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
  const canvas = await html2canvas(card, {
    scale: 3,
    backgroundColor: null,
    useCORS: true,
    logging: false,
    width: card.scrollWidth,
    height: card.scrollHeight,
    windowWidth: card.scrollWidth,
    windowHeight: card.scrollHeight
  });
  const link = document.createElement('a');
  link.download = `Tarjeta-${latestMember.memberNumber}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
});