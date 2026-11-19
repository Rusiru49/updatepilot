import { Router, type Response } from "express";
import { z } from "zod";
import { prisma } from "../db";
import {
  SESSION_COOKIE,
  cookieOptions,
  createSession,
  deleteSession,
  hashPassword,
  sha256,
  verifyPassword,
  toPublicUser,
} from "../lib/auth";
import { requireAuth } from "../middleware/requireAuth";

const router = Router();

// One rule for every new password (sign-up and change-password)
const passwordRule = z.string().min(8, "Password must be at least 8 characters").max(72);

// One rule for the display name (sign-up and profile)
const displayNameRule = z.string().trim().min(1, "Enter your name").max(60, "Use 60 characters or fewer");

const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: passwordRule,
  displayName: displayNameRule,
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(72),
});

const profileSchema = z.object({
  displayName: displayNameRule,
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password").max(72),
  newPassword: passwordRule,
});

function sendValidationError(res: Response, error: z.ZodError) {
  res.status(400).json({
    error: {
      code: "VALIDATION_ERROR",
      // Show the first problem in words the user understands
      message: error.issues[0]?.message ?? "Invalid request",
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

  const { token, csrfToken } = await createSession(user.id);
  await prisma.auditEvent.create({ data: { actorUserId: user.id, eventType: "auth.register" } });

  res.cookie(SESSION_COOKIE, token, cookieOptions).status(201).json({ user: toPublicUser(user), csrfToken });
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

  const { token, csrfToken } = await createSession(user.id);
  await prisma.auditEvent.create({ data: { actorUserId: user.id, eventType: "auth.login" } });

  res.cookie(SESSION_COOKIE, token, cookieOptions).json({ user: toPublicUser(user), csrfToken });
});

// POST /api/v1/auth/logout
router.post("/logout", async (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) await deleteSession(token);
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.status(204).end();
});

// GET /api/v1/auth/me — the signed-in user (with "member since") and the page's CSRF token
router.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  res.json({ user: toPublicUser(user), csrfToken: req.csrfToken });
});

// PATCH /api/v1/auth/me — change your display name
router.patch("/me", requireAuth, async (req, res) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }

  const user = await prisma.user.update({
    where: { id: req.user!.id },
    data: { displayName: parsed.data.displayName },
  });
  await prisma.auditEvent.create({ data: { actorUserId: user.id, eventType: "auth.profile_updated" } });

  res.json({ user: toPublicUser(user) });
});

// POST /api/v1/auth/change-password — needs the current password; signs out your OTHER sessions
router.post("/change-password", requireAuth, async (req, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationError(res, parsed.error);
    return;
  }
  const { currentPassword, newPassword } = parsed.data;

  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    res.status(400).json({
      error: {
        code: "WRONG_PASSWORD",
        message: "Your current password is incorrect.",
        details: [{ field: "currentPassword", issue: "incorrect" }],
      },
    });
    return;
  }
  if (currentPassword === newPassword) {
    res.status(400).json({ error: { code: "SAME_PASSWORD", message: "Choose a password different from your current one." } });
    return;
  }

  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(newPassword) } });

  // Keep this browser signed in, sign out everywhere else (a stolen session stops working)
  const currentTokenHash = sha256(req.cookies[SESSION_COOKIE]);
  const ended = await prisma.session.deleteMany({
    where: { userId: user.id, NOT: { tokenHash: currentTokenHash } },
  });
  await prisma.auditEvent.create({ data: { actorUserId: user.id, eventType: "auth.password_changed" } });

  res.json({ ok: true, otherSessionsEnded: ended.count });
});

export default router;