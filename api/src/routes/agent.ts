import { Router } from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "../db";
import { sha256 } from "../lib/auth";
import { normalizeCode } from "../lib/devices";
import { requireAgent } from "../middleware/requireAgent";

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

export default router;