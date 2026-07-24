import { google } from "googleapis";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable ${name}.`);
  return value;
};

const tab = () => process.env.GOOGLE_SHEET_TAB || "Hoja 1";
const sheetsClient = () => {
  const credentials = JSON.parse(required("GOOGLE_SERVICE_ACCOUNT_JSON"));
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  return google.sheets({ version: "v4", auth });
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

export default async (request) => {
  try {
    if (request.method !== "POST") return json({ error: "Método no permitido." }, 405);
    const body = await request.json();
    const memberCode = String(body.memberCode || "").trim().toUpperCase();
    const password = String(body.password || "").trim().toUpperCase();

    if (!memberCode || memberCode !== password) {
      return json({ error: "Número de socio o contraseña incorrectos." }, 401);
    }

    const sheets = sheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: required("GOOGLE_SHEET_ID"),
      range: `${tab()}!A:S`,
    });
    const rows = response.data.values || [];
    const row = rows.slice(1).find((values) => String(values[13] || "").trim().toUpperCase() === memberCode);

    if (!row || row[8] !== "Activa") {
      return json({ error: "Membresía no encontrada o inactiva." }, 401);
    }

    return json({
      ok: true,
      token: row[11],
      name: row[4] || "Miembro ALIGN",
      level: row[7] || "Society",
      memberCode: row[13] || memberCode,
    });
  } catch (error) {
    console.error(error);
    return json({ error: "No pudimos iniciar sesión." }, 500);
  }
};
