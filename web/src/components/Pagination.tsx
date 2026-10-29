"use client";

import { Button } from "./ui";

const selectClass =
  "rounded-md border border-border bg-surface px-2 py-1 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary-soft";

export function Pagination({
  page,
  pageSize,
  total,
  pageSizes,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  pageSizes: number[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm">
      <span className="text-muted">
        Showing {from}–{to} of {total}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-muted">
          Rows
          <select value={pageSize} onChange={(e) => onPageSizeChange(Number(e.target.value))} className={selectClass}>
            {pageSizes.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
        <Button variant="secondary" className="px-3 py-1.5" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          Previous
        </Button>
        <span className="text-muted">
          Page {page} of {totalPages}
        </span>
        <Button variant="secondary" className="px-3 py-1.5" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}