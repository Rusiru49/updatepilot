import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth } from "../middleware/requireAuth";

const router = Router();
router.use(requireAuth);

// GET /api/v1/scans/:id — progress of one scan (only for the owner)
router.get("/:id", async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid scan id" } });
    return;
  }

  const scan = await prisma.scanJob.findFirst({
    where: { id: id.data, device: { userId: req.user!.id } },
    select: {
      id: true, deviceId: true, state: true, appsFound: true, errorSummary: true,
      createdAt: true, startedAt: true, finishedAt: true,
    },
  });

  if (!scan) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Scan not found" } });
    return;
  }
  res.json(scan);
});

export default router;