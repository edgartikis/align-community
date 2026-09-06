import visitsWorker from "./entry-visits.js";

function clean(value, max = 200) {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .trim()
    .slice(0, max);
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
  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || "Google Sheets no confirmó el registro.");
  }
  return data;
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
      await env.PAYMENT_STATE.put(key.name, JSON.stringify(record), {
        expirationTtl: 60 * 60 * 24 * 365 * 2,
      });
      synced += 1;
    }

    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  return synced;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

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
