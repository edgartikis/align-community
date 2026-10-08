// Apple Wallet integration gate. Intentionally fail closed until a signed
// .pkpass issuer and server-side credential storage are configured and tested.
// Never return member tokens, signing keys or certificate material to clients.
const headers = {
  "access-control-allow-origin": "https://alignmembers.com.mx",
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
};
export function walletRoute(request) {
  const url = new URL(request.url);
  if (url.pathname === "/api/wallet/status" && request.method === "GET") {
    return Response.json({
      ok: true,
      available: false,
      provider: "apple",
      reason: "awaiting-secure-pass-signing",
    }, { headers });
  }
  if (url.pathname === "/api/wallet/apple" && request.method === "GET") {
    return Response.json({
      error: "Apple Wallet aún no está disponible. Tu tarjeta digital ALIGN sigue funcionando.",
    }, { status: 503, headers });
  }
  return null;
}
