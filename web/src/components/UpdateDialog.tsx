"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Loader2, RotateCcw } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { UpdateJobStatus, UpdatePreview } from "@/lib/types";
import { formatExitCode } from "@/lib/format";
import { Modal } from "./Modal";
import { Badge, Banner, Button, Skeleton } from "./ui";

const FINAL_STATES = ["SUCCEEDED", "FAILED", "CANCELLED", "RESTART_REQUIRED"];
const RETRYABLE_STATES = ["FAILED", "CANCELLED"];

const STEPS = [
  { label: "Queued", help: "Waiting for the agent to pick up the update" },
  { label: "Installing", help: "winget upgrade is running on the computer" },
  { label: "Verifying", help: "Rescanning to check the installed version" },
  { label: "Done", help: "Result saved to history" },
];

function stepIndex(state: string) {
  if (state === "QUEUED" || state === "SENT_TO_AGENT") return 0;
  if (state === "RUNNING") return 1;
  if (state === "VERIFYING") return 2;
  return 3;
}

export function UpdateDialog({
  applicationId,
  onClose,
  onFinished,
}: {
  applicationId: string;
  onClose: () => void;
  onFinished?: () => void; // e.g. reload the page after a finished update
}) {
  const [attempt, setAttempt] = useState(0); // goes up on "Try again"
  const [preview, setPreview] = useState<UpdatePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<UpdateJobStatus | null>(null);
  const [finishedOnce, setFinishedOnce] = useState(false); // any attempt finished → reload page on close

  // A new idempotency key for every attempt (the same key if Confirm is clicked twice)
  const idempotencyKey = useMemo(() => crypto.randomUUID(), [attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  // 1. Ask the server to check everything and prepare a one-time preview
  useEffect(() => {
    let cancelled = false;
    api<UpdatePreview>(`/updates/${applicationId}/preview`, { method: "POST" })
      .then((p) => !cancelled && setPreview(p))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : "Couldn't prepare the update"));
    return () => {
      cancelled = true;
    };
  }, [applicationId, attempt]);

    // Countdown until the preview expires (first tick right away, then every second)
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);

  // 3. Follow the update job every 2 s until it finishes
  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      try {
        const j = await api<UpdateJobStatus>(`/updates/jobs/${jobId}`);
        if (cancelled) return;
        setJob(j);
        if (FINAL_STATES.includes(j.state)) {
          setFinishedOnce(true);
          return; // finished — stop checking
        }
      } catch {
        /* temporary problem — keep checking */
      }
      if (!cancelled) timer = setTimeout(poll, 2000);
    }

    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId]);

  // 2. The user confirms → start the update with the one-time token
  async function confirm() {
    if (!preview) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await api<{ updateJobId: string; state: string }>(`/updates/${applicationId}/execute`, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ previewToken: preview.previewToken, confirm: true }),
      });
      setJobId(res.updateJobId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't start the update");
    } finally {
      setSubmitting(false);
    }
  }

  // Start over with a fresh confirmation (after a failure or an expired preview)
  function tryAgain() {
    setJobId(null);
    setJob(null);
    setPreview(null);
    setError(null);
    setAttempt((a) => a + 1);
  }

  const finished = !!job && FINAL_STATES.includes(job.state);
  const canRetry = !!job && RETRYABLE_STATES.includes(job.state);
  const secondsLeft =
    preview && now ? Math.max(0, Math.floor((new Date(preview.expiresAt).getTime() - now) / 1000)) : 0;
  const expired = !!preview && now > 0 && secondsLeft === 0; // now = 0 means "not ticked yet", not expired

  function close() {
    onClose();
    if (finishedOnce) onFinished?.();
  }

  const footer = !jobId ? (
    <>
      <Button variant="secondary" onClick={close}>
        Cancel
      </Button>
      {expired ? (
        <Button onClick={tryAgain}>
          <RotateCcw size={16} aria-hidden /> Refresh confirmation
        </Button>
      ) : (
        <Button onClick={confirm} disabled={!preview || submitting}>
          {submitting ? "Starting…" : "Confirm update"}
        </Button>
      )}
    </>
  ) : finished ? (
    <>
      <Button variant={canRetry ? "secondary" : "primary"} onClick={close}>
        Close
      </Button>
      {canRetry && (
        <Button onClick={tryAgain}>
          <RotateCcw size={16} aria-hidden /> Try again
        </Button>
      )}
    </>
  ) : (
    <Button variant="secondary" onClick={close} title="The update keeps running on the computer">
      Close (keeps running)
    </Button>
  );

  return (
    <Modal
      title={jobId ? `Updating ${preview?.application.displayName ?? "app"}` : "Confirm update"}
      onClose={close}
      footer={footer}
    >
      {jobId ? (
        <UpdateProgress job={job} finished={finished} />
      ) : !preview && !error ? (
        <div className="space-y-3" role="status" aria-label="Checking the update">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-5 w-3/4" />
        </div>
      ) : (
        <div className="space-y-4">
          {error && (
            <div role="alert">
              <Banner tone="danger">{error}</Banner>
            </div>
          )}

          {preview && (
            <>
              <p className="text-sm text-muted">
                Review the details below. The UpdatePilot agent on <strong>{preview.device.deviceName}</strong> will
                run this update.
              </p>

              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
                <dt className="text-muted">Application</dt>
                <dd className="font-semibold">{preview.application.displayName}</dd>
                <dt className="text-muted">Package ID</dt>
                <dd className="break-all font-mono text-xs leading-5">{preview.application.packageId}</dd>
                <dt className="text-muted">Version</dt>
                <dd className="font-mono text-xs leading-5">
                  {preview.fromVersion} → <strong>{preview.targetVersion}</strong>
                </dd>
                <dt className="text-muted">Source</dt>
                <dd>Windows Package Manager (winget)</dd>
                <dt className="text-muted">Computer</dt>
                <dd className="flex items-center gap-2">
                  {preview.device.deviceName}
                  <Badge tone={preview.device.online ? "success" : "danger"}>
                    {preview.device.online ? "Online" : "Offline"}
                  </Badge>
                </dd>
              </dl>

              {preview.warnings.length > 0 && (
                <ul className="space-y-2 rounded-lg bg-warning-soft p-4 text-sm text-warning">
                  {preview.warnings.map((w) => (
                    <li key={w} className="flex gap-2">
                      <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
                      <span>{w}</span>
                    </li>
                  ))}
                </ul>
              )}

              <p className="text-xs text-muted">
                {expired
                  ? "This confirmation has expired. Click Refresh confirmation to check the update again."
                  : `This confirmation is valid for ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}.`}
              </p>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

// What a screen reader says when the update moves to a new step
function announcement(job: UpdateJobStatus | null, finished: boolean) {
  if (!job) return "Update queued. Waiting for the agent.";
  if (!finished) return `${STEPS[stepIndex(job.state)].label}: ${STEPS[stepIndex(job.state)].help}.`;
  if (job.state === "SUCCEEDED") return `Update finished. ${job.displayName} is now on ${job.verifiedVersion}.`;
  if (job.state === "RESTART_REQUIRED") return "Update needs a restart to finish.";
  if (job.state === "CANCELLED") return "The update was cancelled.";
  return `The update didn't complete. ${job.errorMessage ?? ""}`;
}

function UpdateProgress({ job, finished }: { job: UpdateJobStatus | null; finished: boolean }) {
  const current = job ? stepIndex(job.state) : 0;
  const succeeded = job?.state === "SUCCEEDED";

  return (
    <div className="space-y-5">
      {/* Always present and hidden: reads out ONE short sentence whenever the step changes */}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement(job, finished)}
      </p>

      <ol className="space-y-3" aria-label="Update progress">
        {STEPS.map((s, i) => {
          const done = finished ? i < 3 || succeeded : i < current;
          const active = !finished && i === current;
          return (
            <li key={s.label} className="flex items-start gap-3" aria-current={active ? "step" : undefined}>
              <span
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold ${
                  done
                    ? "border-success bg-success text-surface"
                    : active
                      ? "border-primary text-primary"
                      : "border-border text-muted"
                }`}
                aria-hidden
              >
                {done ? (
                  <Check size={14} />
                ) : active ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  i + 1
                )}
              </span>
              <div>
                <div className={`text-sm ${active ? "font-semibold" : ""}`}>
                  {s.label}
                  {/* The tick and spinner are only pictures, so say it in words for screen readers */}
                  <span className="sr-only">{done ? " (done)" : active ? " (in progress)" : " (not started)"}</span>
                </div>
                <div className="text-xs text-muted">{s.help}</div>
              </div>
            </li>
          );
        })}
      </ol>

      {job && finished && (
        <>
          {job.state === "SUCCEEDED" && (
            <Banner tone="success">
              {job.displayName} was updated to <strong>{job.verifiedVersion}</strong> and verified by a rescan.
            </Banner>
          )}

          {job.state === "RESTART_REQUIRED" && (
            <Banner tone="warning">
              <p className="font-semibold">{job.errorMessage ?? "Windows needs a restart to finish the update."}</p>
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                <li>Save your work and restart the computer.</li>
                <li>Start the UpdatePilot agent again.</li>
                <li>Click Scan now to confirm {job.displayName} is on {job.targetVersion}.</li>
              </ol>
            </Banner>
          )}

          {job.state === "FAILED" && (
            <Banner tone="danger">
              <p className="font-semibold">The update didn&apos;t complete.</p>
              <p className="mt-1">
                {job.errorMessage ?? "The update failed."}
                {job.exitCode !== null && ` (exit code ${formatExitCode(job.exitCode)})`}
              </p>
              {job.verifiedVersion && (
                <p className="mt-1">Installed version now: {job.displayName} is on {job.verifiedVersion}.</p>
              )}
              <p className="mt-1">Fix the problem above, then click Try again.</p>
            </Banner>
          )}

          {job.state === "CANCELLED" && <Banner tone="neutral">The update was cancelled.</Banner>}
        </>
      )}

      {!finished && (
        <p className="text-xs text-muted">
          Keep the agent running. If Windows asks for administrator approval, answer the prompt on that computer.
        </p>
      )}
    </div>
  );
}