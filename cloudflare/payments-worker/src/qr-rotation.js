// A dedicated 3-minute QR mode for the native iOS member card.
// The existing web card and Wallet-to-ally adapter keep the legacy 15-minute
// format/signature unchanged, even when the app mode is enabled.
export const WEB_ROTATION_MS = 15 * 60 * 1000;
export const IOS_ROTATION_MS = 3 * 60 * 1000;
export const IOS_QR_MODE = "3m";

export function parseQrRotation(value) {
  if (value === null || value === "") return "web";
  if (value === IOS_QR_MODE) return IOS_QR_MODE;
  return null; // Unknown modes never fall back to a weaker QR.
}

export function qrWindow(now = Date.now(), mode = "web") {
  if (mode !== "web" && mode !== IOS_QR_MODE) throw new Error("Modo de QR inválido.");
  const milliseconds = mode === IOS_QR_MODE ? IOS_ROTATION_MS : WEB_ROTATION_MS;
  const slot = Math.floor(now / milliseconds);
  return {
    slot,
    validFrom: new Date(slot * milliseconds).toISOString(),
    validUntil: new Date((slot + 1) * milliseconds).toISOString(),
  };
}

export function qrSignaturePayload(token, period, slot, mode = "web") {
  if (mode !== "web" && mode !== IOS_QR_MODE) throw new Error("Modo de QR inválido.");
  // IMPORTANT: The legacy payload must stay byte-for-byte identical.
  const original = `${token}:${period.validFrom}|${period.validUntil}:${slot}`;
  return mode === "web" ? original : `${original}:ios-3m`;
}
