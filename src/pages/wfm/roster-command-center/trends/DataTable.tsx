import { useMemo, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { sortRows, type SortDir } from "./trendsCalc";

export interface Column<T> {
  key: string;
  header: string;
  align?: "left" | "right";
  /** Provide to make the column sortable. */
  sortValue?: (r: T) => number | string | null | undefined;
  render: (r: T) => ReactNode;
  className?: string;
}

interface Props<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (r: T) => string;
  onRowClick?: (r: T) => void;
  rowLabel?: (r: T) => string;
  defaultSort?: { key: string; dir: SortDir };
  maxHeight?: number;
  ariaLabel: string;
  emptyLabel?: string;
}

const VIRTUALISE_OVER = 100;
const ROW_HEIGHT = 40;

/**
 * Sortable data table: sticky header, tabular numerals, right-aligned numbers, keyboard-openable
 * rows, and windowed rendering once there are more than 100 rows (react-virtual padding rows).
 */
export function DataTable<T>({ rows, columns, rowKey, onRowClick, rowLabel, defaultSort, maxHeight = 420, ariaLabel, emptyLabel = "No rows" }: Props<T>) {
  const [sort, setSort] = useState<{ key: string; dir: SortDir } | undefined>(defaultSort);
  const scrollRef = useRef<HTMLDivElement>(null);

  const sorted = useMemo(() => {
    const col = sort && columns.find((c) => c.key === sort.key);
    return col?.sortValue ? sortRows(rows, col.sortValue, sort!.dir) : rows;
  }, [rows, sort, columns]);

  const virtual = sorted.length > VIRTUALISE_OVER;
  const virt = useVirtualizer({
    count: virtual ? sorted.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });
  const items = virtual ? virt.getVirtualItems() : [];
  const padTop = virtual && items.length ? items[0].start : 0;
  const padBottom = virtual && items.length ? virt.getTotalSize() - items[items.length - 1].end : 0;
  const visible = virtual ? items.map((i) => sorted[i.index]) : sorted;

  const toggle = (key: string) =>
    setSort((s) => (s?.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));

  return (
    <div ref={scrollRef} className="overflow-auto rounded-md border border-border" style={{ maxHeight }}>
      <table className="w-full min-w-max border-collapse text-xs" aria-label={ariaLabel} aria-rowcount={sorted.length}>
        <thead className="sticky top-0 z-10 bg-muted">
          <tr>
            {columns.map((c) => {
              const active = sort?.key === c.key;
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : c.sortValue ? "none" : undefined}
                  className={cn("whitespace-nowrap px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-600", c.align === "right" ? "text-right" : "text-left")}
                >
                  {c.sortValue ? (
                    <button
                      type="button"
                      onClick={() => toggle(c.key)}
                      className={cn("inline-flex min-h-[28px] cursor-pointer items-center gap-1 rounded px-1 uppercase hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", c.align === "right" && "flex-row-reverse")}
                    >
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
          {sorted.length === 0 && (
            <tr><td colSpan={columns.length} className="px-3 py-8 text-center text-sm text-slate-600">{emptyLabel}</td></tr>
          )}
          {padTop > 0 && <tr aria-hidden style={{ height: padTop }}><td colSpan={columns.length} /></tr>}
          {visible.map((r) => (
            <tr
              key={rowKey(r)}
              style={virtual ? { height: ROW_HEIGHT } : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              aria-label={onRowClick && rowLabel ? `Open details for ${rowLabel(r)}` : undefined}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              onKeyDown={onRowClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onRowClick(r); } } : undefined}
              className={cn("border-t border-border", onRowClick && "cursor-pointer transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none")}
            >
              {columns.map((c) => (
                <td key={c.key} className={cn("px-3 py-2 tabular-nums text-slate-800", c.align === "right" ? "text-right" : "text-left", c.className)}>{c.render(r)}</td>
              ))}
            </tr>
          ))}
          {padBottom > 0 && <tr aria-hidden style={{ height: padBottom }}><td colSpan={columns.length} /></tr>}
        </tbody>
      </table>
    </div>
  );
}
