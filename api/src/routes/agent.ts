import { Router } from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "../db";
import { sha256 } from "../lib/auth";
import { normalizeCode } from "../lib/devices";
import { requireAgent } from "../middleware/requireAgent";
import { expireStaleScans, saveScanResults, scanResultsSchema } from "../lib/scans";

const router = Router();

const pairSchema = z.object({
  code: z.string().trim().min(8).max(20),
  deviceName: z.string().trim().min(1).max(100),
  osVersion: z.string().trim().max(100).optional(),
  agentVersion: z.string().trim().max(50).optional(),
});

const INVALID_CODE = {
  error: {
    code: "INVALID_PAIRING_CODE",
    message: "This pairing code is invalid or has expired. Generate a new one in the dashboard.",
  },
};

// POST /api/v1/agent/pair — the agent swaps a one-time code for its own secret key
router.post("/pair", async (req, res) => {
  const parsed = pairSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid pairing request" } });
    return;
  }
  const { code, deviceName, osVersion, agentVersion } = parsed.data;

  const pairing = await prisma.pairingCode.findUnique({ where: { codeHash: sha256(normalizeCode(code)) } });
  if (!pairing || pairing.usedAt || pairing.expiresAt < new Date()) {
    res.status(400).json(INVALID_CODE);
    return;
  }

  const agentToken = `upa_${crypto.randomBytes(32).toString("base64url")}`;
  const now = new Date();

  const device = await prisma.$transaction(async (tx) => {
    // Claim the code atomically — if two agents race, only one wins
    const claimed = await tx.pairingCode.updateMany({
      where: { id: pairing.id, usedAt: null },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) return null;

    const d = await tx.device.create({
      data: { userId: pairing.userId, deviceName, osVersion, agentVersion, status: "ONLINE", pairedAt: now, lastSeenAt: now },
    });
    await tx.agentCredential.create({ data: { deviceId: d.id, credentialHash: sha256(agentToken) } });
    await tx.auditEvent.create({
      data: { actorUserId: pairing.userId, deviceId: d.id, eventType: "device.paired", metadata: { deviceName } },
    });
    return d;
  });

  if (!device) {
    res.status(400).json(INVALID_CODE);
    return;
  }

  // The token is shown ONCE. The server only keeps its hash.
  res.status(201).json({ deviceId: device.id, deviceName: device.deviceName, agentToken });
});

// ── Everything below needs a valid agent key ──
router.use(requireAgent);

// POST /api/v1/agent/heartbeat — "I'm still here"
router.post("/heartbeat", async (req, res) => {
  const parsed = z.object({ agentVersion: z.string().trim().max(50).optional() }).safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid heartbeat" } });
    return;
  }

  await prisma.device.update({
    where: { id: req.agent!.deviceId },
    data: {
      lastSeenAt: new Date(),
      status: "ONLINE",
      ...(parsed.data.agentVersion ? { agentVersion: parsed.data.agentVersion } : {}),
    },
  });
  res.status(204).end();
});

// GET /api/v1/agent/me — lets the agent check its key still works
router.get("/me", (req, res) => {
  res.json({ device: { id: req.agent!.deviceId, deviceName: req.agent!.deviceName } });
});

const jobIdSchema = z.string().uuid();

// POST /api/v1/agent/jobs/next — heartbeat + "is there any work for me?"
router.post("/jobs/next", async (req, res) => {
  const parsed = z.object({ agentVersion: z.string().trim().max(50).optional() }).safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid request" } });
    return;
  }
  const deviceId = req.agent!.deviceId;
  const now = new Date();

  await prisma.device.update({
    where: { id: deviceId },
    data: {
      lastSeenAt: now,
      status: "ONLINE",
      ...(parsed.data.agentVersion ? { agentVersion: parsed.data.agentVersion } : {}),
    },
  });
  await expireStaleScans(deviceId);

  const next = await prisma.scanJob.findFirst({ where: { deviceId, state: "QUEUED" }, orderBy: { createdAt: "asc" } });
  if (next) {
    // Claim it atomically, so the same job is never given out twice
    const claimed = await prisma.scanJob.updateMany({
      where: { id: next.id, state: "QUEUED" },
      data: { state: "RUNNING", startedAt: now },
    });
    if (claimed.count === 1) {
      res.json({ job: { id: next.id, type: "scan" } });
      return;
    }
  }
  res.status(204).end();
});

// POST /api/v1/agent/scans/:id/results — the agent sends what it found
router.post("/scans/:id/results", async (req, res) => {
  const id = jobIdSchema.safeParse(req.params.id);
  const body = scanResultsSchema.safeParse(req.body);
  if (!id.success || !body.success) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid scan results",
        details: body.success ? [] : body.error.issues.slice(0, 5).map((i) => ({ field: i.path.join("."), issue: i.message })),
      },
    });
    return;
  }

  const deviceId = req.agent!.deviceId;
  const job = await prisma.scanJob.findFirst({ where: { id: id.data, deviceId } });
  if (!job) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Scan not found" } });
    return;
  }
  if (job.state !== "RUNNING") {
    res.status(409).json({ error: { code: "JOB_NOT_RUNNING", message: `This scan is already ${job.state.toLowerCase()}` } });
    return;
  }

  const count = await saveScanResults(job.id, deviceId, body.data.apps);
  await prisma.auditEvent.create({
    data: {
      actorUserId: job.requestedById,
      deviceId,
      eventType: "scan.completed",
      targetType: "scan",
      targetId: job.id,
      metadata: { appsFound: count, durationMs: body.data.durationMs ?? null },
    },
  });
  res.status(204).end();
});

// POST /api/v1/agent/scans/:id/fail — the agent couldn't scan
router.post("/scans/:id/fail", async (req, res) => {
  const id = jobIdSchema.safeParse(req.params.id);
  const body = z.object({ error: z.string().trim().min(1).max(500) }).safeParse(req.body);
  if (!id.success || !body.success) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid request" } });
    return;
  }

  const deviceId = req.agent!.deviceId;
  const updated = await prisma.scanJob.updateMany({
    where: { id: id.data, deviceId, state: "RUNNING" },
    data: { state: "FAILED", finishedAt: new Date(), errorSummary: body.data.error },
  });
  if (updated.count === 0) {
    res.status(409).json({ error: { code: "JOB_NOT_RUNNING", message: "This scan is not running" } });
    return;
  }

  await prisma.auditEvent.create({
    data: { deviceId, eventType: "scan.failed", targetType: "scan", targetId: id.data, metadata: { error: body.data.error } },
  });
  res.status(204).end();
});

export default router;