"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { AppItem, Paged } from "@/lib/types";
import { timeAgo } from "@/lib/format";
import { Button, Card, EmptyState, ErrorState, Skeleton } from "@/components/ui";
import { UpdateStatusBadge } from "@/components/StatusBadge";

const PAGE_SIZES = [5, 10, 20, 50];
const SORT_KEYS = ["displayName", "publisher", "lastSeenAt"] as const;
const MATCH_FILTERS = ["MATCHED", "UNMATCHED", "UNSUPPORTED"];
type SortKey = (typeof SORT_KEYS)[number];

const fieldClass =
  "rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary-soft";

// useSearchParams needs a Suspense boundary in Next.js
export default function ApplicationsPage() {
  return (
    <Suspense fallback={<TableSkeleton />}>
      <ApplicationsView />
    </Suspense>
  );
}

function ApplicationsView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // ── Read the current state from the URL (so refresh/share keeps filters) ──
  const search = searchParams.get("search") ?? "";
  const matchParam = searchParams.get("matchStatus") ?? "";
  const matchStatus = MATCH_FILTERS.includes(matchParam) ? matchParam : "";
  const sortParam = searchParams.get("sort") ?? "";
  const sort: SortKey = (SORT_KEYS as readonly string[]).includes(sortParam) ? (sortParam as SortKey) : "displayName";
  const order = searchParams.get("order") === "desc" ? "desc" : "asc";
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const sizeParam = Number(searchParams.get("pageSize"));
  const pageSize = PAGE_SIZES.includes(sizeParam) ? sizeParam : 10;

  const [searchInput, setSearchInput] = useState(search);
  const [data, setData] = useState<Paged<AppItem> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  function updateParams(changes: Record<string, string | number | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, String(value));
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  // Wait 300 ms after typing stops before searching
  useEffect(() => {
    if (searchInput === search) return;
    const timer = setTimeout(() => updateParams({ search: searchInput.trim() || null, page: null }), 300);
    return () => clearTimeout(timer);
  }, [searchInput]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load data whenever the URL changes
  const queryString = searchParams.toString();
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({ sort, order, page: String(page), pageSize: String(pageSize) });
    if (search) params.set("search", search);
    if (matchStatus) params.set("matchStatus", matchStatus);

    api<Paged<AppItem>>(`/applications?${params}`)
      .then((res) => !cancelled && setData(res))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : "Something went wrong"))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [queryString, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleSort(key: SortKey) {
    if (sort === key) updateParams({ order: order === "asc" ? "desc" : "asc", page: null });
    else updateParams({ sort: key, order: "asc", page: null });
  }

  function clearFilters() {
    setSearchInput("");
    updateParams({ search: null, matchStatus: null, page: null });
  }

  const hasFilters = !!search || !!matchStatus;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Applications</h1>
        <p className="text-sm text-muted">
          {data ? `${data.total} application${data.total === 1 ? "" : "s"}` : "Installed software on your computers"}
        </p>
      </header>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
          <input
            type="search"
            aria-label="Search applications"
            placeholder="Search by name, publisher or package ID…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className={`${fieldClass} w-full pl-9`}
          />
        </div>
        <select
          aria-label="Filter by match status"
          value={matchStatus}
          onChange={(e) => updateParams({ matchStatus: e.target.value || null, page: null })}
          className={fieldClass}
        >
          <option value="">All apps</option>
          <option value="MATCHED">Supported</option>
          <option value="UNMATCHED">Unmatched</option>
          <option value="UNSUPPORTED">Unsupported</option>
        </select>
        {hasFilters && (
          <Button variant="secondary" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
      </div>

      {/* Content */}
      {error ? (
        <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />
      ) : loading && !data ? (
        <TableSkeleton />
      ) : data && data.total === 0 ? (
        hasFilters ? (
          <EmptyState
            title="No apps match your filters"
            message="Try a different search, or clear the filters to see all apps."
            action={<Button variant="secondary" onClick={clearFilters}>Clear filters</Button>}
          />
        ) : (
          <EmptyState
            title="No applications yet"
            message="Once your computer is connected and scanned, its installed apps will appear here."
          />
        )
      ) : data && data.items.length === 0 ? (
        <EmptyState
          title="This page is empty"
          message="There are fewer results than this page number."
          action={<Button variant="secondary" onClick={() => updateParams({ page: null })}>Go to page 1</Button>}
        />
      ) : data ? (
        <Card className={`overflow-hidden p-0 transition-opacity ${loading ? "opacity-60" : ""}`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-background text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <SortHeader label="Application" sortKey="displayName" sort={sort} order={order} onSort={toggleSort} />
                  <SortHeader label="Publisher" sortKey="publisher" sort={sort} order={order} onSort={toggleSort} />
                  <th className="px-4 py-3 font-semibold">Installed</th>
                  <th className="px-4 py-3 font-semibold">Available</th>
                  <th className="px-4 py-3 font-semibold">Package ID</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <SortHeader label="Last seen" sortKey="lastSeenAt" sort={sort} order={order} onSort={toggleSort} />
                </tr>
              </thead>
              <tbody>
                {data.items.map((a) => (
                  <tr key={a.id} className="border-t border-border hover:bg-background">
                    <td className="px-4 py-3">
                      <Link href={`/applications/${a.id}`} className="font-medium hover:text-primary hover:underline">
                        {a.displayName}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted">{a.publisher ?? "—"}</td>
                    <td className="px-4 py-3 font-mono text-xs">{a.installedVersion ?? "—"}</td>
                    <td className="px-4 py-3 font-mono text-xs">{a.availableVersion ?? "—"}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted">{a.packageId ?? "—"}</td>
                    <td className="px-4 py-3"><UpdateStatusBadge status={a.updateStatus} /></td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted">{timeAgo(a.lastSeenAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm">
            <span className="text-muted">
              Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, data.total)} of {data.total}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-muted">
                Rows
                <select
                  value={pageSize}
                  onChange={(e) => updateParams({ pageSize: e.target.value, page: null })}
                  className={`${fieldClass} py-1`}
                >
                  {PAGE_SIZES.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </label>
              <Button variant="secondary" className="px-3 py-1.5" disabled={page <= 1} onClick={() => updateParams({ page: page - 1 })}>
                Previous
              </Button>
              <span className="text-muted">Page {page} of {totalPages}</span>
              <Button variant="secondary" className="px-3 py-1.5" disabled={page >= totalPages} onClick={() => updateParams({ page: page + 1 })}>
                Next
              </Button>
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function SortHeader({
  label,
  sortKey,
  sort,
  order,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  sort: SortKey;
  order: "asc" | "desc";
  onSort: (key: SortKey) => void;
}) {
  const active = sort === sortKey;
  const Icon = !active ? ArrowUpDown : order === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className="px-4 py-3 font-semibold" aria-sort={active ? (order === "asc" ? "ascending" : "descending") : "none"}>
      <button onClick={() => onSort(sortKey)} className="inline-flex items-center gap-1 uppercase hover:text-foreground">
        {label}
        <Icon size={14} aria-hidden />
      </button>
    </th>
  );
}

function TableSkeleton() {
  return (
    <Card className="space-y-3" >
      <Skeleton className="h-6 w-1/3" />
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-10" />
      ))}
    </Card>
  );
}