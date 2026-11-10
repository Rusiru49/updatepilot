"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { Device, UpdateItem, UpdatesResponse } from "@/lib/types";
import { formatDateTime } from "@/lib/format";
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton } from "@/components/ui";
import { JobStateBadge } from "@/components/StatusBadge";
import { UpdateDialog } from "@/components/UpdateDialog";

const fieldClass =
  "rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary-soft";

const ACTIVE_LABEL: Record<string, string> = {
  QUEUED: "Waiting for the agent…",
  SENT_TO_AGENT: "Waiting for the agent…",
  RUNNING: "Installing…",
  VERIFYING: "Verifying…",
};

export default function UpdatesPage() {
  const [data, setData] = useState<UpdatesResponse | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState<string | null>(null); // application id in the dialog

  // silent = refresh in the background without the loading skeleton
  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setError(null);
      try {
        setData(await api<UpdatesResponse>(`/updates${deviceId ? `?deviceId=${deviceId}` : ""}`));
      } catch (err) {
        if (!silent) setError(err instanceof ApiError ? err.message : "Something went wrong");
      } finally {
        setLoading(false);
      }
    },
    [deviceId],
  );

  useEffect(() => {
    load();
  }, [load]);

  // The user's computers, for the filter
  useEffect(() => {
    api<{ items: Device[] }>("/devices")
      .then((res) => setDevices(res.items.filter((d) => d.status !== "REVOKED")))
      .catch(() => setDevices([]));
  }, []);

  // While any update is running, refresh every 5 s
  const anyActive = !!data?.items.some((i) => i.activeJob);
  useEffect(() => {
    if (!anyActive) return;
    const timer = setInterval(() => load(true), 5000);
    return () => clearInterval(timer);
  }, [anyActive, load]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Updates</h1>
          <p className="text-sm text-muted">
            {data
              ? data.total === 0
                ? "Everything is up to date."
                : `${data.total} update${data.total === 1 ? "" : "s"} available`
              : "Apps with a newer version from a trusted source"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {devices.length > 1 && (
            <select
              aria-label="Filter by computer"
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              className={fieldClass}
            >
              <option value="">All computers</option>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.deviceName}
                </option>
              ))}
            </select>
          )}
          <Button variant="secondary" onClick={() => load()}>
            <RefreshCw size={16} aria-hidden /> Refresh
          </Button>
        </div>
      </header>

      {error ? (
        <ErrorState message={error} onRetry={() => load()} />
      ) : loading && !data ? (
        <Card className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </Card>
      ) : data && data.total === 0 ? (
        <EmptyState
          title="Everything is up to date"
          message="No trusted updates are available right now. Run a new scan from the Overview to check again."
          action={
            <Link href="/" className="text-sm font-semibold text-primary hover:underline">
              Go to Overview
            </Link>
          }
        />
      ) : data ? (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-background text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3 font-semibold">Application</th>
                  <th className="px-4 py-3 font-semibold">Computer</th>
                  <th className="px-4 py-3 font-semibold">Version</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">
                    <span className="sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <UpdateRow key={item.id} item={item} onReview={() => setReviewing(item.id)} />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {data && data.recent.length > 0 && (
        <Card>
          <h2 className="mb-3 font-semibold">Recent results</h2>
          <ul className="divide-y divide-border">
            {data.recent.map((r) => (
              <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
                <div className="min-w-0">
                  <Link href={`/applications/${r.applicationId}`} className="font-medium hover:text-primary hover:underline">
                    {r.displayName}
                  </Link>
                  <div className="font-mono text-xs text-muted">
                    {r.fromVersion} → {r.targetVersion} · {r.deviceName}
                  </div>
                  {r.state !== "SUCCEEDED" && r.errorMessage && (
                    <div className="mt-1 text-xs text-muted">{r.errorMessage}</div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-xs text-muted">{formatDateTime(r.finishedAt)}</span>
                  <JobStateBadge state={r.state} />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {reviewing && (
        <UpdateDialog applicationId={reviewing} onClose={() => setReviewing(null)} onFinished={() => load(true)} />
      )}
    </div>
  );
}

function UpdateRow({ item, onReview }: { item: UpdateItem; onReview: () => void }) {
  return (
    <tr className="border-t border-border align-top">
      <td className="px-4 py-3">
        <Link href={`/applications/${item.id}`} className="font-medium hover:text-primary hover:underline">
          {item.displayName}
        </Link>
        <div className="font-mono text-xs text-muted">{item.packageId}</div>
        {item.majorUpgrade && (
          <div className="mt-1">
            <Badge tone="warning">Major update</Badge>
          </div>
        )}
      </td>
      <td className="px-4 py-3">
        <div>{item.device.deviceName}</div>
        {!item.device.online && <div className="text-xs text-danger">Agent offline</div>}
      </td>
      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">
        {item.installedVersion} → <strong>{item.availableVersion}</strong>
      </td>
      <td className="px-4 py-3">
        {item.activeJob ? (
          <span className="inline-flex items-center gap-2 text-info" role="status">
            <Loader2 size={14} className="animate-spin" aria-hidden />
            {ACTIVE_LABEL[item.activeJob.state] ?? "In progress…"}
          </span>
        ) : item.lastAttempt?.state === "FAILED" ? (
          <span title={item.lastAttempt.errorMessage ?? undefined}>
            <Badge tone="danger">Last attempt failed</Badge>
          </span>
        ) : item.lastAttempt?.state === "RESTART_REQUIRED" ? (
          <Badge tone="warning">Restart pending</Badge>
        ) : (
          <Badge tone="info">Update available</Badge>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        <Button
          variant="secondary"
          className="px-3 py-1.5"
          onClick={onReview}
          disabled={!!item.activeJob}
          title={item.activeJob ? "An update for this app is already running" : undefined}
        >
          {item.lastAttempt?.state === "FAILED" ? "Try again" : "Review"}
        </Button>
      </td>
    </tr>
  );
}