import type { Request, Response, NextFunction } from "express";
import { SESSION_COOKIE, csrfMatches, findSession } from "../lib/auth";

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; email: string; displayName: string };
      csrfToken?: string;
    }
  }
}

// Reading data never changes anything, so it doesn't need the CSRF token
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  const session = token ? await findSession(token) : null;

  if (!session) {
    res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Please log in" } });
    return;
  }

  // Changes (POST / PATCH / DELETE) must include this session's CSRF token.
  // Another website can make the browser send the cookie, but it can't read this token.
  if (!SAFE_METHODS.has(req.method) && !csrfMatches(req.get("x-csrf-token"), session.csrfToken)) {
    res.status(403).json({
      error: { code: "CSRF_FAILED", message: "This request was blocked for your security. Refresh the page and try again." },
    });
    return;
  }

  req.user = {
    id: session.user.id,
    email: session.user.email,
    displayName: session.user.displayName,
  };
  req.csrfToken = session.csrfToken;
  next();
}