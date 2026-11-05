import {
  AGENT_VERSION,
  FIRST_RETRY_DELAY_MS,
  HEARTBEAT_INTERVAL_MS,
  MAX_RETRY_DELAY_MS,
  POLL_INTERVAL_MS,
  UPLOAD_TIMEOUT_MS,
} from "./config";
import { describeExitCode, formatExitCode } from "./exitCodes";
import { ApiError, request } from "./http";
import { log } from "./log";
import { clearCredentials, loadCredentials, type Credentials } from "./store";
import {
  PACKAGE_ID_RE,
  scanInstalledApps,
  upgradePackage,
  verifyInstalledVersion,
  VERSION_RE,
} from "./winget";

// Jobs come from the server, so treat every field as untrusted
type Job = { id: string; type: string; packageId?: unknown; fromVersion?: unknown; targetVersion?: unknown };
type UpdateReport = { exitCode: number | null; restartRequired: boolean; verifiedVersion: string | null; error: string | null };

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

function post<T>(path: string, body: unknown, timeoutMs?: number) {
  return request<T>(creds.serverUrl, path, { method: "POST", token: creds.agentToken, body, timeoutMs });
}

function schedule(ms: number) {
  if (!stopping) timer = setTimeout(tick, ms);
}

// Every 5 s: "I'm alive — is there any work for me?"
async function tick() {
  try {
    const res = await post<{ job: Job } | undefined>("/agent/jobs/next", { agentVersion: AGENT_VERSION });

    if (connected !== true) log(`Connected to ${creds.serverUrl} as "${creds.deviceName}" - waiting for work`);
    connected = true;
    retryDelay = FIRST_RETRY_DELAY_MS;

    if (res?.job) await withKeepAlive(() => runJob(res.job));
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

// While a long job runs (an installer can take minutes), keep telling the
// server "I'm alive" so the computer doesn't look offline.
async function withKeepAlive(work: () => Promise<void>) {
  const keepAlive = setInterval(() => {
    post("/agent/heartbeat", { agentVersion: AGENT_VERSION }).catch(() => {});
  }, HEARTBEAT_INTERVAL_MS);
  try {
    await work();
  } finally {
    clearInterval(keepAlive);
  }
}

async function runJob(job: Job) {
  // Only known job types with a valid id. The server can't make the agent run anything else.
  if (!UUID_RE.test(job.id)) return log("Ignored a job with an invalid id");
  if (job.type === "scan") return runScan(job.id);
  if (job.type === "update") return runUpdate(job);
  log(`Ignored an unknown job type (${String(job.type)})`);
}

/* ───────────── Scan ───────────── */

async function runScan(jobId: string) {
  log("Scan requested - running winget list...");
  try {
    const { apps, durationMs } = await scanInstalledApps();
    log(`Found ${apps.length} apps in ${(durationMs / 1000).toFixed(1)} s - sending results...`);
    await post(`/agent/scans/${jobId}/results`, { apps, durationMs }, UPLOAD_TIMEOUT_MS);
    log("Scan results saved.");
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) throw err; // handled in tick()
    const message = (err as Error).message;
    log(`Scan failed: ${message}`);
    await post(`/agent/scans/${jobId}/fail`, { error: message.slice(0, 500) }).catch(() =>
      log("Couldn't report the failure (the server will time the job out)."),
    );
  }
}

/* ───────────── Update ───────────── */

async function runUpdate(job: Job) {
  const packageId = typeof job.packageId === "string" ? job.packageId : "";
  const target = typeof job.targetVersion === "string" ? job.targetVersion : "";
  const from = typeof job.fromVersion === "string" ? job.fromVersion : "?";

  // The agent checks the job itself — even if the server were tricked,
  // nothing unsafe is ever passed to winget.
  if (!PACKAGE_ID_RE.test(packageId) || !VERSION_RE.test(target)) {
    log("Rejected an unsafe update job (invalid package Id or version).");
    await report(job.id, {
      exitCode: null,
      restartRequired: false,
      verifiedVersion: null,
      error: "The agent rejected this update job (invalid package Id or version).",
    });
    return;
  }

  log(`Update requested: ${packageId} ${from} -> ${target}. Running winget upgrade...`);
  log("If Windows asks for administrator approval, answer the prompt on this computer.");

  let exitCode: number | null = null;
  let restartRequired = false;
  let error: string | null = null;

  try {
    const result = await upgradePackage(packageId, target);
    exitCode = result.exitCode;
    const info = describeExitCode(exitCode);
    restartRequired = info.outcome === "restart";
    if (info.outcome === "failed") error = result.output ? `${info.message}. WinGet said: ${result.output}` : info.message;
    log(`winget finished: ${info.message} (exit code ${formatExitCode(exitCode)})`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) throw err;
    error = (err as Error).message;
    log(`Update failed: ${error}`);
  }

  // Always verify with a fresh scan — never trust the installer alone
  await post(`/agent/updates/${job.id}/progress`, { state: "VERIFYING" }).catch(() => {});
  let verifiedVersion: string | null = null;
  try {
    verifiedVersion = await verifyInstalledVersion(packageId);
    log(`Verification: ${packageId} is now ${verifiedVersion ?? "not found"}`);
  } catch (err) {
    log(`Couldn't verify: ${(err as Error).message}`);
  }

  const saved = await report(job.id, { exitCode, restartRequired, verifiedVersion, error: error?.slice(0, 500) ?? null });
  if (saved) log(`Server recorded the update as: ${saved.state}`);
}

async function report(jobId: string, body: UpdateReport) {
  try {
    return await post<{ state: string }>(`/agent/updates/${jobId}/result`, body, UPLOAD_TIMEOUT_MS);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) throw err;
    log(`Couldn't report the result: ${(err as Error).message}`);
    return undefined;
  }
}

/* ───────────── Start / stop ───────────── */

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