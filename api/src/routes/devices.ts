import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { sha256 } from "../lib/auth";
import { effectiveStatus, generatePairingCode, normalizeCode, PAIRING_CODE_TTL_MS } from "../lib/devices";
import { ACTIVE_SCAN_STATES, expireStaleScans } from "../lib/scans";
import { requireAuth } from "../middleware/requireAuth";

const router = Router();
router.use(requireAuth);

const idSchema = z.string().uuid();

// GET /api/v1/devices
router.get("/", async (req, res) => {
  const devices = await prisma.device.findMany({
    where: { userId: req.user!.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, deviceName: true, osVersion: true, agentVersion: true,
      status: true, lastSeenAt: true, pairedAt: true, createdAt: true,
      _count: { select: { applications: { where: { removedAt: null } } } },
    },
  });

  res.json({
    items: devices.map(({ _count, ...d }) => ({
      ...d,
      status: effectiveStatus(d),
      applicationCount: _count.applications,
    })),
  });
});

// POST /api/v1/devices/pairing-codes — one active code per user
router.post("/pairing-codes", async (req, res) => {
  const userId = req.user!.id;
  await prisma.pairingCode.deleteMany({ where: { userId, usedAt: null } });

  const code = generatePairingCode();
  const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS);
  await prisma.pairingCode.create({ data: { userId, codeHash: sha256(normalizeCode(code)), expiresAt } });
  await prisma.auditEvent.create({ data: { actorUserId: userId, eventType: "pairing_code.created" } });

  res.status(201).json({ code, expiresAt });
});

// POST /api/v1/devices/:id/scans — ask the agent to scan
router.post("/:id/scans", async (req, res) => {
  const id = idSchema.safeParse(req.params.id);
  if (!id.success) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid device id" } });
    return;
  }

  const device = await prisma.device.findFirst({ where: { id: id.data, userId: req.user!.id } });
  if (!device) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Device not found" } });
    return;
  }
  if (device.status === "REVOKED") {
    res.status(409).json({ error: { code: "DEVICE_REVOKED", message: "This device has been revoked. Pair it again first." } });
    return;
  }
  if (effectiveStatus(device) !== "ONLINE") {
    res.status(503).json({
      error: {
        code: "AGENT_OFFLINE",
        message: `The agent on ${device.deviceName} is offline. Start it on that computer, then try again.`,
      },
    });
    return;
  }

  await expireStaleScans(device.id);
  const active = await prisma.scanJob.findFirst({
    where: { deviceId: device.id, state: { in: [...ACTIVE_SCAN_STATES] } },
  });
  if (active) {
    res.status(409).json({
      error: { code: "SCAN_IN_PROGRESS", message: "A scan is already running", details: { scanJobId: active.id } },
    });
    return;
  }

  const scan = await prisma.scanJob.create({
    data: { deviceId: device.id, requestedById: req.user!.id, state: "QUEUED" },
  });
  await prisma.auditEvent.create({
    data: { actorUserId: req.user!.id, deviceId: device.id, eventType: "scan.requested", targetType: "scan", targetId: scan.id },
  });

  res.status(202).json({ scanJobId: scan.id, state: scan.state });
});

// DELETE /api/v1/devices/:id/credentials — revoke a device's agent
router.delete("/:id/credentials", async (req, res) => {
  const id = idSchema.safeParse(req.params.id);
  if (!id.success) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid device id" } });
    return;
  }

  const device = await prisma.device.findFirst({ where: { id: id.data, userId: req.user!.id } });
  if (!device) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Device not found" } });
    return;
  }

  await prisma.$transaction([
    prisma.agentCredential.updateMany({
      where: { deviceId: device.id, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
    prisma.device.update({ where: { id: device.id }, data: { status: "REVOKED" } }),
    prisma.auditEvent.create({
      data: { actorUserId: req.user!.id, deviceId: device.id, eventType: "device.revoked" },
    }),
  ]);

  res.status(204).end();
});

export default router;