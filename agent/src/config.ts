import os from "node:os";
import path from "node:path";

export const AGENT_VERSION = "0.1.0";

// Where the UpdatePilot API is (can be changed with an environment variable)
export const SERVER_URL = (process.env.UPDATEPILOT_SERVER ?? "http://localhost:4000").replace(/\/+$/, "");

export const HEARTBEAT_INTERVAL_MS = 30_000; // "I'm alive" every 30 s
export const REQUEST_TIMEOUT_MS = 10_000; // give up on a request after 10 s
export const FIRST_RETRY_DELAY_MS = 5_000; // when the server is down: 5 s, 10 s, 20 s ...
export const MAX_RETRY_DELAY_MS = 60_000; // ... up to 60 s
export const POLL_INTERVAL_MS = 5_000; // ask the server for work (and say "I'm alive") every 5 s
export const UPLOAD_TIMEOUT_MS = 60_000; // sending scan results can take longer

// Per-user folder, e.g. C:\Users\ASUS\AppData\Local\UpdatePilot
// (outside the project, so the key can never be committed to Git)
export const DATA_DIR = path.join(
  process.env.LOCALAPPDATA ?? path.join(os.homedir(), ".local", "share"),
  "UpdatePilot",
);
export const CREDENTIALS_FILE = path.join(DATA_DIR, "agent.json");

export function deviceName() {
  return os.hostname();
}

// Windows 11 still reports "Windows 10" in os.version(), so use the build number:
// build 22000 or higher = Windows 11
export function osVersion() {
  if (process.platform !== "win32") return `${os.type()} ${os.release()}`;
  const build = Number(os.release().split(".")[2] ?? 0);
  let name = os.version();
  if (build >= 22000) name = name.replace("Windows 10", "Windows 11");
  return `${name} (build ${build})`;
}