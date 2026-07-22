import crypto from "node:crypto";
import Stripe from "stripe";
import { google } from "googleapis";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable ${name}.`);
  return value;
};

const getSheets = () => {
  const credentials = JSON.parse(required("GOOGLE_SERVICE_ACCOUNT_JSON"));
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
};

const membershipLevel = (session) => {
  const priceId = session.line_items?.data?.[0]?.price?.id;
  if (priceId === process.env.STRIPE_BLACK_PRICE_ID) return "Black";
  if (priceId === process.env.STRIPE_SOCIETY_PRICE_ID) return "Society";
  throw new Error("El precio de Stripe no corresponde a Black o Society.");
};

const memberCode = (level) => {
  const prefix = level === "Black" ? "BLK" : "SOC";
  return `AL-${prefix}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
};

const memberUrl = (token) => `${required("MEMBER_BASE_URL").replace(/\/$/, "")}/member/${token}`;

const sheetTab = () => process.env.GOOGLE_SHEET_TAB || "Hoja 1";

async function alreadyRecorded(sheets, spreadsheetId, sessionId) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetTab()}!D:D`,
  });
  return (response.data.values || []).some(([value]) => value === sessionId);
}

async function registerMember(session, stripe) {
  const expanded = await stripe.checkout.sessions.retrieve(session.id, {
    expand: ["line_items"],
  });
  const level = membershipLevel(expanded);
  const sheets = getSheets();
  const spreadsheetId = required("GOOGLE_SHEET_ID");
  if (await alreadyRecorded(sheets, spreadsheetId, expanded.id)) return;

  const token = crypto.randomBytes(24).toString("base64url");
  const customer = expanded.customer_details || {};
  const now = new Date().toISOString();
  const row = [
    `mem_${crypto.randomUUID()}`,
    expanded.customer || "",
    expanded.subscription || "",
    expanded.id,
    customer.name || "",
    customer.email || "",
    customer.phone || "",
    level,
    "Activa",
    now,
    "",
    token,
    memberUrl(token),
    memberCode(level),
    "",
    "",
    0,
    level === "Black" ? "Incluida" : "Opcional",
    "",
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetTab()}!A:S`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [row] },
  });
}

export default async (request) => {
  try {
    const stripe = new Stripe(required("STRIPE_SECRET_KEY"));
    const signature = request.headers.get("stripe-signature");
    if (!signature) return new Response("Firma de Stripe ausente.", { status: 400 });

    const payload = await request.text();
    const event = stripe.webhooks.constructEvent(
      payload,
      signature,
      required("STRIPE_WEBHOOK_SECRET"),
    );

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      if (session.mode === "subscription" && session.payment_status === "paid") {
        await registerMember(session, stripe);
      }
    }

    return Response.json({ received: true });
  } catch (error) {
    console.error(error);
    return new Response("Webhook no procesado.", { status: 400 });
  }
};
