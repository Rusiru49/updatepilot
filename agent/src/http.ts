import { AGENT_VERSION, REQUEST_TIMEOUT_MS } from "./config";

// The server answered with an error (e.g. 401 revoked, 400 bad code)
export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// The server could not be reached at all (down, no network, timeout)
export class NetworkError extends Error {}

export async function request<T>(
  serverUrl: string,
  path: string,
  options: { method?: string; token?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${serverUrl}/api/v1${path}`, {
      method: options.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": `UpdatePilotAgent/${AGENT_VERSION}`,
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const reason = (err as Error).name === "TimeoutError" ? "timed out" : "connection failed";
    throw new NetworkError(`Can't reach ${serverUrl} (${reason})`);
  }

  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, body?.error?.code ?? "UNKNOWN", body?.error?.message ?? `HTTP ${res.status}`);
  }
  return body as T;
}

// The agent key must never travel unencrypted: https only, except http://localhost for development
export function checkServerUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`"${raw}" is not a valid server address.`);
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol === "https:" || (url.protocol === "http:" && local)) return url.origin;
  throw new Error("The server address must start with https:// (http:// is only allowed for localhost).");
}