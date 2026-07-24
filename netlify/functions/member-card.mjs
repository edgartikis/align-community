import { google } from "googleapis";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable ${name}.`);
  return value;
};

const sheetTab = () => process.env.GOOGLE_SHEET_TAB || "Hoja 1";

const getSheets = () => {
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
    const token = new URL(request.url).searchParams.get("token");
    if (!token || !/^[A-Za-z0-9_-]{20,}$/.test(token)) {
      return json({ error: "Tarjeta no encontrada." }, 404);
    }

    const sheets = getSheets();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: required("GOOGLE_SHEET_ID"),
      range: `${sheetTab()}!A:S`,
    });
    const rows = response.data.values || [];
    const row = rows.slice(1).find((values) => values[11] === token);

    if (!row) return json({ error: "Tarjeta no encontrada." }, 404);

    const active = row[8] === "Activa";
    return json({
      active,
      name: row[4] || "Miembro ALIGN",
      level: row[7] || "Society",
      memberCode: row[13] || "",
      joinedAt: row[9] || "",
      savings: Number(row[16] || 0),
      photoUrl: row[18] || "",
    });
  } catch (error) {
    console.error(error);
    return json({ error: "No pudimos cargar esta tarjeta." }, 500);
  }
};
