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