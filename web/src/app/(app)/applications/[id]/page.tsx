"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { AppDetails } from "@/lib/types";
import { formatDate, formatDateTime, safeUrl, timeAgo } from "@/lib/format";
import { Badge, Banner, Button, Card, EmptyState, ErrorState, Skeleton, type Tone } from "@/components/ui";
import { JobStateBadge, UpdateStatusBadge } from "@/components/StatusBadge";

const SEVERITY_TONE: Record<string, Tone> = {
  CRITICAL: "danger",
  HIGH: "danger",
  MEDIUM: "warning",
  LOW: "neutral",
  UNKNOWN: "neutral",
};

const VERIFICATION_LABEL: Record<string, string> = {
  VERIFIED: "Yes (rescan)",
  MISMATCH: "Version mismatch",
  NOT_CHECKED: "Not checked",
  PENDING: "Pending",
};

export default function ApplicationDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<AppDetails | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api<AppDetails>(`/applications/${encodeURIComponent(id)}`));
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, "UNKNOWN", "Something went wrong"));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <DetailsSkeleton />;

  // Not found (also used when the app belongs to another user)
  if (error && (error.status === 404 || error.status === 400)) {
    return (
      <EmptyState
        title="Application not found"
        message="It may have been removed, or the link is incorrect."
        action={
          <Link href="/applications" className="text-sm font-semibold text-primary hover:underline">
            Back to applications
          </Link>
        }
      />
    );
  }
  if (error) return <ErrorState message={error.message} onRetry={load} />;
  if (!data) return null;

  const { application: app, device, latestRelease, securityFindings, versionHistory, updateHistory } = data;
  const changelog = safeUrl(latestRelease?.changelogUrl);
  const matched = app.matchStatus === "MATCHED";

  return (
    <div className="space-y-6">
      <Link href="/applications" className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
        <ArrowLeft size={16} aria-hidden /> Applications
      </Link>

      {/* Header */}
      <Card className="flex flex-wrap items-center gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold">{app.displayName}</h1>
            <UpdateStatusBadge status={app.updateStatus} />
          </div>
          <p className="mt-1 text-sm text-muted">
            {app.publisher ?? "Unknown publisher"}
            {app.packageId && (
              <>
                {" · "}
                <span className="font-mono text-xs">{app.packageId}</span>
              </>
            )}
            {" · "}
            {device.deviceName}
          </p>
        </div>

        {changelog && (
          <a
            href={changelog}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-4 py-2 text-sm font-semibold hover:bg-background"
          >
            Release notes <ExternalLink size={14} aria-hidden />
          </a>
        )}

        {app.updateStatus === "update_available" && latestRelease && (
          <Button disabled title="Updating is built in Week 4">
            Update to {latestRelease.version}
          </Button>
        )}
      </Card>

      {/* Three info cards */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <h2 className="mb-4 font-semibold">Version</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <Row label="Installed" mono>{app.installedVersion ?? "—"}</Row>
            <Row label="Available" mono>
              <strong>{latestRelease?.version ?? "—"}</strong>
            </Row>
            <Row label="Package ID" mono>{app.packageId ?? "—"}</Row>
            <Row label="Source">{app.source ?? "—"}</Row>
            <Row label="Match">{matched ? "Trusted package" : app.matchStatus.toLowerCase()}</Row>
            <Row label="First seen">{formatDate(app.firstSeenAt)}</Row>
            <Row label="Last seen">{timeAgo(app.lastSeenAt)}</Row>
          </dl>
        </Card>

        <Card>
          <h2 className="mb-4 font-semibold">Release information</h2>
          {latestRelease ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              <Row label="Version" mono>{latestRelease.version}</Row>
              <Row label="Release date">{formatDate(latestRelease.releaseDate)}</Row>
              <Row label="Channel">{latestRelease.channel ?? "—"}</Row>
              <Row label="Source">{latestRelease.source}</Row>
              <Row label="Checked">{timeAgo(latestRelease.fetchedAt)}</Row>
              <Row label="Changelog">
                {changelog ? (
                  <a href={changelog} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                    Open ↗
                  </a>
                ) : (
                  "Not available"
                )}
              </Row>
            </dl>
          ) : (
            <p className="text-sm text-muted">
              No release information is available
              {!matched && " because this app isn't matched to a trusted package"}.
            </p>
          )}
        </Card>

        <Card>
          <h2 className="mb-4 font-semibold">Security</h2>
          {!matched ? (
            <p className="text-sm text-muted">
              Security information is only shown for apps matched to a trusted package, to avoid false warnings.
            </p>
          ) : securityFindings.length === 0 ? (
            <div className="space-y-3">
              <Banner tone="success">No verified advisories for this package.</Banner>
              <p className="text-xs text-muted">Findings are shown only when the package match and source are reliable.</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {securityFindings.map((f) => (
                <li key={f.advisoryId} className="rounded-md border border-border p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs">{f.advisoryId}</span>
                    <Badge tone={SEVERITY_TONE[f.severity] ?? "neutral"}>{f.severity.toLowerCase()}</Badge>
                  </div>
                  {f.affectedRange && <p className="mt-1 text-muted">Affects: {f.affectedRange}</p>}
                  <p className="mt-1 text-xs text-muted">
                    Source: {f.source} · checked {timeAgo(f.lastVerifiedAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* History */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 font-semibold">Version history</h2>
          {versionHistory.length === 0 ? (
            <p className="text-sm text-muted">No scans recorded yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="pb-2 font-semibold">Version</th>
                  <th className="pb-2 font-semibold">Recorded</th>
                </tr>
              </thead>
              <tbody>
                {versionHistory.map((v) => (
                  <tr key={v.scanJobId} className="border-t border-border">
                    <td className="py-2 font-mono text-xs">{v.version}</td>
                    <td className="py-2 text-muted">{formatDateTime(v.recordedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card>
          <h2 className="mb-4 font-semibold">Update history</h2>
          {updateHistory.length === 0 ? (
            <p className="text-sm text-muted">This app hasn&apos;t been updated through UpdatePilot yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="pb-2 font-semibold">Date</th>
                    <th className="pb-2 font-semibold">Change</th>
                    <th className="pb-2 font-semibold">Result</th>
                    <th className="pb-2 font-semibold">Verified</th>
                  </tr>
                </thead>
                <tbody>
                  {updateHistory.map((u) => (
                    <tr key={u.id} className="border-t border-border">
                      <td className="py-2 text-muted">{formatDateTime(u.createdAt)}</td>
                      <td className="py-2 font-mono text-xs">
                        {u.fromVersion} → {u.targetVersion}
                        {u.exitCode !== null && u.exitCode !== 0 && (
                          <div className="font-sans text-danger">exit code {u.exitCode}</div>
                        )}
                      </td>
                      <td className="py-2"><JobStateBadge state={u.state} /></td>
                      <td className="py-2 text-muted">{VERIFICATION_LABEL[u.verificationResult]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function Row({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className={mono ? "break-all font-mono text-xs leading-5" : ""}>{children}</dd>
    </>
  );
}

function DetailsSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading application">
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-24" />
      <div className="grid gap-6 lg:grid-cols-3">
        <Skeleton className="h-56" />
        <Skeleton className="h-56" />
        <Skeleton className="h-56" />
      </div>
    </div>
  );
}