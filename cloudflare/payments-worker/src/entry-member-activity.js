import groupCardsWorker from "./entry-group-cards.js";

const ALLOWED_ORIGINS = new Set([
  "https://alignmembers.com.mx",
  "https://www.alignmembers.com.mx",
  "https://edgartikis.github.io",
]);

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
  return Response.json(body, {
    status,
    headers: { ...cors(origin), "cache-control": "no-store" },
  });
}

function clean(value, max = 200) {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .trim()
    .slice(0, max);
}

function amount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number * 100) / 100) : 0;
}

function validToken(value) {
  return /^[A-Za-z0-9_-]{20,}$/.test(value);
}

async function memberFromToken(env, token) {
  if (!env.PAYMENT_STATE || !validToken(token)) return null;
  const raw = await env.PAYMENT_STATE.get(`member:${token}`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) { return null; }
}

function sameMember(record, member) {
  const memberCode = clean(member?.memberCode, 60);
  const integranteId = clean(member?.integranteId, 100);
  return Boolean(
    (memberCode && clean(record?.memberCode, 60) === memberCode) ||
    (integranteId && clean(record?.integranteId, 100) === integranteId)
  );
}

async function memberVisits(env, member) {
  const visits = [];
  let cursor = undefined;
  let inspected = 0;

  do {
    const page = await env.PAYMENT_STATE.list({ prefix: "visit:", limit: 100, cursor });
    for (const key of page.keys || []) {
      inspected += 1;
      if (inspected > 2500) return visits;
      const raw = await env.PAYMENT_STATE.get(key.name);
      if (!raw) continue;
      let record;
      try { record = JSON.parse(raw); } catch (_) { continue; }
      if (record && sameMember(record, member)) visits.push(record);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  return visits;
}

function buildActivity(member, visits) {
  visits.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

  const places = new Map();
  let spentFromVisits = 0;
  let savingsFromVisits = 0;

  for (const visit of visits) {
    const spent = amount(visit.spent);
    const saved = amount(visit.saved);
    spentFromVisits += spent;
    savingsFromVisits += saved;
    const allyId = clean(visit.allyId, 30) || clean(visit.place, 100);
    const current = places.get(allyId) || {
      allyId: clean(visit.allyId, 30),
      place: clean(visit.place, 100) || "Aliado ALIGN",
      category: clean(visit.category, 100),
      visits: 0,
      spent: 0,
      savings: 0,
      lastVisit: "",
    };
    current.visits += 1;
    current.spent = amount(current.spent + spent);
    current.savings = amount(current.savings + saved);
    if (!current.lastVisit || new Date(visit.createdAt || 0) > new Date(current.lastVisit || 0)) current.lastVisit = visit.createdAt || "";
    places.set(allyId, current);
  }

  const favoritePlaces = [...places.values()]
    .sort((a, b) => b.visits - a.visits || b.spent - a.spent)
    .slice(0, 5);

  const recentVisits = visits.slice(0, 12).map((visit) => ({
    visitId: clean(visit.visitId, 100),
    createdAt: clean(visit.createdAt, 60),
    allyId: clean(visit.allyId, 30),
    place: clean(visit.place, 100) || "Aliado ALIGN",
    category: clean(visit.category, 100),
    spent: amount(visit.spent),
    saved: amount(visit.saved),
    gross: amount(visit.gross),
    benefit: clean(visit.benefit, 180),
  }));

  return {
    visits: Math.max(visits.length, Math.round(Number(member.visits || 0))),
    spent: amount(Math.max(spentFromVisits, Number(member.spent || 0))),
    savings: amount(Math.max(savingsFromVisits, Number(member.savings || 0))),
    lastVisit: clean(member.lastVisit || recentVisits[0]?.createdAt || "", 60),
    favoritePlaces,
    recentVisits,
  };
}

async function handleMemberActivity(request, env) {
  const origin = request.headers.get("origin") || "";
  if (!env.PAYMENT_STATE) return json({ error: "PAYMENT_STATE no está conectado." }, 500, origin);

  const token = clean(new URL(request.url).searchParams.get("token"), 140);
  if (!validToken(token)) return json({ error: "Cuenta no válida." }, 400, origin);

  const member = await memberFromToken(env, token);
  if (!member) return json({ error: "Membresía no encontrada." }, 404, origin);

  const visits = await memberVisits(env, member);
  const activity = buildActivity(member, visits);

  return json({
    ok: true,
    member: {
      name: clean(member.name, 100),
      memberCode: clean(member.memberCode, 60),
      planKey: clean(member.planKey, 30),
      level: clean(member.level, 60),
      position: Math.max(1, Math.round(Number(member.position) || 1)),
    },
    activity,
  }, 200, origin);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/member-activity" && request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(request.headers.get("origin") || "") });
    }

    if (url.pathname === "/api/member-activity" && request.method === "GET") {
      try {
        return await handleMemberActivity(request, env);
      } catch (error) {
        console.error("ALIGN member activity", error);
        return json({ error: error?.message || "No pudimos cargar tu actividad." }, 500, request.headers.get("origin") || "");
      }
    }

    return groupCardsWorker.fetch(request, env);
  },
};
