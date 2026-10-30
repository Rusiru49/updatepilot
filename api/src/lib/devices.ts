import crypto from "node:crypto";

export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000; // codes expire after 10 minutes
export const ONLINE_WINDOW_MS = 2 * 60 * 1000; // no heartbeat for 2 minutes = offline

// No 0/O or 1/I, so codes are easy to read and type
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

// e.g. "K7QM-4R2X" (32^8 ≈ 1 trillion combinations)
export function generatePairingCode() {
  let s = "";
  for (let i = 0; i < 8; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

// Accepts "k7qm-4r2x", "K7QM4R2X", "K7QM 4R2X" ...
export const normalizeCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");

// Online/offline is worked out from the last heartbeat
export function effectiveStatus(device: { status: string; lastSeenAt: Date | null }) {
  if (device.status === "REVOKED") return "REVOKED" as const;
  const recent = device.lastSeenAt && Date.now() - device.lastSeenAt.getTime() < ONLINE_WINDOW_MS;
  return recent ? ("ONLINE" as const) : ("OFFLINE" as const);
}