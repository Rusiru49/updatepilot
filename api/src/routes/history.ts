import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { Prisma } from "../generated/prisma/client";
import { requireAuth } from "../middleware/requireAuth";

const router = Router();
router.use(requireAuth);

const querySchema = z.object({
  type: z.enum(["all", "scan", "update"]).default("all"),
  deviceId: z.string().uuid().optional(),
  state: z
    .enum(["QUEUED", "SENT_TO_AGENT", "RUNNING", "VERIFYING", "SUCCEEDED", "FAILED", "CANCELLED", "RESTART_REQUIRED"])
    .optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// GET /api/v1/history
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
  const { type, deviceId, state, from, to, page, pageSize } = parsed.data;

  const device = { userId: req.user!.id, ...(deviceId ? { id: deviceId } : {}) };
  const createdAt = from || to ? { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } : undefined;

  const scanWhere: Prisma.ScanJobWhereInput = { device, ...(state ? { state } : {}), ...(createdAt ? { createdAt } : {}) };
  const updateWhere: Prisma.UpdateJobWhereInput = { device, ...(state ? { state } : {}), ...(createdAt ? { createdAt } : {}) };

  // Fetch enough rows from each table to build this page after merging
  const take = page * pageSize;

  const [scans, scanCount, updates, updateCount] = await Promise.all([
    type !== "update"
      ? prisma.scanJob.findMany({
          where: scanWhere, orderBy: { createdAt: "desc" }, take,
          include: { device: { select: { deviceName: true } } },
        })
      : [],
    type !== "update" ? prisma.scanJob.count({ where: scanWhere }) : 0,
    type !== "scan"
      ? prisma.updateJob.findMany({
          where: updateWhere, orderBy: { createdAt: "desc" }, take,
          include: { device: { select: { deviceName: true } }, application: { select: { displayName: true } } },
        })
      : [],
    type !== "scan" ? prisma.updateJob.count({ where: updateWhere }) : 0,
  ]);

  const items = [
    ...scans.map((s) => ({
      id: s.id,
      type: "scan" as const,
      createdAt: s.createdAt,
      state: s.state,
      device: s.device.deviceName,
      target: s.device.deviceName,
      details: s.appsFound != null ? `${s.appsFound} apps found` : null,
      error: s.errorSummary,
    })),
    ...updates.map((u) => ({
      id: u.id,
      type: "update" as const,
      createdAt: u.createdAt,
      state: u.state,
      device: u.device.deviceName,
      target: u.application.displayName,
      details: `${u.fromVersion} → ${u.targetVersion}`,
      exitCode: u.exitCode,
      verificationResult: u.verificationResult,
      error: u.errorMessage,
    })),
  ]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice((page - 1) * pageSize, page * pageSize);

  res.json({ items, page, pageSize, total: scanCount + updateCount });
});

export default router;