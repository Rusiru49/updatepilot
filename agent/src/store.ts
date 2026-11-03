import fs from "node:fs";
import { CREDENTIALS_FILE, DATA_DIR } from "./config";

export type Credentials = {
  serverUrl: string;
  deviceId: string;
  deviceName: string;
  agentToken: string;
  pairedAt: string;
};

export function loadCredentials(): Credentials | null {
  try {
    const data = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, "utf8"));
    const valid =
      typeof data?.agentToken === "string" &&
      data.agentToken.startsWith("upa_") &&
      typeof data.deviceId === "string" &&
      typeof data.serverUrl === "string";
    return valid ? (data as Credentials) : null;
  } catch {
    return null; // file missing or damaged = not paired
  }
}

export function saveCredentials(credentials: Credentials) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  // Write to a temp file, then rename, so a crash can never leave a half-written file
  const tmp = `${CREDENTIALS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(credentials, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, CREDENTIALS_FILE);
}

export function clearCredentials() {
  fs.rmSync(CREDENTIALS_FILE, { force: true });
}