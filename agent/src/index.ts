import { AGENT_VERSION, FIRST_RETRY_DELAY_MS, MAX_RETRY_DELAY_MS, POLL_INTERVAL_MS, UPLOAD_TIMEOUT_MS } from "./config";
import { ApiError, request } from "./http";
import { log } from "./log";
import { clearCredentials, loadCredentials, type Credentials } from "./store";
import { scanInstalledApps } from "./winget";

type Job = { id: string; type: string };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  if (!stopping) timer = setTimeout(tick, ms);
}

// Every 5 s: "I'm alive — is there any work for me?"
async function tick() {
  try {
    const res = await request<{ job: Job } | undefined>(creds.serverUrl, "/agent/jobs/next", {
      method: "POST",
      token: creds.agentToken,
      body: { agentVersion: AGENT_VERSION },
    });

    if (connected !== true) log(`Connected to ${creds.serverUrl} as "${creds.deviceName}" - waiting for work`);
    connected = true;
    retryDelay = FIRST_RETRY_DELAY_MS;

    if (res?.job) await runJob(res.job);
    schedule(POLL_INTERVAL_MS);
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

async function runJob(job: Job) {
  // Only known job types with a valid id. The server can't make the agent run anything else.
  if (job.type !== "scan" || !UUID_RE.test(job.id)) {
    log(`Ignored an unknown job (${String(job.type)})`);
    return;
  }

  log("Scan requested - running winget list...");
  try {
    const { apps, durationMs } = await scanInstalledApps();
    log(`Found ${apps.length} apps in ${(durationMs / 1000).toFixed(1)} s - sending results...`);

    await request(creds.serverUrl, `/agent/scans/${job.id}/results`, {
      method: "POST",
      token: creds.agentToken,
      body: { apps, durationMs },
      timeoutMs: UPLOAD_TIMEOUT_MS,
    });
    log("Scan results saved.");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) throw err; // handled in tick()

    const message = (err as Error).message;
    log(`Scan failed: ${message}`);
    await request(creds.serverUrl, `/agent/scans/${job.id}/fail`, {
      method: "POST",
      token: creds.agentToken,
      body: { error: message.slice(0, 500) },
    }).catch(() => log("Couldn't report the failure (the server will time the job out)."));
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

log(`UpdatePilot agent ${AGENT_VERSION} starting (checks for work every ${POLL_INTERVAL_MS / 1000} s, Ctrl+C to stop)`);
tick();