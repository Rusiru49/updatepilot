import { Router, type Response } from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "../db";
import { sha256 } from "../lib/auth";
import { effectiveStatus, PACKAGE_ID_RE } from "../lib/devices";
import { getLatestVersions } from "../lib/updates";
import { compareVersions, majorVersion } from "../lib/version";
import { requireAuth } from "../middleware/requireAuth";

const router = Router();
router.use(requireAuth);

export const PREVIEW_TTL_MS = 5 * 60 * 1000; // a preview is valid for 5 minutes
export const ACTIVE_UPDATE_STATES = ["QUEUED", "SENT_TO_AGENT", "RUNNING", "VERIFYING"] as const;

function fail(res: Response, status: number, code: string, message: string) {
  res.status(status).json({ error: { code, message } });
}

// POST /api/v1/updates/:id/preview   (:id = application id)
// Checks everything BEFORE anything is installed, and returns a one-time token.
router.post("/:id/preview", async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) return fail(res, 400, "VALIDATION_ERROR", "Invalid application id");

  const userId = req.user!.id;
  const app = await prisma.application.findFirst({
    where: { id: id.data, removedAt: null, device: { userId } }, // must be yours, and still installed
    include: { device: true },
  });
  if (!app) return fail(res, 404, "NOT_FOUND", "Application not found");

  if (app.device.status === "REVOKED") {
    return fail(res, 409, "DEVICE_REVOKED", "This computer has been revoked. Pair it again first.");
  }

  // Only trusted WinGet packages — never guess an update command
  if (app.matchStatus !== "MATCHED" || app.source !== "winget" || !app.packageId || !PACKAGE_ID_RE.test(app.packageId)) {
    return fail(res, 422, "UPDATE_NOT_SUPPORTED", "UpdatePilot can only update apps matched to a trusted WinGet package.");
  }
  if (app.versionUncertain || !app.installedVersion) {
    return fail(res, 422, "VERSION_UNKNOWN", `The installed version ("${app.installedVersion ?? "unknown"}") can't be compared reliably.`);
  }

  const latest = (await getLatestVersions([app.packageId])).get(app.packageId) ?? null;
  const cmp = latest ? compareVersions(latest, app.installedVersion) : null;
  if (!latest || cmp === null) {
    return fail(res, 422, "VERSION_UNKNOWN", "No reliable newer version is known for this app.");
  }
  if (cmp !== 1) {
    return fail(res, 409, "ALREADY_UP_TO_DATE", `${app.displayName} is already up to date (${app.installedVersion}).`);
  }

  const running = await prisma.updateJob.findFirst({
    where: { applicationId: app.id, state: { in: [...ACTIVE_UPDATE_STATES] } },
  });
  if (running) return fail(res, 409, "UPDATE_IN_PROGRESS", "An update for this app is already in progress.");

  // Things the user should know before confirming
  const warnings: string[] = [];
  const fromMajor = majorVersion(app.installedVersion);
  const toMajor = majorVersion(latest);
  if (fromMajor !== null && toMajor !== null && toMajor > fromMajor) {
    warnings.push(`This is a major version upgrade (${fromMajor} → ${toMajor}). It may change how the app works, so check the release notes first.`);
  }
  if (app.packageId === "Microsoft.AppInstaller") {
    warnings.push("This updates WinGet itself (App Installer). The agent may need to be restarted afterwards.");
  }
  warnings.push("Windows may ask for administrator approval on that computer.");
  warnings.push(`Close ${app.displayName} before updating, or the installer may fail.`);

  const agentOnline = effectiveStatus(app.device) === "ONLINE";
  if (!agentOnline) warnings.push(`The agent on ${app.device.deviceName} is offline. Start it before confirming.`);

  // One active preview per app per user; only the token's hash is stored
  await prisma.updatePreview.deleteMany({ where: { applicationId: app.id, userId, usedAt: null } });
  const token = `upp_${crypto.randomBytes(24).toString("base64url")}`;
  const expiresAt = new Date(Date.now() + PREVIEW_TTL_MS);
  await prisma.updatePreview.create({
    data: {
      tokenHash: sha256(token),
      userId,
      applicationId: app.id,
      packageId: app.packageId,
      fromVersion: app.installedVersion,
      targetVersion: latest,
      expiresAt,
    },
  });

  res.json({
    previewToken: token,
    expiresAt,
    application: { id: app.id, displayName: app.displayName, packageId: app.packageId, source: app.source },
    device: { id: app.device.id, deviceName: app.device.deviceName, online: agentOnline },
    fromVersion: app.installedVersion,
    targetVersion: latest,
    warnings,
  });
});

const executeSchema = z.object({
  previewToken: z.string().regex(/^upp_[A-Za-z0-9_-]{20,}$/),
  confirm: z.literal(true),
});
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{8,100}$/;

// POST /api/v1/updates/:id/execute   (:id = application id)
// Starts an update — ONLY with a valid, unused preview token the user just reviewed.
router.post("/:id/execute", async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  const body = executeSchema.safeParse(req.body);
  const key = req.get("idempotency-key") ?? "";
  if (!id.success || !body.success) {
    return fail(res, 400, "VALIDATION_ERROR", "A valid preview token and confirm: true are required");
  }
  if (!IDEMPOTENCY_KEY_RE.test(key)) {
    return fail(res, 400, "VALIDATION_ERROR", "A valid Idempotency-Key header is required");
  }
  const userId = req.user!.id;

  // The same request sent twice (double-click, network retry) → the same job, never two updates
  const existing = await prisma.updateJob.findUnique({ where: { idempotencyKey: key } });
  if (existing) {
    if (existing.requestedById !== userId || existing.applicationId !== id.data) {
      return fail(res, 409, "IDEMPOTENCY_CONFLICT", "This request key was already used for something else");
    }
    res.status(202).json({ updateJobId: existing.id, state: existing.state });
    return;
  }

  const preview = await prisma.updatePreview.findUnique({ where: { tokenHash: sha256(body.data.previewToken) } });
  if (!preview || preview.userId !== userId || preview.applicationId !== id.data) {
    return fail(res, 400, "INVALID_PREVIEW", "This confirmation is not valid. Review the update again.");
  }
  if (preview.usedAt || preview.expiresAt < new Date()) {
    return fail(res, 410, "PREVIEW_EXPIRED", "This confirmation has expired or was already used. Review the update again.");
  }

  const app = await prisma.application.findFirst({
    where: { id: id.data, removedAt: null, device: { userId } },
    include: { device: true },
  });
  if (!app) return fail(res, 404, "NOT_FOUND", "Application not found");
  if (app.device.status === "REVOKED") {
    return fail(res, 409, "DEVICE_REVOKED", "This computer has been revoked. Pair it again first.");
  }
  if (effectiveStatus(app.device) !== "ONLINE") {
    // The token is NOT used up, so the user can start the agent and confirm again
    return fail(res, 503, "AGENT_OFFLINE", `The agent on ${app.device.deviceName} is offline. Start it, then confirm again.`);
  }

  // Nothing may have changed since the user reviewed it
  if (
    app.packageId !== preview.packageId ||
    app.installedVersion !== preview.fromVersion ||
    !PACKAGE_ID_RE.test(preview.packageId)
  ) {
    return fail(res, 409, "VERSION_CHANGED", "This app changed since you reviewed the update. Review it again.");
  }

  // One update at a time per computer (installers clash)
  const busy = await prisma.updateJob.findFirst({
    where: { deviceId: app.deviceId, state: { in: [...ACTIVE_UPDATE_STATES] } },
  });
  if (busy) {
    return busy.applicationId === app.id
      ? fail(res, 409, "UPDATE_IN_PROGRESS", "An update for this app is already in progress.")
      : fail(res, 409, "DEVICE_BUSY", "Another update is running on this computer. Wait for it to finish.");
  }

  const now = new Date();
  const job = await prisma.$transaction(async (tx) => {
    // Use the token up atomically — it can never start two updates
    const claimed = await tx.updatePreview.updateMany({
      where: { id: preview.id, usedAt: null },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) return null;

    const created = await tx.updateJob.create({
      data: {
        applicationId: app.id,
        deviceId: app.deviceId,
        requestedById: userId,
        packageId: preview.packageId,
        fromVersion: preview.fromVersion,
        targetVersion: preview.targetVersion,
        state: "QUEUED",
        idempotencyKey: key,
        confirmedAt: now,
      },
    });
    await tx.auditEvent.create({
      data: {
        actorUserId: userId,
        deviceId: app.deviceId,
        eventType: "update.requested",
        targetType: "application",
        targetId: app.id,
        metadata: { packageId: preview.packageId, from: preview.fromVersion, to: preview.targetVersion },
      },
    });
    return created;
  });

  if (!job) return fail(res, 410, "PREVIEW_EXPIRED", "This confirmation was already used. Review the update again.");
  res.status(202).json({ updateJobId: job.id, state: job.state });
});

// GET /api/v1/updates/jobs/:id — live progress of one update (owner only)
router.get("/jobs/:id", async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) return fail(res, 400, "VALIDATION_ERROR", "Invalid update id");

  const job = await prisma.updateJob.findFirst({
    where: { id: id.data, device: { userId: req.user!.id } },
    include: { application: { select: { displayName: true } } },
  });
  if (!job) return fail(res, 404, "NOT_FOUND", "Update not found");

  res.json({
    id: job.id,
    state: job.state,
    applicationId: job.applicationId,
    displayName: job.application.displayName,
    packageId: job.packageId,
    fromVersion: job.fromVersion,
    targetVersion: job.targetVersion,
    exitCode: job.exitCode,
    verifiedVersion: job.verifiedVersion,
    verificationResult: job.verificationResult,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  });
});

export default router;