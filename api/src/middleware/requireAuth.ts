import type { Request, Response, NextFunction } from "express";
import { SESSION_COOKIE, findSession } from "../lib/auth";

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; email: string; displayName: string };
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  const session = token ? await findSession(token) : null;

  if (!session) {
    res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Please log in" } });
    return;
  }

  req.user = {
    id: session.user.id,
    email: session.user.email,
    displayName: session.user.displayName,
  };
  next();
}