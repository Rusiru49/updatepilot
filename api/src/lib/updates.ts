import { prisma } from "../db";

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


export function getUpdateStatus(
  matchStatus: string,
  installedVersion: string | null,
  availableVersion: string | null,
): UpdateStatus {
  if (matchStatus !== "MATCHED") return "unsupported";
  if (!installedVersion || !availableVersion) return "unknown";
  return availableVersion !== installedVersion ? "update_available" : "up_to_date";
}