import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown } from "lucide-react";
import type { SortDir } from "./auditModel";
import { pageLabel } from "./auditModel";

/** Sortable, keyboard-focusable column header (aria-sort, 44px touch target on mobile). */
export function SortTh<K extends string>({ label, k, sortKey, dir, onSort, right }: {
  label: string; k: K; sortKey: K; dir: SortDir; onSort: (k: K) => void; right?: boolean;
}) {
  const active = sortKey === k;
  const Icon = !active ? ChevronsUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th scope="col" aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
      className={`sticky top-0 z-10 border-b border-border bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-700 ${right ? "text-right" : "text-left"}`}>
      <button type="button" onClick={() => onSort(k)}
        className={`inline-flex min-h-[44px] cursor-pointer items-center gap-1 rounded sm:min-h-[32px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${right ? "flex-row-reverse" : ""}`}>
        {label}<Icon className="h-3 w-3" aria-hidden />
      </button>
    </th>
  );
}

export function StaticTh({ label, right }: { label: string; right?: boolean }) {
  return (
    <th scope="col" className={`sticky top-0 z-10 border-b border-border bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-700 ${right ? "text-right" : "text-left"}`}>{label}</th>
  );
}

/** Server-side pager footer. */
export function Pager({ offset, count, total, pageSize, onPage, busy }: {
  offset: number; count: number; total: number; pageSize: number; onPage: (offset: number) => void; busy?: boolean;
}) {
  const prev = offset > 0;
  const next = offset + count < total;
  const btn = "inline-flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded-md border border-border px-2 text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-[32px] sm:min-w-[32px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2 text-xs text-slate-700" aria-live="polite">
      <span>{busy ? "Updating..." : pageLabel(offset, count, total)}</span>
      <span className="flex items-center gap-1">
        <button type="button" className={btn} disabled={!prev} onClick={() => onPage(Math.max(0, offset - pageSize))} aria-label="Previous page"><ChevronLeft className="h-4 w-4" aria-hidden /></button>
        <button type="button" className={btn} disabled={!next} onClick={() => onPage(offset + pageSize)} aria-label="Next page"><ChevronRight className="h-4 w-4" aria-hidden /></button>
      </span>
    </div>
  );
}

export function TableSkeleton({ rows = 8, label }: { rows?: number; label: string }) {
  return (
    <div className="animate-pulse space-y-2 p-3 motion-reduce:animate-none" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => <div key={i} className="h-9 rounded bg-slate-100" />)}
    </div>
  );
}
