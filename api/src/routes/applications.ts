import { requireAuth } from "../middleware/requireAuth";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { Prisma } from "../generated/prisma/client";
import { getLatestVersions, getUpdateStatus } from "../lib/updates";

const router = Router();
router.use(requireAuth); // every route in this file needs login

const querySchema = z.object({
  deviceId: z.string().uuid().optional(),
  search: z.string().trim().max(100).optional(),
  matchStatus: z.enum(["MATCHED", "UNMATCHED", "UNSUPPORTED"]).optional(),
  source: z.string().max(50).optional(),
  sort: z.enum(["displayName", "publisher", "lastSeenAt"]).default("displayName"),
  order: z.enum(["asc", "desc"]).default("asc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// GET /api/v1/applications
router.get("/", async (req, res) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid query parameters",
        details: parsed.error.issues.map((i) => ({ field: i.path.join("."), issue: i.message })),
      },
    });
    return;
  }

  const { deviceId, search, matchStatus, source, sort, order, page, pageSize } = parsed.data;

  const where: Prisma.ApplicationWhereInput = {
    device: { userId: req.user!.id },
    ...(deviceId ? { deviceId } : {}),
    ...(matchStatus ? { matchStatus } : {}),
    ...(source ? { source } : {}),
    ...(search
      ? {
          OR: [
            { displayName: { contains: search, mode: "insensitive" } },
            { publisher: { contains: search, mode: "insensitive" } },
            { packageId: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const orderBy = { [sort]: order } as Prisma.ApplicationOrderByWithRelationInput;

  const [total, items] = await prisma.$transaction([
    prisma.application.count({ where }),
    prisma.application.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize }),
  ]);

  // Find the newest known version for each package on this page
    const latest = await getLatestVersions(items.map((a) => a.packageId).filter((p): p is string => !!p));

  res.json({
    items: items.map((a) => {
      const availableVersion = a.packageId ? latest.get(a.packageId) ?? null : null;
      return {
        id: a.id,
        displayName: a.displayName,
        publisher: a.publisher,
        installedVersion: a.installedVersion,
        availableVersion,
        packageId: a.packageId,
        source: a.source,
        matchStatus: a.matchStatus,
        updateStatus: getUpdateStatus(a.matchStatus, a.installedVersion, availableVersion),
        lastSeenAt: a.lastSeenAt,
      };
    }),
    page,
    pageSize,
    total,
  });
});

// GET /api/v1/applications/:id
router.get("/:id", async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid application id" } });
    return;
  }

  const app = await prisma.application.findFirst({
    where: { id: id.data, device: { userId: req.user!.id } }, // must belong to this user
    include: {
      device: { select: { id: true, deviceName: true, status: true } },
      snapshots: {
        orderBy: { recordedAt: "desc" },
        take: 10,
        select: { version: true, recordedAt: true, scanJobId: true },
      },
      updateJobs: {
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true, fromVersion: true, targetVersion: true, state: true,
          verificationResult: true, exitCode: true, createdAt: true, finishedAt: true,
        },
      },
    },
  });

  // Same 404 whether it doesn't exist or belongs to someone else
  if (!app) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Application not found" } });
    return;
  }

  const latestRelease = app.packageId
    ? await prisma.releaseMetadata.findFirst({ where: { packageId: app.packageId }, orderBy: { fetchedAt: "desc" } })
    : null;

  const findings = app.packageId
    ? await prisma.securityFinding.findMany({ where: { packageId: app.packageId }, orderBy: { lastVerifiedAt: "desc" } })
    : [];

  res.json({
    application: {
      id: app.id,
      displayName: app.displayName,
      publisher: app.publisher,
      installedVersion: app.installedVersion,
      packageId: app.packageId,
      source: app.source,
      matchStatus: app.matchStatus,
      updateStatus: getUpdateStatus(app.matchStatus, app.installedVersion, latestRelease?.version ?? null),
      firstSeenAt: app.firstSeenAt,
      lastSeenAt: app.lastSeenAt,
    },
    device: app.device,
    latestRelease: latestRelease && {
      version: latestRelease.version,
      channel: latestRelease.channel,
      releaseDate: latestRelease.releaseDate,
      changelogUrl: latestRelease.changelogUrl,
      source: latestRelease.source,
      fetchedAt: latestRelease.fetchedAt,
    },
    securityFindings: findings.map((f) => ({
      advisoryId: f.advisoryId,
      severity: f.severity,
      affectedRange: f.affectedRange,
      source: f.source,
      lastVerifiedAt: f.lastVerifiedAt,
    })),
    versionHistory: app.snapshots,
    updateHistory: app.updateJobs,
  });
});

export default router;