import memberWorker from "./entry-member-login.js";

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

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}

function formatDateEs(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "America/Monterrey",
  }).format(date);
}

function validMemberToken(value) {
  return /^[A-Za-z0-9_-]{20,}$/.test(value);
}

function walletCodeFromPath(pathname) {
  const match = /^\/w\/(wm_[A-Za-z0-9_-]{24,80})$/.exec(pathname);
  return match ? match[1] : "";
}

function googleReady(env) {
  return Boolean(
    clean(env.GOOGLE_WALLET_ISSUER_ID, 80) &&
    clean(env.GOOGLE_WALLET_CLIENT_EMAIL, 180) &&
    String(env.GOOGLE_WALLET_PRIVATE_KEY || "").trim()
  );
}

function appleReady(env) {
  return Boolean(
    clean(env.APPLE_WALLET_SIGNER_URL, 500) &&
    String(env.APPLE_WALLET_SIGNER_SECRET || "").trim()
  );
}

function base64UrlBytes(bytes) {
  let binary = "";
  new Uint8Array(bytes).forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlJson(value) {
  return base64UrlBytes(new TextEncoder().encode(JSON.stringify(value)));
}

function pemToBytes(pem) {
  const normalized = String(pem || "").replace(/\\n/g, "\n").trim();
  const base64 = normalized
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  if (!base64) throw new Error("La clave privada de Google Wallet no está configurada.");
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function signRs256(privateKeyPem, signingInput) {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToBytes(privateKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );
  return base64UrlBytes(signature);
}

async function signedJwt(env, claims) {
  const header = { alg: "RS256", typ: "JWT" };
  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(claims)}`;
  const signature = await signRs256(env.GOOGLE_WALLET_PRIVATE_KEY, signingInput);
  return `${signingInput}.${signature}`;
}

async function downstreamJson(request, env, pathname) {
  const url = new URL(request.url);
  url.pathname = pathname;
  const forwarded = new Request(url.toString(), {
    method: "GET",
    headers: request.headers,
  });
  const response = await memberWorker.fetch(forwarded, env);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error || "No pudimos cargar la membresía.");
    error.status = response.status;
    throw error;
  }
  return data;
}

async function memberCardForToken(request, env, token) {
  const memberUrl = new URL(request.url);
  memberUrl.pathname = "/api/member-card";
  memberUrl.search = "";
  memberUrl.searchParams.set("token", token);
  const response = await memberWorker.fetch(
    new Request(memberUrl.toString(), { method: "GET", headers: request.headers }),
    env,
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error || "Membresía no encontrada.");
    error.status = response.status;
    throw error;
  }
  return data;
}

async function ensureWalletCode(env, token) {
  if (!env.PAYMENT_STATE) throw new Error("PAYMENT_STATE no está conectado.");
  const memberKey = `wallet-member:${token}`;
  const existing = clean(await env.PAYMENT_STATE.get(memberKey), 100);
  if (/^wm_[A-Za-z0-9_-]{24,80}$/.test(existing)) {
    const reverse = clean(await env.PAYMENT_STATE.get(`wallet-code:${existing}`), 160);
    if (reverse === token) return existing;
  }

  const code = `wm_${crypto.randomUUID().replace(/-/g, "")}`;
  await env.PAYMENT_STATE.put(memberKey, code);
  await env.PAYMENT_STATE.put(`wallet-code:${code}`, token);
  return code;
}

async function tokenForWalletCode(env, code) {
  if (!env.PAYMENT_STATE || !/^wm_[A-Za-z0-9_-]{24,80}$/.test(code)) return "";
  const token = clean(await env.PAYMENT_STATE.get(`wallet-code:${code}`), 160);
  return validMemberToken(token) ? token : "";
}

async function walletValidationUrl(request, env, token) {
  const code = await ensureWalletCode(env, token);
  const url = new URL(request.url);
  return `${url.origin}/w/${code}`;
}

async function walletContext(request, env) {
  const url = new URL(request.url);
  const token = clean(url.searchParams.get("token"), 140);
  if (!validMemberToken(token)) {
    const error = new Error("Tarjeta no válida.");
    error.status = 400;
    throw error;
  }

  const member = await memberCardForToken(request, env, token);
  if (!member?.active) {
    const error = new Error("La membresía no está vigente.");
    error.status = 403;
    throw error;
  }

  const validationUrl = await walletValidationUrl(request, env, token);
  return { token, member, validationUrl };
}

function localized(value) {
  return {
    defaultValue: {
      language: "es-MX",
      value: clean(value, 120),
    },
  };
}

function walletObjectSuffix(member) {
  const source = clean(member.memberCode, 80).toLowerCase().replace(/[^a-z0-9._-]/g, "_");
  return `align_${source || "member"}`;
}

async function googleWallet(request, env) {
  const origin = request.headers.get("origin") || "";
  if (!googleReady(env)) {
    return json({
      ok: false,
      configured: false,
      error: "Google Wallet aún no está configurado en el servidor.",
    }, 503, origin);
  }

  const { member, validationUrl } = await walletContext(request, env);
  const issuerId = clean(env.GOOGLE_WALLET_ISSUER_ID, 80);
  const clientEmail = clean(env.GOOGLE_WALLET_CLIENT_EMAIL, 180);
  const classId = `${issuerId}.align_membership`;
  const objectId = `${issuerId}.${walletObjectSuffix(member)}`;

  const genericClass = { id: classId };
  const genericObject = {
    id: objectId,
    classId,
    state: "ACTIVE",
    cardTitle: localized("ALIGN Membership"),
    header: localized(member.name || "Miembro ALIGN"),
    hexBackgroundColor: "#10233E",
    logo: {
      sourceUri: { uri: "https://alignmembers.com.mx/assets/align-primary.png" },
      contentDescription: localized("ALIGN"),
    },
    barcode: {
      type: "QR_CODE",
      value: validationUrl,
      alternateText: clean(member.memberCode, 60),
    },
    textModulesData: [
      {
        id: "membership",
        header: "MEMBRESÍA",
        body: clean(member.level || "ALIGN", 60),
      },
    ],
  };

  const claims = {
    iss: clientEmail,
    aud: "google",
    typ: "savetowallet",
    iat: Math.floor(Date.now() / 1000),
    origins: ["alignmembers.com.mx"],
    payload: {
      genericClasses: [genericClass],
      genericObjects: [genericObject],
    },
  };

  const token = await signedJwt(env, claims);
  return json({
    ok: true,
    configured: true,
    url: `https://pay.google.com/gp/v/save/${token}`,
  }, 200, origin);
}

async function appleWallet(request, env) {
  const origin = request.headers.get("origin") || "";
  if (!appleReady(env)) {
    return json({
      ok: false,
      configured: false,
      error: "Apple Wallet requiere conectar el certificado Pass Type ID de ALIGN.",
    }, 503, origin);
  }

  const { member, validationUrl } = await walletContext(request, env);
  const signerUrl = clean(env.APPLE_WALLET_SIGNER_URL, 500);
  const signerSecret = String(env.APPLE_WALLET_SIGNER_SECRET || "").trim();

  const response = await fetch(signerUrl, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${signerSecret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      organizationName: "ALIGN",
      description: "ALIGN Membership",
      foregroundColor: "rgb(255,255,255)",
      backgroundColor: "rgb(16,35,62)",
      labelColor: "rgb(217,198,165)",
      validityMode: "realtime",
      member: {
        name: clean(member.name, 100),
        level: clean(member.level, 60),
        memberCode: clean(member.memberCode, 60),
        joinedAt: clean(member.joinedAt, 60),
        photoUrl: String(member.photoUrl || ""),
      },
      barcode: {
        format: "PKBarcodeFormatQR",
        message: validationUrl,
        messageEncoding: "iso-8859-1",
        altText: clean(member.memberCode, 60),
      },
    }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    return json({
      ok: false,
      configured: true,
      error: payload?.error || "No pudimos crear el pase de Apple Wallet.",
    }, 502, origin);
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/vnd.apple.pkpass")) {
    return json({
      ok: false,
      configured: true,
      error: "El firmador de Apple Wallet no devolvió un pase válido.",
    }, 502, origin);
  }

  const headers = new Headers({
    ...cors(origin),
    "content-type": "application/vnd.apple.pkpass",
    "content-disposition": `attachment; filename="ALIGN-${clean(member.memberCode, 60)}.pkpass"`,
    "cache-control": "no-store",
  });
  return new Response(response.body, { status: 200, headers });
}

function walletValidationPage(member) {
  const active = Boolean(member?.active);
  const background = active
    ? "radial-gradient(circle at top,#245b43,#09130f 65%)"
    : "radial-gradient(circle at top,#653030,#160909 65%)";
  const validity = member
    ? `${formatDateEs(member.validFrom)} — ${formatDateEs(member.validUntil)}`
    : "";
  const body = active
    ? `<span class="status">Miembro activo</span>${member.photoUrl ? `<img class="photo" src="${escapeHtml(member.photoUrl)}" alt="Foto del socio">` : `<div class="photo fallback">${escapeHtml(String(member.name || "").charAt(0))}</div>`}<h1>${escapeHtml(member.name)}</h1><p class="level">ALIGN ${escapeHtml(member.level)}</p><p class="code">${escapeHtml(member.memberCode)}</p><p class="note">Verifica que la persona coincida con la foto antes de aplicar el beneficio.</p><p class="period">Vigencia actual ${escapeHtml(validity)}</p>`
    : `<span class="status">No válido</span><h1>Membresía no vigente</h1><p class="note">Esta tarjeta de Wallet no tiene una membresía activa en ALIGN en este momento.</p>`;

  return new Response(
    `<!doctype html><html lang="es-MX"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Validación ALIGN Wallet</title><style>*{box-sizing:border-box}body{min-height:100vh;margin:0;display:grid;place-items:center;padding:24px;background:${background};color:#f5f2ec;font-family:Arial,sans-serif}.card{width:min(100%,460px);padding:32px;border:1px solid rgba(255,255,255,.25);border-radius:24px;background:rgba(5,8,7,.72);text-align:center}.status{display:inline-block;padding:8px 12px;border:1px solid currentColor;border-radius:999px;text-transform:uppercase;letter-spacing:.12em;font-size:12px}h1{margin:22px 0 8px;font:500 42px Georgia,serif}.level{color:#d9c6a5;font-size:22px}.code{font-family:monospace;letter-spacing:.12em}.photo{width:132px;height:132px;margin:24px auto 0;border-radius:50%;object-fit:cover;border:3px solid #d9c6a5;background:#222}.fallback{display:grid;place-items:center;font-size:42px}.note{color:#c7c7c7;line-height:1.55}.period{color:#aaa;font-family:monospace;font-size:12px}</style></head><body><main class="card">${body}</main></body></html>`,
    {
      status: active ? 200 : 403,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    },
  );
}

async function handleWalletValidation(request, env, code) {
  const token = await tokenForWalletCode(env, code);
  if (!token) return walletValidationPage(null);
  try {
    const member = await memberCardForToken(request, env, token);
    return walletValidationPage(member);
  } catch (_) {
    return walletValidationPage(null);
  }
}

async function rewriteWalletQrRequest(request, env) {
  const body = await request.clone().json().catch(() => null);
  if (!body || typeof body !== "object" || !body.qr) return request;

  let url;
  try { url = new URL(String(body.qr || "").trim()); } catch (_) { return request; }
  const code = walletCodeFromPath(url.pathname);
  const allowedHost = url.hostname === "api.alignmembers.com.mx" || url.hostname.endsWith(".workers.dev");
  if (!code || !allowedHost) return request;

  const token = await tokenForWalletCode(env, code);
  if (!token) return request;

  const qrUrl = new URL(request.url);
  qrUrl.pathname = "/api/monthly-qr";
  qrUrl.search = "";
  qrUrl.searchParams.set("token", token);
  const qrResponse = await memberWorker.fetch(
    new Request(qrUrl.toString(), { method: "GET", headers: request.headers }),
    env,
  );
  const qr = await qrResponse.json().catch(() => ({}));
  if (!qrResponse.ok || !qr?.validationUrl) return request;

  const headers = new Headers(request.headers);
  headers.set("content-type", "application/json");
  headers.delete("content-length");
  return new Request(request.url, {
    method: request.method,
    headers,
    body: JSON.stringify({ ...body, qr: qr.validationUrl }),
  });
}

async function options(request, env) {
  const origin = request.headers.get("origin") || "";
  return json({
    ok: true,
    apple: { configured: appleReady(env) },
    google: { configured: googleReady(env) },
  }, 200, origin);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/wallet/") && request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(request.headers.get("origin") || "") });
    }

    try {
      if (url.pathname === "/api/wallet/options" && request.method === "GET") {
        return options(request, env);
      }
      if (url.pathname === "/api/wallet/google" && request.method === "GET") {
        return await googleWallet(request, env);
      }
      if (url.pathname === "/api/wallet/apple" && request.method === "GET") {
        return await appleWallet(request, env);
      }

      const walletCode = request.method === "GET" ? walletCodeFromPath(url.pathname) : "";
      if (walletCode) {
        return await handleWalletValidation(request, env, walletCode);
      }

      if (
        request.method === "POST" &&
        (url.pathname === "/api/ally/scan" || url.pathname === "/api/ally/visit")
      ) {
        const rewritten = await rewriteWalletQrRequest(request, env);
        return memberWorker.fetch(rewritten, env, ctx);
      }
    } catch (error) {
      console.error("ALIGN wallet", error);
      if (url.pathname.startsWith("/w/")) return walletValidationPage(null);
      const status = Number(error?.status || 500);
      return json(
        { ok: false, error: error?.message || "No pudimos preparar tu Wallet." },
        status >= 400 && status < 600 ? status : 500,
        request.headers.get("origin") || "",
      );
    }

    return memberWorker.fetch(request, env, ctx);
  },
};
