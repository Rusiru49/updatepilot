import { z } from "zod";
import { prisma } from "../db";
import { PACKAGE_ID_RE } from "./devices";

export const ACTIVE_SCAN_STATES = ["QUEUED", "SENT_TO_AGENT", "RUNNING"] as const;
export const JOB_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// What the agent is allowed to send for each app
export const scannedAppSchema = z.object({
  displayName: z.string().trim().min(1).max(300),
  localId: z.string().trim().min(1).max(300),
  packageId: z.string().max(128).nullable(),
  installedVersion: z.string().trim().min(1).max(100),
  availableVersion: z.string().trim().max(100).nullable(),
  source: z.string().trim().max(50).nullable(),
  matchStatus: z.enum(["MATCHED", "UNMATCHED", "UNSUPPORTED"]),
  versionUncertain: z.boolean(),
});

export const scanResultsSchema = z.object({
  apps: z.array(scannedAppSchema).max(5000),
  durationMs: z.number().int().min(0).max(3_600_000).optional(),
});

export type ScannedApp = z.infer<typeof scannedAppSchema>;

// Jobs that were never picked up, or never finished (agent crashed, PC turned off) → FAILED
export async function expireStaleScans(deviceId: string) {
  const cutoff = new Date(Date.now() - JOB_TIMEOUT_MS);
  await prisma.scanJob.updateMany({
    where: { deviceId, state: "QUEUED", createdAt: { lt: cutoff } },
    data: { state: "FAILED", finishedAt: new Date(), errorSummary: "The agent didn't pick up the scan (was it offline?)" },
  });
  await prisma.scanJob.updateMany({
    where: { deviceId, state: { in: ["SENT_TO_AGENT", "RUNNING"] }, startedAt: { lt: cutoff } },
    data: { state: "FAILED", finishedAt: new Date(), errorSummary: "The agent didn't finish the scan in time" },
  });
}

// Saves a finished scan: apps, version snapshots, latest known versions
export async function saveScanResults(scanJobId: string, deviceId: string, scanned: ScannedApp[]) {
  const now = new Date();

  // Re-check the trust rule on the server
  const apps = scanned.map((a) => {
    const trusted =
      a.matchStatus === "MATCHED" && a.source === "winget" && !!a.packageId && PACKAGE_ID_RE.test(a.packageId);
    const matchStatus: ScannedApp["matchStatus"] = trusted
      ? "MATCHED"
      : a.matchStatus === "MATCHED"
        ? "UNMATCHED"
        : a.matchStatus;
    return { ...a, packageId: trusted ? a.packageId : null, matchStatus };
  });

  return prisma.$transaction(
    async (tx) => {
      // Existing apps on this device, grouped by their winget Id
      const existing = await tx.application.findMany({
        where: { deviceId },
        select: { id: true, localId: true, installedVersion: true },
      });
      const pool = new Map<string, { id: string; installedVersion: string | null }[]>();
      for (const e of existing) {
        if (!e.localId) continue;
        const list = pool.get(e.localId) ?? [];
        list.push(e);
        pool.set(e.localId, list);
      }

      const seenIds: string[] = [];

      for (const a of apps) {
        // Same app as before? Prefer the row with the same version, otherwise any row with the same Id
        const candidates = pool.get(a.localId) ?? [];
        const sameVersion = candidates.findIndex((c) => c.installedVersion === a.installedVersion);
        const match = candidates.length > 0 ? candidates.splice(Math.max(0, sameVersion), 1)[0] : undefined;

        const data = {
          displayName: a.displayName,
          localId: a.localId,
          packageId: a.packageId,
          installedVersion: a.installedVersion,
          source: a.source,
          matchStatus: a.matchStatus,
          versionUncertain: a.versionUncertain,
          lastSeenAt: now,
          removedAt: null,
        };

        const app = match
          ? await tx.application.update({ where: { id: match.id }, data })
          : await tx.application.create({ data: { ...data, deviceId, firstSeenAt: now } });
        seenIds.push(app.id);

        // Version history
        await tx.appSnapshot.create({
          data: { scanJobId, applicationId: app.id, version: a.installedVersion, recordedAt: now },
        });

        // Latest known version (from winget): the available one, or the installed one if up to date
        if (a.packageId && !a.versionUncertain) {
          const latest = a.availableVersion ?? a.installedVersion;
          await tx.releaseMetadata.upsert({
            where: { packageId_version_source: { packageId: a.packageId, version: latest, source: "winget" } },
            create: { packageId: a.packageId, version: latest, source: "winget", channel: "stable", fetchedAt: now },
            update: { fetchedAt: now },
          });
        }
      }

      // Apps not found any more are hidden (history is kept)
      await tx.application.updateMany({
        where: { deviceId, removedAt: null, id: { notIn: seenIds } },
        data: { removedAt: now },
      });

      await tx.scanJob.update({
        where: { id: scanJobId },
        data: { state: "SUCCEEDED", finishedAt: now, appsFound: apps.length, errorSummary: null },
      });
      await tx.device.update({ where: { id: deviceId }, data: { lastSeenAt: now, status: "ONLINE" } });

      return apps.length;
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}