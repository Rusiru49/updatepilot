export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// The CSRF token for this login session. Kept in memory only (never in a cookie
// or localStorage), so other websites can't read it.
let csrfToken: string | null = null;

export function setCsrfToken(token: string | null) {
  csrfToken = token;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export async function api<T>(path: string, options: RequestInit = {}, retried = false): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();

  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      ...options,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        // Every change sends the token; reading data doesn't need it
        ...(csrfToken && !SAFE_METHODS.has(method) ? { "X-CSRF-Token": csrfToken } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "Can't reach the server. Check your connection.");
  }

  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => null);

  // Remember the token whenever the server sends one (login, sign-up, /auth/me)
  if (body && typeof body.csrfToken === "string") csrfToken = body.csrfToken;

  // Token missing or out of date: get a fresh one and try ONCE more
  if (res.status === 403 && body?.error?.code === "CSRF_FAILED" && !retried) {
    await api("/auth/me").catch(() => {});
    return api<T>(path, options, true);
  }

  if (!res.ok) {
    if (!body && res.status >= 500) {
      throw new ApiError(res.status, "SERVER_UNAVAILABLE", "The UpdatePilot server isn't responding. Is the API running?");
    }
    throw new ApiError(
      res.status,
      body?.error?.code ?? "UNKNOWN",
      body?.error?.message ?? "Something went wrong",
      body?.error?.details,
    );
  }

  return body as T;
}