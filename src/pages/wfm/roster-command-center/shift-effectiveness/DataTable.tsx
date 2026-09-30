import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { sortRows, type SortDir } from "./insights";

export interface Column<T> {
  key: string;
  header: string;
  align?: "left" | "right";
  /** Sort value; omit to make the column non-sortable. */
  sort?: (r: T) => number | string | null;
  render: (r: T) => React.ReactNode;
  /** The first column's render is wrapped in a real button so rows are keyboard reachable. */
  primary?: boolean;
  className?: string;
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (r: T) => string;
  onRowClick: (r: T) => void;
  rowLabel: (r: T) => string;
  defaultSort?: { key: string; dir: SortDir };
  caption: string;
  maxHeight?: number;
}

/** Sortable, sticky-header table whose rows all open a drill-down (Drill-Down Mandate). */
export function DataTable<T>({ columns, rows, rowKey, onRowClick, rowLabel, defaultSort, caption, maxHeight = 420 }: Props<T>) {
  const [sort, setSort] = useState(defaultSort ?? null);
  const sorted = useMemo(() => {
    const col = sort && columns.find((c) => c.key === sort.key);
    return col?.sort ? sortRows(rows, col.sort, sort!.dir) : rows;
  }, [rows, sort, columns]);
  const toggle = (key: string) => setSort((s) => (s?.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));
  return (
    <div className="overflow-auto rounded-lg border border-border bg-card" style={{ maxHeight }}>
      <table className="w-full min-w-[640px] text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 z-10 bg-muted">
          <tr>
            {columns.map((c) => {
              const active = sort?.key === c.key;
              return (
                <th key={c.key} scope="col" aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined}
                  className={cn("px-3 py-2 text-xs font-semibold text-slate-700", c.align === "right" ? "text-right" : "text-left")}>
                  {c.sort ? (
                    <button type="button" onClick={() => toggle(c.key)} className={cn("inline-flex min-h-[32px] cursor-pointer items-center gap-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", c.align === "right" && "flex-row-reverse")}>
                      {c.header}
                      {active ? (sort!.dir === "asc" ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />) : <ChevronsUpDown className="h-3 w-3 text-slate-400" aria-hidden />}
                    </button>
                  ) : c.header}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {sorted.map((r) => (
            <tr key={rowKey(r)} className="cursor-pointer transition-colors hover:bg-muted/60 motion-reduce:transition-none" onClick={() => onRowClick(r)}>
              {columns.map((c) => (
                <td key={c.key} className={cn("px-3 py-2 tabular-nums", c.align === "right" ? "text-right" : "text-left", c.className)}>
                  {c.primary ? (
                    <button type="button" aria-label={`Open details for ${rowLabel(r)}`} onClick={(e) => { e.stopPropagation(); onRowClick(r); }}
                      className="min-h-[44px] cursor-pointer text-left font-medium text-slate-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0">
                      {c.render(r)}
                    </button>
                  ) : c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
