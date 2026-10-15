import visitsWorker from "./entry-visits.js";

function clean(value, max = 200) {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .trim()
    .slice(0, max);
}

function cors(origin = "") {
  const allowed = new Set([
    "https://alignmembers.com.mx",
    "https://www.alignmembers.com.mx",
    "https://edgartikis.github.io",
  ]);
  return {
    "access-control-allow-origin": allowed.has(origin) ? origin : "https://alignmembers.com.mx",
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

async function rawDatabase(env, payload) {
  const url = String(env.ALIGN_DB_URL || "").trim();
  const secret = String(env.ALIGN_DB_SECRET || "").trim();
  if (!url || !secret) {
    return {
      configured: false,
      reachable: false,
      urlLooksLikeExec: /\/exec(?:$|[?#])/.test(url),
      status: 0,
      data: null,
      textKind: "missing-config",
    };
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...payload, mode: "ALIGN_PROD_2026", secret }),
      redirect: "follow",
    });
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch (_) {}
    return {
      configured: true,
      reachable: true,
      urlLooksLikeExec: /\/exec(?:$|[?#])/.test(url),
      status: response.status,
      data,
      textKind: data ? "json" : /^\s*</.test(text) ? "html" : "text",
    };
  } catch (error) {
    return {
      configured: true,
      reachable: false,
      urlLooksLikeExec: /\/exec(?:$|[?#])/.test(url),
      status: 0,
      data: null,
      textKind: "network-error",
      networkError: clean(error?.message || error, 180),
    };
  }
}

async function postDatabase(env, payload) {
  const result = await rawDatabase(env, payload);
  if (!result.configured) throw new Error("La sincronización con Google Sheets no está configurada.");
  if (!result.reachable) throw new Error(result.networkError || "No se pudo contactar Google Apps Script.");
  if (!result.data?.ok) {
    if (result.textKind === "html") throw new Error("Google Apps Script devolvió HTML en vez de JSON.");
    throw new Error(result.data?.error || "Google Sheets no confirmó el registro.");
  }
  return result.data;
}

async function retryPendingVisits(env, allyId) {
  if (!env.PAYMENT_STATE || !allyId) return 0;
  const normalizedAllyId = clean(allyId, 30).toUpperCase();
  if (!/^ALI-\d{3}$/.test(normalizedAllyId)) return 0;

  let cursor = undefined;
  let synced = 0;
  let inspected = 0;

  do {
    const page = await env.PAYMENT_STATE.list({ prefix: "visit:", limit: 100, cursor });
    for (const key of page.keys || []) {
      inspected += 1;
      if (inspected > 500) return synced;

      const raw = await env.PAYMENT_STATE.get(key.name);
      if (!raw) continue;

      let record;
      try { record = JSON.parse(raw); } catch (_) { continue; }
      if (!record || record.dbSynced === true || clean(record.allyId, 30).toUpperCase() !== normalizedAllyId) continue;

      try {
        await postDatabase(env, {
          action: "register_visit",
          visitId: clean(record.visitId, 100),
          socioId: clean(record.socioId, 100),
          integranteId: clean(record.integranteId, 100),
          visitorName: clean(record.visitorName, 100),
          memberCode: clean(record.memberCode, 60),
          planName: clean(record.planName, 60),
          allyId: clean(record.allyId, 30),
          place: clean(record.place, 100),
          category: clean(record.category, 100),
          people: Number(record.people || 1),
          gross: Number(record.gross || 0),
          spent: Number(record.spent || 0),
          saved: Number(record.saved || 0),
          benefit: clean(record.benefit, 180),
          notes: `Consumo normal ${Number(record.gross || 0).toFixed(2)} MXN · total pagado ${Number(record.spent || 0).toFixed(2)} MXN`,
        });

        record.dbSynced = true;
        record.dbSyncedAt = new Date().toISOString();
        delete record.dbSyncError;
        await env.PAYMENT_STATE.put(key.name, JSON.stringify(record), {
          expirationTtl: 60 * 60 * 24 * 365 * 2,
        });
        await env.PAYMENT_STATE.delete(`db-sync-error:${normalizedAllyId}`);
        synced += 1;
      } catch (error) {
        const message = clean(error?.message || error, 200);
        record.dbSyncError = message;
        await env.PAYMENT_STATE.put(key.name, JSON.stringify(record), {
          expirationTtl: 60 * 60 * 24 * 365 * 2,
        });
        await env.PAYMENT_STATE.put(`db-sync-error:${normalizedAllyId}`, JSON.stringify({
          at: new Date().toISOString(),
          visitId: record.visitId,
          error: message,
        }), { expirationTtl: 60 * 60 * 24 * 7 });
      }
    }

    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  return synced;
}

async function databaseHealth(request, env) {
  const origin = request.headers.get("origin") || "";
  const probe = await rawDatabase(env, { action: "__align_probe__" });
  const error = clean(probe.data?.error || probe.networkError || "", 180);
  const authorized = probe.data?.ok === true || error === "Acción no reconocida.";
  const authRejected = error === "Solicitud no autorizada.";
  return json({
    ok: true,
    configured: probe.configured,
    reachable: probe.reachable,
    urlLooksLikeExec: probe.urlLooksLikeExec,
    responseKind: probe.textKind,
    httpStatus: probe.status,
    authorized,
    authRejected,
    appsScriptMessage: error || null,
  }, 200, origin);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/api/db-health") {
      return databaseHealth(request, env);
    }

    if (request.method === "GET" && url.pathname === "/api/ally/metrics") {
      const allyId = url.searchParams.get("allyId") || "";
      try {
        await retryPendingVisits(env, allyId);
      } catch (error) {
        console.error("ALIGN pending visit sync retry", error);
      }
    }

    return visitsWorker.fetch(request, env);
  },
};
