import crypto from "node:crypto";
import { google } from "googleapis";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable ${name}.`);
  return value;
};
const tab = () => process.env.GOOGLE_SHEET_TAB || "Hoja 1";
const secret = () => process.env.QR_SIGNING_SECRET || required("STRIPE_SECRET_KEY");
const periodFor = (date = new Date()) => date.toISOString().slice(0, 7);
const sign = (token, period) => crypto.createHmac("sha256", secret()).update(`${token}:${period}`).digest();
const safeEqual = (a, b) => {
  try {
    const left = Buffer.from(a, "base64url");
    const right = sign(b.token, b.period);
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  } catch { return false; }
};
const escapeHtml = (value) => String(value || "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"})[c]);
const page = (title, body, ok = false) => new Response(`<!doctype html><html lang="es-MX"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="${ok ? "#173c2d" : "#341616"}"><title>${escapeHtml(title)} | ALIGN</title><style>*{box-sizing:border-box}body{min-height:100vh;margin:0;display:grid;place-items:center;padding:24px;background:${ok ? "radial-gradient(circle at top,#245b43,#09130f 65%)" : "radial-gradient(circle at top,#653030,#160909 65%)"};color:#f5f2ec;font-family:Arial,sans-serif}.card{width:min(100%,460px);padding:32px;border:1px solid rgba(255,255,255,.25);border-radius:24px;background:rgba(5,8,7,.72);box-shadow:0 30px 70px rgba(0,0,0,.4);text-align:center}.status{display:inline-block;padding:8px 12px;border:1px solid currentColor;border-radius:999px;text-transform:uppercase;letter-spacing:.12em;font-size:12px;color:${ok ? "#bde7cf" : "#ffc1c1"}}h1{margin:22px 0 8px;font:500 42px Georgia,serif}.level{margin:0;color:#d9c6a5;font-size:22px}.code{margin:18px 0 0;font-family:monospace;letter-spacing:.12em}.photo{width:132px;height:132px;margin:24px auto 0;border-radius:50%;object-fit:cover;border:3px solid #d9c6a5;background:#222}.note{margin:22px 0 0;color:#c7c7c7;line-height:1.55;font-size:14px}.period{margin-top:16px;color:#999;font-family:monospace;font-size:12px}</style></head><body><main class="card">${body}</main></body></html>`, { status: ok ? 200 : 403, headers: {"content-type":"text/html; charset=utf-8","cache-control":"no-store"} });

export default async (request) => {
  try {
    const url = new URL(request.url);
    const token = url.searchParams.get("token") || "";
    const period = url.searchParams.get("period") || "";
    const sig = url.searchParams.get("sig") || "";
    const currentPeriod = periodFor();

    if (!/^[A-Za-z0-9_-]{20,}$/.test(token) || period !== currentPeriod || !safeEqual(sig, { token, period })) {
      return page("QR vencido", `<span class="status">No válido</span><h1>QR vencido</h1><p class="note">Solicita al miembro abrir su tarjeta digital actual. Las capturas de meses anteriores no son válidas.</p>`);
    }

    const credentials = JSON.parse(required("GOOGLE_SERVICE_ACCOUNT_JSON"));
    const auth = new google.auth.GoogleAuth({ credentials, scopes:["https://www.googleapis.com/auth/spreadsheets.readonly"] });
    const sheets = google.sheets({ version:"v4", auth });
    const response = await sheets.spreadsheets.values.get({ spreadsheetId:required("GOOGLE_SHEET_ID"), range:`${tab()}!A:S` });
    const row = (response.data.values || []).slice(1).find((values) => values[11] === token);
    if (!row || row[8] !== "Activa") return page("Membresía no activa", `<span class="status">No válido</span><h1>Membresía no activa</h1><p class="note">No apliques el beneficio. Contacta a ALIGN si el miembro considera que existe un error.</p>`);

    const name = escapeHtml(row[4] || "Miembro ALIGN");
    const level = escapeHtml(row[7] || "Society");
    const code = escapeHtml(row[13] || "");
    const photo = row[18] ? `<img class="photo" src="${escapeHtml(row[18])}" alt="Foto del socio">` : `<div class="photo" style="display:grid;place-items:center;font-size:42px">${escapeHtml(name.charAt(0))}</div>`;
    return page("Miembro verificado", `<span class="status">Miembro activo</span>${photo}<h1>${name}</h1><p class="level">ALIGN ${level}</p><p class="code">${code}</p><p class="note">Verifica que la persona coincida con la foto antes de aplicar el beneficio. Este QR solo es válido durante el mes indicado.</p><p class="period">Vigencia ${escapeHtml(period)}</p>`, true);
  } catch (error) {
    console.error(error);
    return page("Error de validación", `<span class="status">Error</span><h1>No se pudo validar</h1><p class="note">Intenta nuevamente o contacta a ALIGN.</p>`);
  }
};
