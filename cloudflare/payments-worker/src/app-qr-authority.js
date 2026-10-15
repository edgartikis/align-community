// One strongly consistent QR authority per member.
// Cloudflare Durable Object requests for the same object id are routed to one
// logical instance. Storage transactions serialize competing rotations.
const WINDOW_MS = 15 * 60 * 1000;
const CODE_RE = /^A[A-Za-z0-9_-]{31}$/;
const ROUTE_RE = /^[A-Za-z0-9_-]{16}$/;
const windowSlot = (now) => Math.floor(now / WINDOW_MS);
const error = (message, status = 400) => Response.json({ error: message }, { status });

function newCode(route) {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const nonce = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "").slice(0, 15);
  return `A${route}${nonce}`;
}
function live(record, now) {
  return Boolean(record && CODE_RE.test(record.code) &&
    record.slot === windowSlot(now) && now >= record.createdAt &&
    Date.parse(record.validFrom) <= now && now < Date.parse(record.validUntil));
}
function sameCycle(state, body) {
  return Boolean(state && state.token === body.token &&
    state.validFrom === body.validFrom && state.validUntil === body.validUntil);
}
function createState(body, now) {
  return {
    token: body.token,
    validFrom: body.validFrom,
    validUntil: body.validUntil,
    code: newCode(body.route),
    slot: windowSlot(now),
    createdAt: now,
  };
}
function goodResponse(record) {
  return Response.json({ ok: true, record }, { headers: { "cache-control": "no-store" } });
}

export class AlignAppQrAuthority {
  constructor(ctx) { this.ctx = ctx; }

  async fetch(request) {
    if (request.method !== "POST") return error("Método no permitido.", 405);
    const body = await request.json().catch(() => null);
    const op = body?.op;
    const route = String(body?.route || "");
    if (!ROUTE_RE.test(route)) return error("Identificador de QR inválido.");
    if (op === "validate") {
      if (!CODE_RE.test(String(body.code || "")) || body.code.slice(1, 17) !== route)
        return Response.json({ ok: false });
      const current = await this.ctx.storage.get("current");
      return Response.json({
        ok: Boolean(live(current, Date.now()) && current.code === body.code),
        record: live(current, Date.now()) && current.code === body.code ? current : null,
      }, { headers: { "cache-control": "no-store" } });
    }
    if (op !== "current" && op !== "rotate") return error("Operación no reconocida.");

    const token = String(body?.token || "");
    const validFrom = String(body?.validFrom || "");
    const validUntil = String(body?.validUntil || "");
    if (!/^[A-Za-z0-9_-]{20,}$/.test(token) ||
        !Number.isFinite(Date.parse(validFrom)) || !Number.isFinite(Date.parse(validUntil)))
      return error("La membresía no es válida.");

    return this.ctx.storage.transaction(async (tx) => {
      const now = Date.now();
      if (!(Date.parse(validFrom) <= now && now < Date.parse(validUntil)))
        return error("La membresía no está vigente.", 403);
      const current = await tx.get("current");
      if (op === "rotate") {
        if (!CODE_RE.test(String(body.previousCode || "")) ||
            !live(current, now) || !sameCycle(current, body) ||
            current.code !== body.previousCode)
          return error("El QR ya fue renovado. Actualiza tu tarjeta.", 409);
      } else if (live(current, now) && sameCycle(current, body)) {
        return goodResponse(current);
      }

      const next = createState(body, now);
      await tx.put("current", next);
      return goodResponse(next);
    });
  }
}
