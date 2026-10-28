"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { AppItem, Dashboard, Paged } from "@/lib/types";
import { activityLabel, timeAgo } from "@/lib/format";
import { Banner, Button, Card, EmptyState, ErrorState, Skeleton, StatCard } from "@/components/ui";

export default function OverviewPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [updates, setUpdates] = useState<AppItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [dashboard, apps] = await Promise.all([
        api<Dashboard>("/dashboard"),
        api<Paged<AppItem>>("/applications?pageSize=100"),
      ]);
      setData(dashboard);
      setUpdates(apps.items.filter((a) => a.updateStatus === "update_available").slice(0, 5));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <OverviewSkeleton />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return null;

  // Empty state: no computer paired yet
  if (!data.device) {
    return (
      <EmptyState
        title="No computer connected yet"
        message="Install the UpdatePilot agent and pair your computer to see installed apps and available updates."
        action={
          <Button disabled title="Agent pairing is built in Week 3">
            Connect computer
          </Button>
        }
      />
    );
  }

  const online = data.device.status === "ONLINE";
  const isSample = data.device.agentVersion?.includes("sample") ?? false;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Overview</h1>
          <p className="text-sm text-muted">
            {data.device.deviceName} · last scan {timeAgo(data.lastScan?.finishedAt)}
          </p>
        </div>
        <Button variant="secondary" onClick={load}>
          <RefreshCw size={16} aria-hidden /> Refresh
        </Button>
      </header>

      {isSample && (
        <Banner tone="info">
          Showing <strong>sample data</strong>. These are not real scan results.
        </Banner>
      )}
      {data.isStale && (
        <Banner tone="warning">
          These results are more than 24 hours old. Versions may have changed since the last scan.
        </Banner>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Installed apps" value={data.totals.applications} hint={`${data.totals.upToDate} up to date`} />
        <StatCard
          label="Updates available"
          value={data.totals.updatesAvailable}
          hint="Ready to review"
          tone={data.totals.updatesAvailable > 0 ? "info" : "neutral"}
        />
        <StatCard label="Unsupported" value={data.totals.unsupported} hint="No trusted package match" />
        <StatCard
          label="Agent"
          value={online ? "Online" : "Offline"}
          hint={`Last seen ${timeAgo(data.device.lastSeenAt)}`}
          tone={online ? "success" : "danger"}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold">Updates available</h2>
            <Link href="/applications" className="text-sm font-medium text-primary hover:underline">
              View all apps
            </Link>
          </div>

          {updates.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">Everything is up to date.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                    <th className="py-2 pr-4 font-semibold">Application</th>
                    <th className="py-2 pr-4 font-semibold">Installed</th>
                    <th className="py-2 font-semibold">Available</th>
                  </tr>
                </thead>
                <tbody>
                  {updates.map((a) => (
                    <tr key={a.id} className="border-b border-border last:border-0">
                      <td className="py-3 pr-4">
                        <div className="font-medium">{a.displayName}</div>
                        <div className="text-xs text-muted">{a.publisher ?? "Unknown publisher"}</div>
                      </td>
                      <td className="py-3 pr-4 font-mono text-xs">{a.installedVersion}</td>
                      <td className="py-3 font-mono text-xs font-semibold">{a.availableVersion}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <h2 className="mb-2 font-semibold">Next action</h2>
            <p className="mb-4 text-sm text-muted">
              {online
                ? "Run a new scan to refresh installed versions."
                : "The agent is offline. Scanning will be available once the agent is connected."}
            </p>
            <Button disabled title="Scanning is built in Week 3">
              Scan now
            </Button>
          </Card>

          <Card>
            <h2 className="mb-3 font-semibold">Recent activity</h2>
            {data.recentActivity.length === 0 ? (
              <p className="text-sm text-muted">No activity yet.</p>
            ) : (
              <ul className="space-y-3">
                {data.recentActivity.map((e) => (
                  <li key={e.id} className="flex items-start gap-3 text-sm">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-success" aria-hidden />
                    <div>
                      <div>{activityLabel(e.eventType)}</div>
                      <div className="text-xs text-muted">{timeAgo(e.createdAt)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading overview">
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Skeleton className="h-72 lg:col-span-2" />
        <Skeleton className="h-72" />
      </div>
    </div>
  );
}