const API_URL = "https://script.google.com/macros/s/AKfycby_aQm7IcWaAfKEHL_sh-GrE8hogVtr3zMQ4j3qHM587pNaHhzUehkFxpzVM774Han7sw/exec";

const form = document.getElementById('registrationForm');
const button = document.getElementById('submitButton');
const message = document.getElementById('formMessage');
const downloadButton = document.getElementById('downloadCard');
let latestMember = null;

function normalizePhone(value) { return value.replace(/\D/g, '').slice(-10); }
function setMessage(text, type='') { message.textContent = text; message.className = `form-message ${type}`; }

function renderCard(member) {
  document.getElementById('cardName').textContent = member.fullName;
  document.getElementById('cardMember').textContent = `SOCIO: ${member.memberNumber}`;
  document.getElementById('cardExpiry').textContent = member.expiryDisplay;
  const qr = document.getElementById('qrCode');
  qr.innerHTML = '';
  new QRCode(qr, { text: member.qrPayload, width: 68, height: 68, correctLevel: QRCode.CorrectLevel.H });
  downloadButton.disabled = false;
}

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
  if (payload.phone.length !== 10) { setMessage('Ingresa un celular de 10 dígitos.', 'error'); return; }
  button.disabled = true;
  button.textContent = 'GENERANDO...';
  setMessage('');
  try {
    const response = await fetch(API_URL, { method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'}, body:JSON.stringify(payload) });
    const result = await response.json();
    if (!result.ok) throw new Error(result.message || 'No se pudo completar el registro.');
    latestMember = result.member;
    renderCard(latestMember);
    setMessage(`Registro completado. Tu número es ${latestMember.memberNumber}.`, 'success');
    form.reset();
  } catch (error) {
    setMessage(error.message || 'Ocurrió un error. Intenta nuevamente.', 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'GENERAR MI TARJETA';
  }
});

downloadButton.addEventListener('click', async () => {
  if (!latestMember) return;
  const card = document.getElementById('memberCard');
  const canvas = await html2canvas(card, { scale: 3, backgroundColor: null });
  const link = document.createElement('a');
  link.download = `Tarjeta-${latestMember.memberNumber}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
});