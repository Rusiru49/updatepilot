// Builds a server URL whether your saved address ends in /api/v1 or not
function agentUrl(serverUrl: string, path: string) {
  const base = serverUrl.replace(/\/+$/, "").replace(/\/api\/v1$/, "");
  return `${base}/api/v1/agent/${path}`;
}

// Tell the server we've just started, so it closes any job this PC was running
// before (the agent can't still be running it).
export async function announceStart(serverUrl: string, token: string) {
  try {
    const res = await fetch(agentUrl(serverUrl, "hello"), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const body = await res.json();
      const n = (body.closed?.scans ?? 0) + (body.closed?.updates ?? 0);
      if (n) console.log(`Closed ${n} job(s) left over from the last run.`);
    }
  } catch {
    // Server not reachable yet: its own 3-minute check will clean up
  }
}

// On Ctrl+C or when the window is closed, tell the server before exiting
export function installStopHandler(serverUrl: string, token: string) {
  let stopping = false;
  const stop = async (why: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`Stopping (${why})…`);
    try {
      await fetch(agentUrl(serverUrl, "goodbye"), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(3_000),
      });
    } catch {
      // Server not reachable: its own 3-minute check will clean up
    }
    process.exit(0);
  };
  process.on("SIGINT", () => void stop("Ctrl+C"));
  process.on("SIGTERM", () => void stop("stopped"));
  process.on("SIGHUP", () => void stop("window closed"));
}

// Retries sending important results if the server is down (network error or 5xx).
// Doesn't retry 4xx errors: those mean the server got the request and said no.
const RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000, 60_000];

export async function withRetry<T>(what: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = (err as { status?: number }).status;
      const clientError = typeof status === "number" && status >= 400 && status < 500;
      if (clientError || attempt >= RETRY_DELAYS_MS.length) throw err;
      const wait = RETRY_DELAYS_MS[attempt];
      console.log(`Couldn't send ${what} (${(err as Error).message}). Retrying in ${wait / 1000}s…`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}