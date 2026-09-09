import billingWorker from "./entry.js";

const ALLOWED_ORIGINS = new Set([
  "https://alignmembers.com.mx",
  "https://www.alignmembers.com.mx",
  "https://edgartikis.github.io",
]);

const ALLIES = Object.freeze({
  "ALI-001": { key: "global", name: "Global Gym", category: "Fitness & Cycling" },
  "ALI-002": { key: "uspin", name: "USPIN", category: "Fitness & Cycling" },
  "ALI-003": { key: "sante", name: "Santé Pilates", category: "Pilates" },
  "ALI-004": { key: "nuva", name: "NUVA Pilates Studio", category: "Pilates" },
  "ALI-005": { key: "padel", name: "Pádel 11:11", category: "Pádel" },
  "ALI-006": { key: "gingers", name: "Ginger's Coffee House", category: "Coffee" },
  "ALI-007": { key: "rancho", name: "Rancho MX", category: "Ranch & Western" },
  "ALI-008": { key: "horse", name: "Horse Riding", category: "Ranch & Western" },
  "ALI-009": { key: "charreadas", name: "Charreadas", category: "Ranch & Western" },
  "ALI-010": { key: "marea", name: "Marea Baja", category: "Outdoor & Adventure" },
  "ALI-011": { key: "fishing", name: "Vaca Fishing", category: "Outdoor & Adventure" },
  "ALI-013": { key: "ancla", name: "El Ancla del Canelo", category: "Food & Experiences" },
});

function cors(origin = "") {
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : "https://alignmembers.com.mx";
  return {
    "access-control-allow-origin": allowed,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    vary: "Origin",
  };
}

function json(body, status = 200, origin = "") {
  return Response.json(body, { status, headers: { ...cors(origin), "cache-control": "no-store" } });
}

function clean(value, max = 200) {
  return String(value == null ? "" : value).replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, max);
}

function amount(value, max = 1000000) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(max, Math.round(number * 100) / 100)) : 0;
}

function addCalendarMonth(iso) {
  const source = new Date(iso);
  if (Number.isNaN(source.getTime())) return new Date(Date.now() + 30 * 86400000).toISOString();
  const y = source.getUTCFullYear(), m = source.getUTCMonth(), d = source.getUTCDate();
  const targetMonth = m + 1;
  const lastDay = new Date(Date.UTC(y, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, targetMonth, Math.min(d, lastDay), source.getUTCHours(), source.getUTCMinutes(), source.getUTCSeconds(), source.getUTCMilliseconds())).toISOString();
}

function periodForMember(member) {
  const validFrom = member.validFrom || member.joinedAt || new Date().toISOString();
  return { validFrom, validUntil: member.validUntil || addCalendarMonth(validFrom) };
}

function isWithinPeriod(period, now = Date.now()) {
  const from = new Date(period.validFrom).getTime(), until = new Date(period.validUntil).getTime();
  return Number.isFinite(from) && Number.isFinite(until) && now >= from && now < until;
}

async function hmacBase64Url(secret, value) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
  let binary = "";
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function constantTimeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function qrSecret(env) {
  const secret = String(env.QR_SIGNING_SECRET || env.STRIPE_SECRET_KEY || "").trim();
  if (!secret) throw new Error("No está configurada la firma de QR.");
  return secret;
}

function cycleKey(period) { return `${period.validFrom}|${period.validUntil}`; }
async function qrSignature(env, token, period) { return hmacBase64Url(qrSecret(env), `${token}:${cycleKey(period)}`); }

function parseQr(raw) {
  let url;
  try { url = new URL(String(raw || "").trim()); } catch (_) { throw new Error("El QR no contiene una URL válida de ALIGN."); }
  const allowedHost = url.hostname === "api.alignmembers.com.mx" || url.hostname.endsWith(".workers.dev");
  if (!allowedHost || url.pathname !== "/api/validate-member") throw new Error("Este QR no pertenece a una tarjeta ALIGN vigente.");
  return {
    token: clean(url.searchParams.get("token"), 140),
    validFrom: clean(url.searchParams.get("from"), 60),
    validUntil: clean(url.searchParams.get("until"), 60),
    sig: clean(url.searchParams.get("sig"), 200),
  };
}

async function verifiedMemberFromQr(env, rawQr) {
  if (!env.PAYMENT_STATE) throw new Error("PAYMENT_STATE no está conectado.");
  const supplied = parseQr(rawQr);
  if (!/^[A-Za-z0-9_-]{20,}$/.test(supplied.token)) throw new Error("Token de membresía inválido.");
  const raw = await env.PAYMENT_STATE.get(`member:${supplied.token}`);
  if (!raw) throw new Error("Miembro no encontrado.");
  const member = JSON.parse(raw);
  const current = periodForMember(member);
  if (supplied.validFrom !== current.validFrom || supplied.validUntil !== current.validUntil) throw new Error("El QR corresponde a una mensualidad anterior.");
  const expected = await qrSignature(env, supplied.token, current);
  if (!constantTimeEqual(expected, supplied.sig)) throw new Error("Firma de QR inválida.");
  if (member.status !== "Activa" || !isWithinPeriod(current)) throw new Error("La membresía no está vigente.");
  return { token: supplied.token, member, period: current };
}

function socioIdFor(member) {
  if (member.socioId) return clean(member.socioId, 80);
  const integranteId = clean(member.integranteId, 100);
  const base = integranteId.replace(/-P\d+$/i, "");
  if (/^cus_[A-Za-z0-9]+$/.test(base)) return `STRIPE-${base}`;
  return clean(member.groupId, 80);
}

function allyFor(id) {
  const allyId = clean(id, 30).toUpperCase();
  const ally = ALLIES[allyId];
  if (!ally) throw new Error("Aliado no reconocido.");
  return { allyId, ...ally };
}

async function postDatabase(env, payload) {
  const url = String(env.ALIGN_DB_URL || "").trim();
  const secret = String(env.ALIGN_DB_SECRET || "").trim();
  if (!url || !secret) throw new Error("La sincronización con Google Sheets no está configurada.");
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...payload, mode: "ALIGN_PROD_2026", secret }),
  });
  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch (_) {}
  if (!response.ok || !data?.ok) throw new Error(data?.error || "Google Sheets no confirmó el registro.");
  return data;
}

async function allyMetrics(env, allyId) {
  const raw = await env.PAYMENT_STATE.get(`ally-metrics:${allyId}`);
  if (!raw) return { visits: 0, people: 0, gross: 0, sales: 0, savings: 0, lastVisit: "" };
  try { return { visits: 0, people: 0, gross: 0, sales: 0, savings: 0, lastVisit: "", ...JSON.parse(raw) }; }
  catch (_) { return { visits: 0, people: 0, gross: 0, sales: 0, savings: 0, lastVisit: "" }; }
}

async function handleAllyScan(request, env) {
  const origin = request.headers.get("origin") || "";
  const body = await request.json();
  const ally = allyFor(body.allyId);
  const verified = await verifiedMemberFromQr(env, body.qr);
  const member = verified.member;
  return json({
    ok: true,
    ally,
    member: {
      name: member.name,
      level: member.level,
      planKey: member.planKey,
      memberCode: member.memberCode,
      photoUrl: member.photoUrl || "",
      status: "Activa",
      validFrom: verified.period.validFrom,
      validUntil: verified.period.validUntil,
    },
  }, 200, origin);
}

async function handleRegisterVisit(request, env) {
  const origin = request.headers.get("origin") || "";
  const body = await request.json();
  const ally = allyFor(body.allyId);
  const verified = await verifiedMemberFromQr(env, body.qr);
  const member = verified.member;
  const clientVisitId = clean(body.clientVisitId, 100);
  if (clientVisitId) {
    const previousId = await env.PAYMENT_STATE.get(`visit-client:${clientVisitId}`);
    if (previousId) {
      const previous = await env.PAYMENT_STATE.get(`visit:${previousId}`);
      if (previous) return json({ ok: true, duplicate: true, visit: JSON.parse(previous), metrics: await allyMetrics(env, ally.allyId) }, 200, origin);
    }
  }

  const people = Math.max(1, Math.min(50, Math.round(Number(body.people) || 1)));
  const gross = amount(body.gross);
  const spent = Math.min(gross || amount(body.spent), amount(body.spent));
  const saved = Math.max(0, Math.round((gross - spent) * 100) / 100);
  const visitId = `VIS-CF-${crypto.randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase()}`;
  const now = new Date().toISOString();
  const socioId = socioIdFor(member);
  const record = {
    visitId,
    createdAt: now,
    socioId,
    integranteId: clean(member.integranteId, 100),
    visitorName: clean(member.name, 100),
    memberCode: clean(member.memberCode, 50),
    planName: clean(member.level, 60),
    planKey: clean(member.planKey, 30),
    allyId: ally.allyId,
    place: ally.name,
    category: ally.category,
    people,
    gross,
    spent,
    saved,
    benefit: clean(body.benefit, 180),
    dbSynced: false,
  };

  await env.PAYMENT_STATE.put(`visit:${visitId}`, JSON.stringify(record), { expirationTtl: 60 * 60 * 24 * 365 * 2 });
  if (clientVisitId) await env.PAYMENT_STATE.put(`visit-client:${clientVisitId}`, visitId, { expirationTtl: 60 * 60 * 24 * 30 });

  member.savings = amount(Number(member.savings || 0) + saved, 100000000);
  member.spent = amount(Number(member.spent || 0) + spent, 100000000);
  member.visits = Math.max(0, Math.round(Number(member.visits || 0))) + 1;
  member.lastVisit = now;
  await env.PAYMENT_STATE.put(`member:${verified.token}`, JSON.stringify(member));

  const metrics = await allyMetrics(env, ally.allyId);
  metrics.visits = Number(metrics.visits || 0) + 1;
  metrics.people = Number(metrics.people || 0) + people;
  metrics.gross = amount(Number(metrics.gross || 0) + gross, 100000000);
  metrics.sales = amount(Number(metrics.sales || 0) + spent, 100000000);
  metrics.savings = amount(Number(metrics.savings || 0) + saved, 100000000);
  metrics.lastVisit = now;
  await env.PAYMENT_STATE.put(`ally-metrics:${ally.allyId}`, JSON.stringify(metrics));

  try {
    await postDatabase(env, {
      action: "register_visit",
      visitId,
      socioId,
      integranteId: record.integranteId,
      visitorName: record.visitorName,
      memberCode: record.memberCode,
      planName: record.planName,
      allyId: ally.allyId,
      place: ally.name,
      category: ally.category,
      people,
      gross,
      spent,
      saved,
      benefit: record.benefit,
      notes: `Consumo normal ${gross.toFixed(2)} MXN · total pagado ${spent.toFixed(2)} MXN`,
    });
    record.dbSynced = true;
    await env.PAYMENT_STATE.put(`visit:${visitId}`, JSON.stringify(record), { expirationTtl: 60 * 60 * 24 * 365 * 2 });
  } catch (error) {
    console.error("ALIGN visit Google Sheets sync pending", error);
  }

  return json({ ok: true, visit: record, metrics }, 200, origin);
}

async function handleMetrics(request, env) {
  const origin = request.headers.get("origin") || "";
  const ally = allyFor(new URL(request.url).searchParams.get("allyId"));
  return json({ ok: true, ally, metrics: await allyMetrics(env, ally.allyId) }, 200, origin);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(request.headers.get("origin") || "") });
    try {
      if (url.pathname === "/api/ally/scan" && request.method === "POST") return await handleAllyScan(request, env);
      if (url.pathname === "/api/ally/visit" && request.method === "POST") return await handleRegisterVisit(request, env);
      if (url.pathname === "/api/ally/metrics" && request.method === "GET") return await handleMetrics(request, env);
    } catch (error) {
      console.error("ALIGN ally portal", error);
      return json({ ok: false, error: error?.message || "No fue posible procesar la visita." }, 400, request.headers.get("origin") || "");
    }
    return billingWorker.fetch(request, env);
  },
};
