import memberActivityWorker from "./entry-member-activity.js";

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

function normalizeUsername(value) {
  return clean(value, 24)
    .toLowerCase()
    .replace(/\s+/g, ".")
    .replace(/\.{2,}/g, ".")
    .replace(/^\.+|\.+$/g, "");
}

function validUsername(value) {
  return /^[a-z0-9._-]{4,24}$/i.test(value);
}

function validHash(value) {
  return /^[a-f0-9]{64}$/.test(value);
}

function constantTimeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function readJson(env, key) {
  const raw = await env.PAYMENT_STATE.get(key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) { return null; }
}

async function accountFromSession(env, sessionId) {
  if (!sessionId) return null;
  const activation = await readJson(env, `activation:${sessionId}`);
  if (!activation?.groupId || !activation?.username) return null;

  const draftId = clean(await env.PAYMENT_STATE.get(`session:${sessionId}`), 100);
  if (!draftId) return null;
  const draft = await readJson(env, `draft:${draftId}`);
  const username = normalizeUsername(activation.username || draft?.username);
  const passwordHash = clean(draft?.passwordHash, 64).toLowerCase();
  if (!validUsername(username) || !validHash(passwordHash)) return null;

  const group = await readJson(env, `group:${activation.groupId}`);
  const tokens = Array.isArray(group?.tokens)
    ? group.tokens.filter((token) => /^[A-Za-z0-9_-]{20,}$/.test(String(token || "")))
    : Array.isArray(activation.members)
      ? activation.members.map((member) => member?.token).filter((token) => /^[A-Za-z0-9_-]{20,}$/.test(String(token || "")))
      : [];
  if (!tokens.length) return null;

  const account = {
    version: 1,
    username,
    passwordHash,
    groupId: activation.groupId,
    primaryToken: tokens[0],
    tokens,
    createdAt: activation.members?.[0]?.joinedAt || new Date().toISOString(),
  };
  await env.PAYMENT_STATE.put(`account:${username}`, JSON.stringify(account));
  return account;
}

async function migrateAccount(env, username) {
  const direct = await readJson(env, `account:${username}`);
  if (direct) return direct;

  let cursor = undefined;
  let inspected = 0;
  do {
    const page = await env.PAYMENT_STATE.list({ prefix: "activation:", limit: 100, cursor });
    for (const key of page.keys || []) {
      inspected += 1;
      if (inspected > 1500) return null;
      const activation = await readJson(env, key.name);
      if (!activation || normalizeUsername(activation.username) !== username) continue;
      const sessionId = clean(activation.sessionId || key.name.slice("activation:".length), 180);
      return await accountFromSession(env, sessionId);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return null;
}

async function cardsForAccount(env, account) {
  const group = await readJson(env, `group:${account.groupId}`);
  const tokens = Array.isArray(group?.tokens) && group.tokens.length ? group.tokens : account.tokens || [];
  const cards = [];
  for (const token of tokens) {
    const member = await readJson(env, `member:${token}`);
    if (!member) continue;
    cards.push({
      token,
      name: clean(member.name, 100),
      level: clean(member.level, 60),
      planKey: clean(member.planKey, 30),
      memberCode: clean(member.memberCode, 60),
      status: clean(member.status, 30),
      position: Math.max(1, Math.round(Number(member.position) || 1)),
      photoUrl: String(member.photoUrl || ""),
      savings: Math.max(0, Number(member.savings || 0)),
      groupId: clean(member.groupId || account.groupId, 100),
    });
  }
  cards.sort((a, b) => a.position - b.position);
  return cards;
}

async function handleLogin(request, env) {
  const origin = request.headers.get("origin") || "";
  if (!env.PAYMENT_STATE) return json({ error: "La base de miembros no está conectada." }, 503, origin);

  const body = await request.json().catch(() => ({}));
  const username = normalizeUsername(body.username);
  const passwordHash = clean(body.passwordHash, 64).toLowerCase();
  if (!validUsername(username) || !validHash(passwordHash)) {
    return json({ error: "Usuario o contraseña incorrectos." }, 401, origin);
  }

  const account = await migrateAccount(env, username);
  if (!account || !constantTimeEqual(clean(account.passwordHash, 64).toLowerCase(), passwordHash)) {
    return json({ error: "Usuario o contraseña incorrectos." }, 401, origin);
  }

  const cards = await cardsForAccount(env, account);
  if (!cards.length) return json({ error: "La membresía no tiene tarjetas disponibles." }, 404, origin);
  if (!cards.some((card) => card.status === "Activa")) {
    return json({ error: "La membresía no está activa. Revisa el estado de tu mensualidad." }, 403, origin);
  }

  const primary = cards.find((card) => card.position === 1) || cards[0];
  return json({
    ok: true,
    username,
    groupId: account.groupId,
    planKey: primary.planKey,
    planName: primary.level,
    primary,
    cards,
  }, 200, origin);
}

async function captureActivation(request, env) {
  const response = await memberActivityWorker.fetch(request, env);
  if (!response.ok) return response;
  try {
    const url = new URL(request.url);
    const sessionId = clean(url.searchParams.get("session_id"), 180);
    if (sessionId) await accountFromSession(env, sessionId);
  } catch (error) {
    console.error("ALIGN login account capture", error);
  }
  return response;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/member-login" && request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(request.headers.get("origin") || "") });
    }

    if (url.pathname === "/api/member-login" && request.method === "POST") {
      try {
        return await handleLogin(request, env);
      } catch (error) {
        console.error("ALIGN member login", error);
        return json({ error: "No pudimos iniciar sesión." }, 500, request.headers.get("origin") || "");
      }
    }

    if (url.pathname === "/api/activate-membership" && request.method === "GET") {
      return captureActivation(request, env);
    }

    return memberActivityWorker.fetch(request, env);
  },
};
