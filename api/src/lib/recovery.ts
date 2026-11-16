import { prisma } from "../db";
import { ACTIVE_SCAN_STATES } from "./scans";

// Jobs the agent has picked up but not finished
const IN_AGENT_STATES = ["SENT_TO_AGENT", "RUNNING"] as const;

// No heartbeat for this long while a job is running = the agent is gone.
// A bit longer than the 2-minute "online" window, so a slow moment doesn't fail a working job.
export const AGENT_LOST_MS = 3 * 60 * 1000;

export const RECOVERY_MESSAGES = {
  restarted: "The agent restarted while this job was running.",
  stopped: "The agent was stopped while this job was running.",
  lost: "The agent stopped responding (the PC may be asleep, off or offline).",
};
type Reason = keyof typeof RECOVERY_MESSAGES;

// Closes every job this device's agent had picked up, because the agent can't finish it any more.
export async function failInterruptedJobs(deviceId: string, reason: Reason) {
  const now = new Date();
  const base = RECOVERY_MESSAGES[reason];

  const scans = await prisma.scanJob.updateMany({
    where: { deviceId, status: { in: [...IN_AGENT_STATES] } },
    data: {
      status: "FAILED",
      errorMessage: `${base} Run a new scan.`, // CHECK: errorMessage on ScanJob
      finishedAt: now,                          // CHECK: finishedAt
    },
  });

  const updates = await prisma.updateJob.updateMany({
    where: { deviceId, status: { in: [...IN_AGENT_STATES] } },
    data: {
      status: "FAILED",
      errorMessage:
        reason === "restarted"
          ? `${base} The update may or may not have been installed. A check scan has been started to find out.`
          : `${base} The update may or may not have been installed. Run a scan when the agent is back to check.`,
      finishedAt: now, // CHECK
    },
  });

  // The agent is back right now, so find out what is really installed
  if (updates.count > 0 && reason === "restarted") {
    const active = await prisma.scanJob.findFirst({
      where: { deviceId, status: { in: [...ACTIVE_SCAN_STATES] } },
    });
    if (!active) {
      // CHECK: if TS asks for more fields, copy the "data" from your POST /devices/:id/scans route
      await prisma.scanJob.create({ data: { deviceId, status: "QUEUED" } });
    }
  }

  return { scans: scans.count, updates: updates.count };
}

// Finds devices that stopped sending heartbeats while running a job, and closes those jobs.
export async function failJobsOfLostAgents() {
  const cutoff = new Date(Date.now() - AGENT_LOST_MS);
  const lost = { status: { in: [...IN_AGENT_STATES] }, device: { lastSeenAt: { lt: cutoff } } }; // CHECK: lastSeenAt

  const [scans, updates] = await Promise.all([
    prisma.scanJob.findMany({ where: lost, select: { deviceId: true } }),
    prisma.updateJob.findMany({ where: lost, select: { deviceId: true } }),
  ]);

  const deviceIds = new Set([...scans, ...updates].map((j) => j.deviceId));
  for (const id of deviceIds) await failInterruptedJobs(id, "lost");
  return deviceIds.size;
}