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
    "access-control-allow-methods": "GET,OPTIONS",
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

function validMemberToken(value) {
  return /^[A-Za-z0-9_-]{20,}$/.test(value);
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

async function walletContext(request, env) {
  const url = new URL(request.url);
  const token = clean(url.searchParams.get("token"), 140);
  if (!validMemberToken(token)) {
    const error = new Error("Tarjeta no válida.");
    error.status = 400;
    throw error;
  }

  const memberUrl = new URL(request.url);
  memberUrl.searchParams.set("token", token);
  const member = await downstreamJson(new Request(memberUrl, request), env, "/api/member-card");
  if (!member?.active) {
    const error = new Error("La membresía no está vigente.");
    error.status = 403;
    throw error;
  }

  const qrUrl = new URL(request.url);
  qrUrl.searchParams.set("token", token);
  const qr = await downstreamJson(new Request(qrUrl, request), env, "/api/monthly-qr");
  if (!qr?.validationUrl) {
    const error = new Error("No pudimos generar el QR vigente.");
    error.status = 500;
    throw error;
  }

  return { token, member, qr };
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

  const { member, qr } = await walletContext(request, env);
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
      value: qr.validationUrl,
      alternateText: clean(member.memberCode, 60),
    },
    textModulesData: [
      {
        id: "membership",
        header: "MEMBRESÍA",
        body: clean(member.level || "ALIGN", 60),
      },
      {
        id: "member_code",
        header: "CÓDIGO DE SOCIO",
        body: clean(member.memberCode, 60),
      },
      {
        id: "validity",
        header: "VIGENCIA",
        body: `${clean(qr.validFrom, 40)} — ${clean(qr.validUntil, 40)}`,
      },
    ],
  };

  const claims = {
    iss: clientEmail,
    aud: "google",
    typ: "savetowallet",
    iat: Math.floor(Date.now() / 1000),
    origins: ["alignmembers.com.mx", "www.alignmembers.com.mx"],
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

  const { member, qr } = await walletContext(request, env);
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
      member: {
        name: clean(member.name, 100),
        level: clean(member.level, 60),
        memberCode: clean(member.memberCode, 60),
        joinedAt: clean(member.joinedAt, 60),
        validFrom: clean(qr.validFrom, 60),
        validUntil: clean(qr.validUntil, 60),
        photoUrl: String(member.photoUrl || ""),
      },
      barcode: {
        format: "PKBarcodeFormatQR",
        message: qr.validationUrl,
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
    } catch (error) {
      console.error("ALIGN wallet", error);
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
