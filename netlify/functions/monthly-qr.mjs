import crypto from "node:crypto";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable ${name}.`);
  return value;
};

const periodFor = (date = new Date()) => date.toISOString().slice(0, 7);
const secret = () => process.env.QR_SIGNING_SECRET || required("STRIPE_SECRET_KEY");
const signatureFor = (token, period) =>
  crypto.createHmac("sha256", secret()).update(`${token}:${period}`).digest("base64url");
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

export default async (request) => {
  try {
    const url = new URL(request.url);
    const token = url.searchParams.get("token") || "";
    if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) return json({ error: "Token no válido." }, 400);

    const period = periodFor();
    const signature = signatureFor(token, period);
    const validationUrl = new URL("/.netlify/functions/validate-member", url.origin);
    validationUrl.searchParams.set("token", token);
    validationUrl.searchParams.set("period", period);
    validationUrl.searchParams.set("sig", signature);

    return json({ validationUrl: validationUrl.toString(), period });
  } catch (error) {
    console.error(error);
    return json({ error: "No pudimos generar el QR mensual." }, 500);
  }
};
