// Preview-gated, session-authorized native member data endpoints.
// The member's long-lived card token is accepted only in the JSON POST body,
// never in the externally requested URL. Legacy website routes are untouched.
import { appQrEnabled } from "./entry-app-qr.js";
import existingWorker from "./entry.js";

const ALLOWED_ORIGINS = new Set([
  "https://alignmembers.com.mx",
  "https://www.alignmembers.com.mx",
  "https://edgartikis.github.io",
]);
const TOKEN = /^[A-Za-z0-9_-]{20,140}$/;
const SESSION = /^Bearer\s+([A-Za-z0-9_-]{40,})$/i;
const ROUTES = new Map([
  ["/api/app-member-card", "/api/member-card"],
  ["/api/app-member-activity", "/api/member-activity"],
]);

function response(data, status = 200, origin = "") {
  const allowedOrigin = ALLOWED_ORIGINS.has(origin) ? origin : "https://alignmembers.com.mx";
  return Response.json(data, {
    status,
    headers: {
      "cache-control": "no-store",
      "access-control-allow-origin": allowedOrigin,
      "access-control-allow-methods": "POST,OPTIONS",
      "access-control-allow-headers": "authorization,content-type",
      vary: "Origin",
    },
  });
}
async function readRecord(env, key) {
  const raw = await env.PAYMENT_STATE.get(key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
export async function handleAppMemberPrivate(request, env) {
  const url = new URL(request.url);
  const target = ROUTES.get(url.pathname);
  if (!target) return null;
  const origin = request.headers.get("origin") || "";

  // Do not allow these native endpoints on live production without the
  // separately approved app-QR rollout.
  if (!appQrEnabled(env)) return response({ error: "Solo disponible en Preview." }, 404, origin);
  if (!env.PAYMENT_STATE) return response({ error: "Servicio no disponible." }, 503, origin);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: response({}, 200, origin).headers });
  }
  if (request.method !== "POST") return response({ error: "Método no permitido." }, 405, origin);

  const match = SESSION.exec(request.headers.get("authorization") || "");
  if (!match) return response({ error: "Debes iniciar sesión." }, 401, origin);
  const record = await readRecord(env, "member-session:" + match[1]);
  if (!record?.groupId || !Number.isFinite(Number(record.expiresAt)) ||
      Number(record.expiresAt) <= Date.now()) {
    return response({ error: "Tu sesión expiró. Inicia sesión nuevamente." }, 401, origin);
  }
  if (!(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) {
    return response({ error: "Solo se acepta JSON." }, 415, origin);
  }
  // Bound the JSON body to avoid unnecessarily large inputs to the Worker.
  const rawBody = await request.text();
  if (rawBody.length > 2048) return response({ error: "Solicitud demasiado grande." }, 413, origin);
  let body;
  try { body = JSON.parse(rawBody); } catch { return response({ error: "JSON no válido." }, 400, origin); }
  const token = String(body?.token || "");
  if (!TOKEN.test(token)) return response({ error: "Tarjeta no válida." }, 400, origin);

  const member = await readRecord(env, "member:" + token);
  if (!member) return response({ error: "Tarjeta no encontrada." }, 404, origin);
  if (member.groupId !== record.groupId) {
    return response({ error: "No tienes acceso a esta tarjeta." }, 403, origin);
  }
  const group = await readRecord(env, "group:" + record.groupId);
  if (!group || !Array.isArray(group.tokens) || !group.tokens.includes(token)) {
    return response({ error: "Esta tarjeta no pertenece a tu grupo." }, 403, origin);
  }

  // Reuse the existing canonical read logic only AFTER authorization. The
  // token below exists inside the Worker request and is not sent in an
  // external URL from the iPhone or written to analytics.
  const internal = new URL(target, request.url);
  internal.searchParams.set("token", token);
  const underlying = await existingWorker.fetch(new Request(internal, { method: "GET" }), env);
  const bodyResult = await underlying.json().catch(() => ({ error: "No pudimos cargar los datos." }));
  return response(bodyResult, underlying.status, origin);
}
