import crypto from "node:crypto";
import { google } from "googleapis";
import { membersFromMetadata, planFromSession } from "./_plans.mjs";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable ${name}.`);
  return value;
};

const tab = () => process.env.GOOGLE_SHEET_TAB || "Hoja 1";
const sheetsClient = () => {
  const credentials = JSON.parse(required("GOOGLE_SERVICE_ACCOUNT_JSON"));
  const auth = new google.auth.GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  return google.sheets({ version: "v4", auth });
};

const memberUrl = (origin, token) => new URL(`/member/${token}`, origin).toString();
const memberCode = (prefix) => `AL-${prefix}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

export async function registerSessionMembers(session, origin) {
  const plan = planFromSession(session);
  const members = membersFromMetadata(session.metadata, plan.seats);
  const sheets = sheetsClient();
  const spreadsheetId = required("GOOGLE_SHEET_ID");
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tab()}!A:Z` });
  const rows = response.data.values || [];
  const existing = rows.slice(1).filter((row) => row[3] === session.id);
  if (existing.length === plan.seats) {
    return existing.map((row) => ({ name: row[4], level: row[7], memberCode: row[13], token: row[11], memberUrl: row[12] }));
  }
  if (existing.length) throw new Error("El alta de esta membresía quedó incompleta. Requiere revisión manual.");

  const now = new Date().toISOString();
  const groupId = `grp_${crypto.randomUUID()}`;
  const records = members.map((member, index) => {
    const token = crypto.randomBytes(24).toString("base64url");
    const code = memberCode(plan.prefix);
    return {
      name: member.name,
      level: plan.level,
      memberCode: code,
      token,
      memberUrl: memberUrl(origin, token),
      row: [
        `mem_${crypto.randomUUID()}`, session.customer || "", session.subscription || "", session.id,
        member.name, member.email, member.phone, plan.level, "Activa", now, "", token,
        memberUrl(origin, token), code, "", "", 0, "Digital", "", groupId, String(index + 1), String(plan.seats), "stripe", "", 0, 0,
      ],
    };
  });

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${tab()}!A:Z`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: records.map((record) => record.row) },
  });
  return records.map(({ row, ...record }) => record);
}
