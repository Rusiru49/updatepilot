import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { sha256 } from "../lib/auth";
import { effectiveStatus, generatePairingCode, normalizeCode, PAIRING_CODE_TTL_MS } from "../lib/devices";
import { requireAuth } from "../middleware/requireAuth";

const router = Router();
router.use(requireAuth);

// GET /api/v1/devices
router.get("/", async (req, res) => {
  const devices = await prisma.device.findMany({
    where: { userId: req.user!.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, deviceName: true, osVersion: true, agentVersion: true,
      status: true, lastSeenAt: true, pairedAt: true, createdAt: true,
      _count: { select: { applications: true } },
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

// DELETE /api/v1/devices/:id/credentials — revoke a device's agent
router.delete("/:id/credentials", async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
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