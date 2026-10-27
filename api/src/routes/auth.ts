import { Router, type Response } from "express";
import { z } from "zod";
import { prisma } from "../db";
import {
  SESSION_COOKIE,
  cookieOptions,
  createSession,
  deleteSession,
  hashPassword,
  verifyPassword,
  toPublicUser,
} from "../lib/auth";
import { requireAuth } from "../middleware/requireAuth";

const router = Router();

const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8, "Password must be at least 8 characters").max(72),
  displayName: z.string().trim().min(1).max(60),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(72),
});

function sendValidationError(res: Response, error: z.ZodError) {
  res.status(400).json({
    error: {
      code: "VALIDATION_ERROR",
      message: "Invalid request",
      details: error.issues.map((i) => ({ field: i.path.join("."), issue: i.message })),
    },
  });
}

// Used when the email doesn't exist, so the response time is the same either way
const dummyHash = hashPassword("not-a-real-password");

// POST /api/v1/auth/register
router.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }
  const { email, password, displayName } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    res.status(409).json({ error: { code: "EMAIL_TAKEN", message: "An account with this email already exists" } });
    return;
  }

  const user = await prisma.user.create({
    data: {
      email,
      displayName,
      passwordHash: await hashPassword(password),
      settings: { create: {} },
    },
  });

  const token = await createSession(user.id);
  await prisma.auditEvent.create({ data: { actorUserId: user.id, eventType: "auth.register" } });

  res.cookie(SESSION_COOKIE, token, cookieOptions).status(201).json({ user: toPublicUser(user) });
});

// POST /api/v1/auth/login
router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  const passwordOk = await verifyPassword(password, user?.passwordHash ?? (await dummyHash));

  if (!user || !passwordOk) {
    res.status(401).json({ error: { code: "INVALID_CREDENTIALS", message: "Email or password is incorrect" } });
    return;
  }

  const token = await createSession(user.id);
  await prisma.auditEvent.create({ data: { actorUserId: user.id, eventType: "auth.login" } });

  res.cookie(SESSION_COOKIE, token, cookieOptions).json({ user: toPublicUser(user) });
});

// POST /api/v1/auth/logout
router.post("/logout", async (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) await deleteSession(token);
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.status(204).end();
});

// GET /api/v1/auth/me
router.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;