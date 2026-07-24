import crypto from "node:crypto";
import Stripe from "stripe";
import { google } from "googleapis";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable ${name}.`);
  return value;
};
const tab = () => process.env.GOOGLE_SHEET_TAB || "Hoja 1";
const sheetsClient = () => {
  const credentials = JSON.parse(required("GOOGLE_SERVICE_ACCOUNT_JSON"));
  const auth = new google.auth.GoogleAuth({ credentials, scopes:["https://www.googleapis.com/auth/spreadsheets"] });
  return google.sheets({ version:"v4", auth });
};
const levelFor = (session) => {
  const metadataPlan = (session.metadata?.align_membership || "").toLowerCase();
  if (metadataPlan === "black") return "Black";
  if (metadataPlan === "society") return "Society";

  const priceId = session.line_items?.data?.[0]?.price?.id;
  if (process.env.STRIPE_BLACK_PRICE_ID && priceId === process.env.STRIPE_BLACK_PRICE_ID) return "Black";
  if (process.env.STRIPE_SOCIETY_PRICE_ID && priceId === process.env.STRIPE_SOCIETY_PRICE_ID) return "Society";
  throw new Error("Precio de membresía desconocido.");
};
const codeFor = (level) => `AL-${level === "Black" ? "BLK" : "SOC"}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
const siteOrigin = (request) => {
  const configured = process.env.MEMBER_BASE_URL?.trim();
  return (configured || new URL(request.url).origin).replace(/\/$/, "");
};
const publicUrl = (request, token) => new URL(`/member/${token}`, siteOrigin(request)).toString();
const json = (body,status=200) => new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});

export default async (request) => {
  try {
    const sessionId = new URL(request.url).searchParams.get("session_id");
    if (!sessionId || !/^cs_(test_|live_)?[A-Za-z0-9_]+$/.test(sessionId)) return json({error:"Sesión no válida."},400);

    const stripe = new Stripe(required("STRIPE_SECRET_KEY"));
    const session = await stripe.checkout.sessions.retrieve(sessionId,{expand:["line_items"]});
    if (session.mode !== "subscription" || !["paid", "no_payment_required"].includes(session.payment_status)) {
      return json({pending:true},202);
    }

    const level = levelFor(session);
    const sheets = sheetsClient();
    const spreadsheetId = required("GOOGLE_SHEET_ID");
    const response = await sheets.spreadsheets.values.get({spreadsheetId,range:`${tab()}!A:S`});
    const rows = response.data.values || [];
    const existing = rows.slice(1).find((row) => row[3] === session.id);
    if (existing) {
      const token = existing[11];
      return json({level:existing[7] || level,memberUrl:existing[12] || publicUrl(request, token)});
    }

    const token = crypto.randomBytes(24).toString("base64url");
    const customer = session.customer_details || {};
    const code = codeFor(level);
    const memberUrl = publicUrl(request, token);
    const row = [
      `mem_${crypto.randomUUID()}`, session.customer || "", session.subscription || "", session.id,
      customer.name || "", customer.email || "", customer.phone || "", level, "Activa",
      new Date().toISOString(), "", token, memberUrl, code, "", "", 0,
      level === "Black" ? "Incluida" : "Opcional", ""
    ];
    await sheets.spreadsheets.values.append({spreadsheetId,range:`${tab()}!A:S`,valueInputOption:"USER_ENTERED",requestBody:{values:[row]}});
    return json({level,memberUrl});
  } catch (error) {
    console.error(error);
    return json({error:"No pudimos activar la membresía."},500);
  }
};