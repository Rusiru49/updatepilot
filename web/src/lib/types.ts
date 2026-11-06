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
  totals: { applications: number; updatesAvailable: number; upToDate: number; unsupported: number; unknown: number };
  lastScan: { id: string; state: string; appsFound: number | null; finishedAt: string | null } | null;
  activeScan: { id: string; state: JobState } | null;
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
    localId: string | null;
    versionUncertain: boolean;
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
    errorMessage: string | null;
  }[];
};

export type HistoryItem = {
  id: string;
  type: "scan" | "update";
  createdAt: string;
  state: JobState;
  device: string;
  target: string;
  details: string | null;
  error: string | null;
  exitCode?: number | null;
  verificationResult?: "PENDING" | "VERIFIED" | "MISMATCH" | "NOT_CHECKED";
};

export type Device = {
  id: string;
  deviceName: string;
  osVersion: string | null;
  agentVersion: string | null;
  status: "ONLINE" | "OFFLINE" | "REVOKED";
  lastSeenAt: string | null;
  pairedAt: string | null;
  createdAt: string;
  applicationCount: number;
};

export type UpdatePreview = {
  previewToken: string;
  expiresAt: string;
  application: { id: string; displayName: string; packageId: string; source: string };
  device: { id: string; deviceName: string; online: boolean };
  fromVersion: string;
  targetVersion: string;
  warnings: string[];
};

export type UpdateJobStatus = {
  id: string;
  state: JobState;
  applicationId: string;
  displayName: string;
  packageId: string | null;
  fromVersion: string;
  targetVersion: string;
  exitCode: number | null;
  verifiedVersion: string | null;
  verificationResult: "PENDING" | "VERIFIED" | "MISMATCH" | "NOT_CHECKED";
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};