export type User = { id: string; email: string; displayName: string };

export type UpdateStatus = "update_available" | "up_to_date" | "unsupported" | "unknown";

export type AppItem = {
  id: string;
  displayName: string;
  publisher: string | null;
  installedVersion: string | null;
  availableVersion: string | null;
  packageId: string | null;
  source: string | null;
  matchStatus: "MATCHED" | "UNMATCHED" | "UNSUPPORTED";
  updateStatus: UpdateStatus;
  lastSeenAt: string;
};

export type Paged<T> = { items: T[]; page: number; pageSize: number; total: number };

export type Dashboard = {
  device: {
    id: string;
    deviceName: string;
    status: "ONLINE" | "OFFLINE" | "REVOKED";
    agentVersion: string | null;
    lastSeenAt: string | null;
  } | null;
  totals: { applications: number; updatesAvailable: number; upToDate: number; unsupported: number };
  lastScan: { id: string; state: string; appsFound: number | null; finishedAt: string | null } | null;
  isStale: boolean;
  recentActivity: { id: string; eventType: string; createdAt: string }[];
};

export type JobState =
  | "QUEUED" | "SENT_TO_AGENT" | "RUNNING" | "VERIFYING"
  | "SUCCEEDED" | "FAILED" | "CANCELLED" | "RESTART_REQUIRED";

export type AppDetails = {
  application: {
    id: string;
    displayName: string;
    publisher: string | null;
    installedVersion: string | null;
    packageId: string | null;
    source: string | null;
    matchStatus: AppItem["matchStatus"];
    updateStatus: UpdateStatus;
    firstSeenAt: string;
    lastSeenAt: string;
  };
  device: { id: string; deviceName: string; status: string };
  latestRelease: {
    version: string;
    channel: string | null;
    releaseDate: string | null;
    changelogUrl: string | null;
    source: string;
    fetchedAt: string;
  } | null;
  securityFindings: {
    advisoryId: string;
    severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "UNKNOWN";
    affectedRange: string | null;
    source: string;
    lastVerifiedAt: string;
  }[];
  versionHistory: { version: string; recordedAt: string; scanJobId: string }[];
  updateHistory: {
    id: string;
    fromVersion: string;
    targetVersion: string;
    state: JobState;
    verificationResult: "PENDING" | "VERIFIED" | "MISMATCH" | "NOT_CHECKED";
    exitCode: number | null;
    createdAt: string;
    finishedAt: string | null;
  }[];
};