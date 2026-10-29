import { Badge, type Tone } from "./ui";
import type { JobState, UpdateStatus } from "@/lib/types";

const UPDATE_STATUS: Record<UpdateStatus, { tone: Tone; label: string }> = {
  update_available: { tone: "info", label: "Update available" },
  up_to_date: { tone: "success", label: "Up to date" },
  unsupported: { tone: "neutral", label: "Unsupported" },
  unknown: { tone: "warning", label: "Unknown" },
};

export function UpdateStatusBadge({ status }: { status: UpdateStatus }) {
  const s = UPDATE_STATUS[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

const JOB_STATE: Record<JobState, { tone: Tone; label: string }> = {
  QUEUED: { tone: "info", label: "Queued" },
  SENT_TO_AGENT: { tone: "info", label: "Sent to agent" },
  RUNNING: { tone: "info", label: "Running" },
  VERIFYING: { tone: "info", label: "Verifying" },
  SUCCEEDED: { tone: "success", label: "Succeeded" },
  FAILED: { tone: "danger", label: "Failed" },
  CANCELLED: { tone: "neutral", label: "Cancelled" },
  RESTART_REQUIRED: { tone: "warning", label: "Restart required" },
};

export function JobStateBadge({ state }: { state: JobState }) {
  const s = JOB_STATE[state];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}