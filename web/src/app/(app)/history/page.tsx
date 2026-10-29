"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Download, RefreshCw, ScanSearch } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { HistoryItem, Paged } from "@/lib/types";
import { formatDateTime } from "@/lib/format";
import { Button, Card, EmptyState, ErrorState, Skeleton } from "@/components/ui";
import { JobStateBadge } from "@/components/StatusBadge";
import { Pagination } from "@/components/Pagination";

const PAGE_SIZES = [10, 20, 50];
const TYPES = [
  { value: "all", label: "All" },
  { value: "scan", label: "Scans" },
  { value: "update", label: "Updates" },
] as const;
const STATES = ["SUCCEEDED", "FAILED", "RESTART_REQUIRED", "CANCELLED", "RUNNING", "QUEUED"];

const fieldClass =
  "rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary-soft";

export default function HistoryPage() {
  return (
    <Suspense fallback={<HistorySkeleton />}>
      <HistoryView />
    </Suspense>
  );
}

function HistoryView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // ── Current filters, read from the URL ──
  const typeParam = searchParams.get("type") ?? "all";
  const type = ["all", "scan", "update"].includes(typeParam) ? typeParam : "all";
  const stateParam = searchParams.get("state") ?? "";
  const state = STATES.includes(stateParam) ? stateParam : "";
  const from = searchParams.get("from") ?? ""; // yyyy-mm-dd
  const to = searchParams.get("to") ?? "";
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const sizeParam = Number(searchParams.get("pageSize"));
  const pageSize = PAGE_SIZES.includes(sizeParam) ? sizeParam : 10;

  const [data, setData] = useState<Paged<HistoryItem> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  function updateParams(changes: Record<string, string | number | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "" || (key === "type" && value === "all")) params.delete(key);
      else params.set(key, String(value));
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  // Build the API query for any page / page size
  function buildQuery(p: number, size: number) {
    const params = new URLSearchParams({ type, page: String(p), pageSize: String(size) });
    if (state) params.set("state", state);
    if (from) params.set("from", `${from}T00:00:00`); // start of day
    if (to) params.set("to", `${to}T23:59:59`); // end of day
    return params.toString();
  }

  const queryString = searchParams.toString();
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api<Paged<HistoryItem>>(`/history?${buildQuery(page, pageSize)}`)
      .then((res) => !cancelled && setData(res))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : "Something went wrong"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [queryString, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Download everything that matches the current filters as CSV (max 2,000 rows)
  async function exportCsv() {
    setExporting(true);
    try {
      const all: HistoryItem[] = [];
      for (let p = 1; p <= 20; p++) {
        const res = await api<Paged<HistoryItem>>(`/history?${buildQuery(p, 100)}`);
        all.push(...res.items);
        if (p * 100 >= res.total) break;
      }
      const header = ["Time", "Type", "Device", "Target", "Details", "Result", "Exit code", "Error"];
      const rows = all.map((i) => [
        i.createdAt, i.type, i.device, i.target, i.details ?? "", i.state, i.exitCode ?? "", i.error ?? "",
      ]);
      const csv = [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
      const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `updatepilot-history-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  const hasFilters = !!state || !!from || !!to || type !== "all";
  const dateError = from && to && from > to ? "The start date is after the end date." : null;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">History</h1>
          <p className="text-sm text-muted">Every scan and update attempt, with results.</p>
        </div>
        <Button variant="secondary" onClick={exportCsv} disabled={exporting || !data || data.total === 0}>
          <Download size={16} aria-hidden /> {exporting ? "Exporting…" : "Export CSV"}
        </Button>
      </header>

      {/* Type tabs */}
      <div className="flex gap-1 border-b border-border" role="group" aria-label="Event type">
        {TYPES.map((t) => (
          <button
            key={t.value}
            aria-pressed={type === t.value}
            onClick={() => updateParams({ type: t.value, page: null })}
            className={`-mb-px border-b-2 px-4 py-2 text-sm transition ${
              type === t.value
                ? "border-primary font-semibold text-primary"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          Result
          <select value={state} onChange={(e) => updateParams({ state: e.target.value || null, page: null })} className={fieldClass}>
            <option value="">All results</option>
            <option value="SUCCEEDED">Succeeded</option>
            <option value="FAILED">Failed</option>
            <option value="RESTART_REQUIRED">Restart required</option>
            <option value="CANCELLED">Cancelled</option>
            <option value="RUNNING">Running</option>
            <option value="QUEUED">Queued</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          From
          <input type="date" value={from} max={to || undefined} onChange={(e) => updateParams({ from: e.target.value || null, page: null })} className={fieldClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          To
          <input type="date" value={to} min={from || undefined} onChange={(e) => updateParams({ to: e.target.value || null, page: null })} className={fieldClass} />
        </label>
        {hasFilters && (
          <Button variant="secondary" onClick={() => updateParams({ type: null, state: null, from: null, to: null, page: null })}>
            Clear filters
          </Button>
        )}
      </div>
      {dateError && <p className="text-sm text-danger">{dateError}</p>}

      {/* Content */}
      {error ? (
        <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
      ) : loading && !data ? (
        <HistorySkeleton />
      ) : data && data.total === 0 ? (
        <EmptyState
          title={hasFilters ? "No events match your filters" : "No history yet"}
          message={
            hasFilters
              ? "Try another result or date range, or clear the filters."
              : "Scans and updates will be listed here once your computer is connected."
          }
        />
      ) : data ? (
        <Card className={`overflow-hidden p-0 transition-opacity ${loading ? "opacity-60" : ""}`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-background text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3 font-semibold">Time</th>
                  <th className="px-4 py-3 font-semibold">Type</th>
                  <th className="px-4 py-3 font-semibold">Target</th>
                  <th className="px-4 py-3 font-semibold">Details</th>
                  <th className="px-4 py-3 font-semibold">Result</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={`${item.type}-${item.id}`} className="border-t border-border align-top">
                    <td className="whitespace-nowrap px-4 py-3 text-muted">{formatDateTime(item.createdAt)}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5">
                        {item.type === "scan" ? <ScanSearch size={16} aria-hidden /> : <RefreshCw size={16} aria-hidden />}
                        {item.type === "scan" ? "Scan" : "Update"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{item.target}</div>
                      {item.type === "update" && <div className="text-xs text-muted">{item.device}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-mono text-xs">{item.details ?? "—"}</div>
                      {item.error && <div className="mt-1 text-xs text-danger">{item.error}</div>}
                      {item.verificationResult === "VERIFIED" && (
                        <div className="mt-1 text-xs text-success">Verified by rescan</div>
                      )}
                    </td>
                    <td className="px-4 py-3"><JobStateBadge state={item.state} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={page}
            pageSize={pageSize}
            total={data.total}
            pageSizes={PAGE_SIZES}
            onPageChange={(p) => updateParams({ page: p })}
            onPageSizeChange={(size) => updateParams({ pageSize: size, page: null })}
          />
        </Card>
      ) : null}
    </div>
  );
}

// Safe CSV cell: quote it, and stop spreadsheet formulas (CSV injection)
function csvCell(value: unknown) {
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

function HistorySkeleton() {
  return (
    <Card className="space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-10" />
      ))}
    </Card>
  );
}