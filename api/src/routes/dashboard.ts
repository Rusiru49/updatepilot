import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth } from "../middleware/requireAuth";
import { getLatestVersions, getUpdateStatus } from "../lib/updates";
import { effectiveStatus } from "../lib/devices";
import { ACTIVE_SCAN_STATES, expireStaleScans } from "../lib/scans";

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

  // A chosen device, or the most recently active one that isn't revoked
  const device = await prisma.device.findFirst({
    where: { userId, ...(deviceId ? { id: deviceId } : { status: { not: "REVOKED" } }) },
    orderBy: [{ lastSeenAt: { sort: "desc", nulls: "last" } }, { createdAt: "asc" }],
  });

  if (!device && deviceId) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Device not found" } });
    return;
  }

  // New user with no computer yet → the frontend shows the "empty" state
  if (!device) {
    res.json({
      device: null,
      totals: { applications: 0, updatesAvailable: 0, upToDate: 0, unsupported: 0, unknown: 0 },
      lastScan: null,
      activeScan: null,
      isStale: false,
      recentActivity: [],
    });
    return;
  }

  await expireStaleScans(device.id);

  const apps = await prisma.application.findMany({
    where: { deviceId: device.id, removedAt: null },
    select: { packageId: true, installedVersion: true, matchStatus: true },
  });
  const latest = await getLatestVersions(apps.map((a) => a.packageId).filter((p): p is string => !!p));

  let updatesAvailable = 0, upToDate = 0, unsupported = 0, unknown = 0;
  for (const a of apps) {
    const status = getUpdateStatus(a.matchStatus, a.installedVersion, a.packageId ? latest.get(a.packageId) ?? null : null);
    if (status === "update_available") updatesAvailable++;
    else if (status === "up_to_date") upToDate++;
    else if (status === "unsupported") unsupported++;
    else unknown++; // e.g. "> 3.14.7" — can't be compared reliably
  }

  const [lastScan, activeScan, recentActivity] = await Promise.all([
    prisma.scanJob.findFirst({
      where: { deviceId: device.id, state: "SUCCEEDED" },
      orderBy: { finishedAt: "desc" },
      select: { id: true, state: true, appsFound: true, startedAt: true, finishedAt: true, createdAt: true },
    }),
    prisma.scanJob.findFirst({
      where: { deviceId: device.id, state: { in: [...ACTIVE_SCAN_STATES] } },
      orderBy: { createdAt: "desc" },
      select: { id: true, state: true },
    }),
    prisma.auditEvent.findMany({
      where: { OR: [{ actorUserId: userId }, { deviceId: device.id }] },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, eventType: true, targetType: true, targetId: true, createdAt: true },
    }),
  ]);

  res.json({
    device: {
      id: device.id,
      deviceName: device.deviceName,
      status: effectiveStatus(device),
      agentVersion: device.agentVersion,
      lastSeenAt: device.lastSeenAt,
    },
    totals: { applications: apps.length, updatesAvailable, upToDate, unsupported, unknown },
    lastScan,
    activeScan,
    isStale: !lastScan?.finishedAt || Date.now() - lastScan.finishedAt.getTime() > STALE_AFTER_MS,
    recentActivity,
  });
});

export default router;