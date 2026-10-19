#!/usr/bin/env node
/**
 * Local-only ALIGN ally portal for real-device Preview QA.
 * NEVER deploy. Reads the current portal UI, proxies ONLY whitelisted calls
 * to the isolated Cloudflare Preview Worker, and refuses live Stripe/DB modes.
 * A visit is a test record in Preview KV, NOT a real charge or payment.
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8765;
const LOCAL = "http://127.0.0.1:" + PORT;
const PREVIEW = "https://align-qr-pilot-align-payments.alignservice18.workers.dev";
const ROUTES = new Set([
  "/api/ally/login", "/api/ally/session", "/api/ally/scan",
  "/api/ally/visit", "/api/ally/metrics",
]);

function respond(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store",
    "x-content-type-options": "nosniff" });
  res.end(body);
}

async function previewIsSafe() {
  const r = await fetch(PREVIEW + "/api/health", {
    headers: { "cache-control": "no-cache" },
    signal: AbortSignal.timeout(12000),
  });
  const data = await r.json();
  return data.stripeMode === "test" &&
    data.storage === "kv-ready" &&
    data.reportingDb === "optional-unconfigured" &&
    data.qrSigningMode === "dedicated";
}

if (!await previewIsSafe()) {
  throw new Error("Preview no está aislado de Stripe Live/reportes; no se abrió el portal local.");
}

const original = readFileSync(resolve(ROOT, "portal-aliados.html"), "utf8");
const apiTag = "const API='https://api.alignmembers.com.mx/api';";
if (original.split(apiTag).length !== 2) {
  throw new Error("No se encontró la API esperada. No se abrirá un portal potencialmente conectado a producción.");
}
const warning = '<div style="position:sticky;top:0;z-index:10000;padding:12px;text-align:center;background:#375577;color:white;font:700 12px Arial,sans-serif;letter-spacing:.08em">ALIGN PREVIEW · PRUEBA SIN COBROS REALES · DATOS FICTICIOS</div>';
const portal = original.replace(apiTag, "const API='/api';")
  .replace("<body>", "<body>" + warning)
  .replace("<title>Aliados Comerciales | ALIGN</title>", "<title>ALIGN Preview | Portal de Aliados</title>");

const server = createServer(async (req, res) => {
  try {
    const host = req.headers.host || "";
    if (!["127.0.0.1:" + PORT, "localhost:" + PORT].includes(host)) {
      return respond(res, 403, "Acceso solo local");
    }
    const u = new URL(req.url || "/", LOCAL);
    if (req.method === "GET" && (u.pathname === "/" || u.pathname === "/portal-aliados-preview.html")) {
      return respond(res, 200, portal, "text/html; charset=utf-8");
    }
    if (req.method === "GET" && u.pathname === "/assets/align-wordmark.png") {
      return respond(res, 200, readFileSync(resolve(ROOT, "assets/align-wordmark.png")), "image/png");
    }
    if (req.method === "GET" && u.pathname === "/assets/align-primary.png") {
      return respond(res, 200, readFileSync(resolve(ROOT, "assets/align-primary.png")), "image/png");
    }
    if (!ROUTES.has(u.pathname) || !["GET", "POST"].includes(req.method || "")) {
      return respond(res, 404, "Ruta no disponible en prueba");
    }
    if (req.method === "POST" && req.headers.origin &&
        ![LOCAL, "http://localhost:" + PORT].includes(req.headers.origin)) {
      return respond(res, 403, "Origen no autorizado");
    }
    if (u.pathname === "/api/ally/visit" && !await previewIsSafe()) {
      return respond(res, 403, JSON.stringify({
        error: "La prueba se detuvo: Preview no está aislado de producción.",
      }), "application/json; charset=utf-8");
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 50_000) return respond(res, 413, "Solicitud demasiado grande");
      chunks.push(chunk);
    }
    const headers = {};
    if (req.headers["content-type"]) headers["content-type"] = req.headers["content-type"];
    if (req.headers.authorization) headers.authorization = req.headers.authorization;
    const upstream = await fetch(PREVIEW + u.pathname + u.search, {
      method: req.method,
      headers,
      ...(req.method === "POST" ? { body: Buffer.concat(chunks) } : {}),
      signal: AbortSignal.timeout(20000),
    });
    return respond(res, upstream.status, Buffer.from(await upstream.arrayBuffer()),
      upstream.headers.get("content-type") || "application/json; charset=utf-8");
  } catch (error) {
    // Never log QR URLs, session tokens, Authorization headers, or submitted payloads.
    console.error("Petición local fallida:", error?.name || "Error");
    return respond(res, 502, JSON.stringify({ error: "El servidor de prueba no respondió." }),
      "application/json; charset=utf-8");
  }
});
server.listen(PORT, "127.0.0.1", () => {
  console.log("✓ Portal de Aliados de PRUEBA disponible: " + LOCAL);
  console.log("✓ Servidor exclusivo: Cloudflare Preview. Stripe Test; sin sincronización real.");
  console.log("✓ Solo accesible desde esta Mac. Detener: Control+C.");
  console.log("✓ Registrar visita = consumo ficticio, nunca cargo bancario.");
});
