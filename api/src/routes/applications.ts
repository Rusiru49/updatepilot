import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { Prisma } from "../generated/prisma/client";

const router = Router();

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
  const packageIds = items.map((a) => a.packageId).filter((p): p is string => !!p);
  const releases = await prisma.releaseMetadata.findMany({
    where: { packageId: { in: packageIds } },
    orderBy: { fetchedAt: "desc" },
  });
  const latest = new Map<string, string>();
  for (const r of releases) if (!latest.has(r.packageId)) latest.set(r.packageId, r.version);

  res.json({
    items: items.map((a) => {
      const availableVersion = a.packageId ? latest.get(a.packageId) ?? null : null;
      const updateStatus =
        a.matchStatus !== "MATCHED" ? "unsupported"
        : !availableVersion ? "unknown"
        : availableVersion !== a.installedVersion ? "update_available"
        : "up_to_date";

      return {
        id: a.id,
        displayName: a.displayName,
        publisher: a.publisher,
        installedVersion: a.installedVersion,
        availableVersion,
        packageId: a.packageId,
        source: a.source,
        matchStatus: a.matchStatus,
        updateStatus,
        lastSeenAt: a.lastSeenAt,
      };
    }),
    page,
    pageSize,
    total,
  });
});

export default router;