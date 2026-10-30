import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth } from "../middleware/requireAuth";
import { getLatestVersions, getUpdateStatus } from "../lib/updates";
import { effectiveStatus } from "../lib/devices";

const router = Router();
router.use(requireAuth);

const querySchema = z.object({ deviceId: z.string().uuid().optional() });
const STALE_AFTER_MS = 24 * 60 * 60 * 1000; // scan older than 24 h = stale

// GET /api/v1/dashboard
router.get("/", async (req, res) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid deviceId" } });
    return;
  }
  const { deviceId } = parsed.data;
  const userId = req.user!.id;

  const device = await prisma.device.findFirst({
    where: { userId, ...(deviceId ? { id: deviceId } : {}) },
    orderBy: { createdAt: "asc" },
  });

  if (!device && deviceId) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Device not found" } });
    return;
  }

  // New user with no computer yet → the frontend shows the "empty" state
  if (!device) {
    res.json({
      device: null,
      totals: { applications: 0, updatesAvailable: 0, upToDate: 0, unsupported: 0 },
      lastScan: null,
      isStale: false,
      recentActivity: [],
    });
    return;
  }

  const apps = await prisma.application.findMany({
    where: { deviceId: device.id },
    select: { packageId: true, installedVersion: true, matchStatus: true },
  });
  const latest = await getLatestVersions(apps.map((a) => a.packageId).filter((p): p is string => !!p));

  let updatesAvailable = 0, upToDate = 0, unsupported = 0;
  for (const a of apps) {
    const status = getUpdateStatus(a.matchStatus, a.installedVersion, a.packageId ? latest.get(a.packageId) ?? null : null);
    if (status === "update_available") updatesAvailable++;
    else if (status === "up_to_date") upToDate++;
    else if (status === "unsupported") unsupported++;
  }

  const lastScan = await prisma.scanJob.findFirst({
    where: { deviceId: device.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, state: true, appsFound: true, startedAt: true, finishedAt: true, createdAt: true },
  });

  const recentActivity = await prisma.auditEvent.findMany({
    where: { OR: [{ actorUserId: userId }, { deviceId: device.id }] },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { id: true, eventType: true, targetType: true, targetId: true, createdAt: true },
  });

  res.json({
    device: {
      id: device.id,
      deviceName: device.deviceName,
      status: effectiveStatus(device),
      agentVersion: device.agentVersion,
      lastSeenAt: device.lastSeenAt,
    },
    totals: { applications: apps.length, updatesAvailable, upToDate, unsupported },
    lastScan,
    isStale: !lastScan?.finishedAt || Date.now() - lastScan.finishedAt.getTime() > STALE_AFTER_MS,
    recentActivity,
  });
});

export default router;