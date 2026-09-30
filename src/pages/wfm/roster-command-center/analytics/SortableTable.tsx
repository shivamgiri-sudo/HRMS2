/**
 * Sortable, sticky-header data table with keyboard-accessible row drill-down.
 * Rows > VIRTUALIZE_AFTER render through @tanstack/react-virtual (spacer rows keep the native <table>).
 */
import { useMemo, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { sortRows, type SortDir } from "./calc";

export const VIRTUALIZE_AFTER = 100;
const ROW_H = 40;

export interface Column<T> {
  key: string;
  header: string;
  align?: "left" | "right";
  /** Sort value; omit to make the column unsortable. */
  sort?: (r: T) => string | number | null | undefined;
  cell: (r: T) => ReactNode;
  className?: string;
}

export interface SortableTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (r: T) => string;
  /** Row click / Enter / Space opens the drill-down. */
  onRowClick?: (r: T) => void;
  rowLabel?: (r: T) => string;
  initialSort?: { key: string; dir: SortDir };
  maxHeight?: number;
  emptyLabel?: string;
  caption: string;
}

export function SortableTable<T>({ columns, rows, rowKey, onRowClick, rowLabel, initialSort, maxHeight = 360, emptyLabel = "None", caption }: SortableTableProps<T>) {
  const [sort, setSort] = useState<{ key: string; dir: SortDir } | undefined>(initialSort);
  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort?.key);
    return col?.sort && sort ? sortRows(rows, col.sort, sort.dir) : rows;
  }, [rows, columns, sort]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtual = sorted.length > VIRTUALIZE_AFTER;
  const v = useVirtualizer({ count: virtual ? sorted.length : 0, getScrollElement: () => scrollRef.current, estimateSize: () => ROW_H, overscan: 8 });

  if (rows.length === 0) return <p className="py-6 text-center text-sm text-slate-500">{emptyLabel}</p>;

  const items = virtual ? v.getVirtualItems() : sorted.map((_, i) => ({ index: i, start: 0, end: 0 }));
  const padTop = virtual && items.length ? items[0].start : 0;
  const padBottom = virtual && items.length ? v.getTotalSize() - items[items.length - 1].end : 0;

  const row = (r: T) => {
    const clickable = Boolean(onRowClick);
    return (
      <tr
        key={rowKey(r)}
        style={virtual ? { height: ROW_H } : undefined}
        className={cn("border-b border-border last:border-0", clickable && "cursor-pointer hover:bg-muted focus-visible:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring")}
        tabIndex={clickable ? 0 : undefined}
        role={clickable ? "button" : undefined}
        aria-label={clickable && rowLabel ? `Open details for ${rowLabel(r)}` : undefined}
        onClick={clickable ? () => onRowClick!(r) : undefined}
        onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onRowClick!(r); } } : undefined}
      >
        {columns.map((c) => (
          <td key={c.key} className={cn("px-3 py-2 text-sm text-slate-800", c.align === "right" ? "text-right tabular-nums" : "text-left", c.className)}>{c.cell(r)}</td>
        ))}
      </tr>
    );
  };

  return (
    <div ref={scrollRef} className="overflow-auto rounded-md border border-border" style={{ maxHeight }}>
      <table className="w-full min-w-[480px] border-collapse">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 z-10 bg-slate-50">
          <tr>
            {columns.map((c) => {
              const active = sort?.key === c.key;
              return (
                <th key={c.key} scope="col" aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined}
                  className={cn("px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600", c.align === "right" ? "text-right" : "text-left")}>
                  {c.sort ? (
                    <button type="button" className="inline-flex min-h-[32px] cursor-pointer items-center gap-1 rounded hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                      onClick={() => setSort(active ? { key: c.key, dir: sort!.dir === "asc" ? "desc" : "asc" } : { key: c.key, dir: c.align === "right" ? "desc" : "asc" })}>
                      {c.header}
                      {active ? (sort!.dir === "asc" ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />) : <ChevronsUpDown className="h-3 w-3 opacity-50" aria-hidden />}
                    </button>
                  ) : c.header}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {padTop > 0 && <tr aria-hidden style={{ height: padTop }}><td colSpan={columns.length} /></tr>}
          {items.map((it) => row(sorted[it.index]))}
          {padBottom > 0 && <tr aria-hidden style={{ height: padBottom }}><td colSpan={columns.length} /></tr>}
        </tbody>
      </table>
    </div>
  );
}
