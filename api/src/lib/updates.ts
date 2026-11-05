import { prisma } from "../db";
import { compareVersions } from "./version";

export type UpdateStatus = "update_available" | "up_to_date" | "unsupported" | "unknown";


export async function getLatestVersions(packageIds: string[]) {
  const latest = new Map<string, string>();
  if (packageIds.length === 0) return latest;

  const releases = await prisma.releaseMetadata.findMany({
    where: { packageId: { in: packageIds } },
    orderBy: { fetchedAt: "desc" },
    select: { packageId: true, version: true },
  });
  for (const r of releases) if (!latest.has(r.packageId)) latest.set(r.packageId, r.version);
  return latest;
}


// Uses real version comparison: 1.10 is newer than 1.9, and an "available"
// version that is actually OLDER never counts as an update.
export function getUpdateStatus(
  matchStatus: string,
  installedVersion: string | null,
  availableVersion: string | null,
): UpdateStatus {
  if (matchStatus !== "MATCHED") return "unsupported";
  if (!installedVersion || !availableVersion) return "unknown";
  const c = compareVersions(availableVersion, installedVersion);
  if (c === null) return "unknown"; // can't compare safely → don't guess
  return c === 1 ? "update_available" : "up_to_date";
}

/* ───────────── Running updates (Week 4) ───────────── */

const QUEUE_TIMEOUT_MS = 10 * 60 * 1000; // not picked up in 10 min → failed
const RUN_TIMEOUT_MS = 20 * 60 * 1000; // not finished in 20 min → failed

// Updates the agent never picked up or never finished → FAILED, with a clear reason
export async function expireStaleUpdates(deviceId: string) {
  const now = Date.now();
  await prisma.updateJob.updateMany({
    where: { deviceId, state: "QUEUED", createdAt: { lt: new Date(now - QUEUE_TIMEOUT_MS) } },
    data: {
      state: "FAILED",
      finishedAt: new Date(),
      verificationResult: "NOT_CHECKED",
      errorMessage: "The agent didn't pick up the update (was it offline?)",
    },
  });
  await prisma.updateJob.updateMany({
    where: { deviceId, state: { in: ["SENT_TO_AGENT", "RUNNING", "VERIFYING"] }, startedAt: { lt: new Date(now - RUN_TIMEOUT_MS) } },
    data: {
      state: "FAILED",
      finishedAt: new Date(),
      verificationResult: "NOT_CHECKED",
      errorMessage: "The agent didn't finish the update in time. Run a new scan to check the installed version.",
    },
  });
}

export type UpdateResult = {
  exitCode: number | null;
  restartRequired: boolean;
  verifiedVersion: string | null; // what the agent's fresh scan found
  error: string | null;
};

const UPDATE_EVENT = {
  SUCCEEDED: "update.succeeded",
  FAILED: "update.failed",
  RESTART_REQUIRED: "update.restart_required",
} as const;

// The SERVER decides the outcome from the verified version — never from the installer alone
export async function saveUpdateResult(jobId: string, result: UpdateResult) {
  const job = await prisma.updateJob.findUniqueOrThrow({ where: { id: jobId } });

  const verified =
    !!result.verifiedVersion && (compareVersions(result.verifiedVersion, job.targetVersion) ?? -1) >= 0;

  let state: "SUCCEEDED" | "FAILED" | "RESTART_REQUIRED";
  let verification: "VERIFIED" | "PENDING" | "MISMATCH" | "NOT_CHECKED";
  let errorMessage: string | null = null;

  if (result.restartRequired) {
    state = "RESTART_REQUIRED";
    verification = verified ? "VERIFIED" : "PENDING";
    errorMessage = "Windows needs a restart to finish this update.";
  } else if (verified) {
    state = "SUCCEEDED";
    verification = "VERIFIED";
  } else if (result.exitCode === 0) {
    // The installer said "OK", but the new version isn't there
    state = "FAILED";
    verification = "MISMATCH";
    errorMessage = `The installer reported success, but version ${job.targetVersion} was not found afterwards${
      result.verifiedVersion ? ` (found ${result.verifiedVersion})` : ""
    }.`;
  } else {
    state = "FAILED";
    verification = result.verifiedVersion ? "MISMATCH" : "NOT_CHECKED";
    errorMessage = result.error ?? "The update failed.";
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.updateJob.update({
      where: { id: jobId },
      data: {
        state,
        verificationResult: verification,
        exitCode: result.exitCode,
        verifiedVersion: result.verifiedVersion,
        errorMessage,
        finishedAt: now,
      },
    });

    // Only a VERIFIED version changes what we show as installed
    if (verified && result.verifiedVersion) {
      await tx.application.update({
        where: { id: job.applicationId },
        data: { installedVersion: result.verifiedVersion, lastSeenAt: now },
      });
    }

    await tx.auditEvent.create({
      data: {
        actorUserId: job.requestedById,
        deviceId: job.deviceId,
        eventType: UPDATE_EVENT[state],
        targetType: "application",
        targetId: job.applicationId,
        metadata: {
          packageId: job.packageId,
          from: job.fromVersion,
          to: job.targetVersion,
          exitCode: result.exitCode,
          verifiedVersion: result.verifiedVersion,
        },
      },
    });
  });

  return state;
}