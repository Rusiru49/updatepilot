import { Router } from "express";
import { prisma } from "../db";
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
    items: devices.map(({ _count, ...d }) => ({ ...d, applicationCount: _count.applications })),
  });
});

export default router;