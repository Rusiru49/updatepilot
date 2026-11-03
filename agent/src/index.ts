import { AGENT_VERSION, FIRST_RETRY_DELAY_MS, HEARTBEAT_INTERVAL_MS, MAX_RETRY_DELAY_MS } from "./config";
import { ApiError, request } from "./http";
import { log } from "./log";
import { clearCredentials, loadCredentials, type Credentials } from "./store";

function exitNotPaired(): never {
  console.error("Not paired. Run: npm run pair -- <PAIRING-CODE>");
  process.exit(1);
}

const creds: Credentials = loadCredentials() ?? exitNotPaired();

let stopping = false;
let timer: NodeJS.Timeout | undefined;
let retryDelay = FIRST_RETRY_DELAY_MS;
let connected: boolean | null = null; // null = not tried yet

function schedule(ms: number) {
  if (!stopping) timer = setTimeout(heartbeat, ms);
}

async function heartbeat() {
  try {
    await request(creds.serverUrl, "/agent/heartbeat", {
      method: "POST",
      token: creds.agentToken,
      body: { agentVersion: AGENT_VERSION },
    });

    if (connected !== true) log(`Connected to ${creds.serverUrl} as "${creds.deviceName}"`);
    connected = true;
    retryDelay = FIRST_RETRY_DELAY_MS;
    schedule(HEARTBEAT_INTERVAL_MS);
  } catch (err) {
    // Key revoked or invalid → stop for good
    if (err instanceof ApiError && err.status === 401) {
      log("This device's key was rejected (it may have been revoked in Settings).");
      log("The local key has been deleted. Pair again with: npm run pair -- <PAIRING-CODE>");
      clearCredentials();
      process.exit(1);
    }

    // Anything else (server down, timeout, 500, 429) → wait and try again
    if (connected !== false) log(`Server problem: ${(err as Error).message}`);
    connected = false;
    log(`Retrying in ${Math.round(retryDelay / 1000)} s...`);
    schedule(retryDelay);
    retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY_MS);
  }
}

function shutdown() {
  stopping = true;
  if (timer) clearTimeout(timer);
  log("Agent stopped.");
  process.exit(0);
}

process.on("SIGINT", shutdown); // Ctrl+C
process.on("SIGTERM", shutdown);

log(`UpdatePilot agent ${AGENT_VERSION} starting (heartbeat every ${HEARTBEAT_INTERVAL_MS / 1000} s, Ctrl+C to stop)`);
heartbeat();