import shortQrWorker from "./entry-short-qr.js";

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

function validToken(value) {
  return /^[A-Za-z0-9_-]{20,}$/.test(value);
}

function publicCard(token, member) {
  return {
    token,
    name: clean(member?.name, 100),
    level: clean(member?.level, 60),
    planKey: clean(member?.planKey, 30),
    memberCode: clean(member?.memberCode, 60),
    status: clean(member?.status, 20),
    position: Math.max(1, Math.round(Number(member?.position) || 1)),
    photoUrl: String(member?.photoUrl || ""),
    savings: Math.max(0, Number(member?.savings || 0)),
  };
}

async function memberFromToken(env, token) {
  if (!env.PAYMENT_STATE || !validToken(token)) return null;
  const raw = await env.PAYMENT_STATE.get(`member:${token}`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) { return null; }
}

function expectedSeats(planKey) {
  if (planKey === "duo") return 2;
  if (planKey === "circle") return 3;
  return 1;
}

async function discoverGroupTokens(env, groupId, seats) {
  let cursor = undefined;
  const tokens = [];
  do {
    const page = await env.PAYMENT_STATE.list({ prefix: "member:", limit: 100, cursor });
    for (const key of page.keys || []) {
      const token = String(key.name || "").slice("member:".length);
      if (!validToken(token)) continue;
      const member = await memberFromToken(env, token);
      if (!member || clean(member.groupId, 100) !== groupId) continue;
      tokens.push(token);
      if (tokens.length >= seats) return tokens;
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return tokens;
}

async function groupTokens(env, groupId, seats) {
  const cacheKey = `group-index:${groupId}`;
  const cached = await env.PAYMENT_STATE.get(cacheKey);
  if (cached) {
    try {
      const tokens = JSON.parse(cached).filter(validToken);
      if (tokens.length >= seats) return tokens.slice(0, seats);
    } catch (_) {}
  }

  const tokens = await discoverGroupTokens(env, groupId, seats);
  if (tokens.length >= seats) {
    await env.PAYMENT_STATE.put(cacheKey, JSON.stringify(tokens.slice(0, seats)), {
      expirationTtl: 60 * 60 * 24 * 180,
    });
  }
  return tokens;
}

async function handleGroupCards(request, env) {
  const origin = request.headers.get("origin") || "";
  if (!env.PAYMENT_STATE) return json({ error: "PAYMENT_STATE no está conectado." }, 500, origin);

  const token = clean(new URL(request.url).searchParams.get("token"), 140);
  if (!validToken(token)) return json({ error: "Cuenta no válida." }, 400, origin);

  const requesting = await memberFromToken(env, token);
  if (!requesting) return json({ error: "Membresía no encontrada." }, 404, origin);
  if (requesting.status !== "Activa") return json({ error: "La membresía no está vigente." }, 403, origin);

  const self = publicCard(token, requesting);
  const planKey = clean(requesting.planKey, 30).toLowerCase();
  const seats = expectedSeats(planKey);
  const groupId = clean(requesting.groupId, 100);

  // A personal link belonging to member 2/3 remains personal. The primary
  // member can switch among all cards attached to the paid Duo/Circle group.
  if (seats === 1 || !groupId || Number(requesting.position || 1) !== 1) {
    return json({ ok: true, primary: self, cards: [self] }, 200, origin);
  }

  const tokens = await groupTokens(env, groupId, seats);
  const cards = [];
  for (const groupToken of tokens) {
    const member = await memberFromToken(env, groupToken);
    if (!member) continue;
    if (clean(member.groupId, 100) !== groupId || member.status !== "Activa") continue;
    cards.push(publicCard(groupToken, member));
  }

  if (!cards.some((card) => card.token === token)) cards.push(self);
  cards.sort((a, b) => a.position - b.position);
  const uniqueCards = cards.filter((card, index, list) => list.findIndex((item) => item.token === card.token) === index).slice(0, seats);
  const primary = uniqueCards.find((card) => card.position === 1) || uniqueCards[0] || self;

  return json({ ok: true, primary, cards: uniqueCards.length ? uniqueCards : [self] }, 200, origin);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS" && url.pathname === "/api/group-cards") {
      return new Response(null, { status: 204, headers: cors(request.headers.get("origin") || "") });
    }

    if (request.method === "GET" && url.pathname === "/api/group-cards") {
      try {
        return await handleGroupCards(request, env);
      } catch (error) {
        console.error("ALIGN group cards", error);
        return json({ error: error?.message || "No pudimos cargar tus tarjetas." }, 500, request.headers.get("origin") || "");
      }
    }

    return shortQrWorker.fetch(request, env);
  },
};
