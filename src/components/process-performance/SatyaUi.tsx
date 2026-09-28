import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronRight, Search } from "lucide-react";

/** Number with a thin proportional bar behind it -- a non-judgemental way to
 * colour a column (relative to the column's own max) without inventing
 * good/bad thresholds for a business rate nobody has defined. */
export function BarCell({ value, max, color = "#f59e0b", children }: { value: number; max: number; color?: string; children: ReactNode }) {
  const w = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="relative inline-flex min-w-[64px] items-center justify-end">
      <span className="absolute inset-y-0 right-0 rounded-sm opacity-15" style={{ width: `${w}%`, backgroundColor: color }} />
      <span className="relative px-1">{children}</span>
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative w-full max-w-sm">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
      <input
        type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs text-slate-700 shadow-sm transition-colors focus:border-amber-400 focus:outline-none"
      />
    </div>
  );
}

export interface Col<T> {
  key: string;
  label: string;
  align?: "left" | "right";
  render: (row: T) => ReactNode;
  /** Present => the header is clickable and sorts by this value. */
  sort?: (row: T) => number | string;
  /** Footer (grand total) cell. */
  total?: ReactNode;
}

/**
 * Compact sortable table. `onRowClick` turns every row into a drill-down
 * trigger (rows get a hover state and a chevron). `total` cells render a
 * grand-total footer row like the source Excel report's.
 */
export function DataTable<T>({
  columns, rows, rowKey, onRowClick, defaultSort, empty = "No data for this selection.", maxHeight, totalLabel = "Total",
}: {
  columns: Array<Col<T>>;
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  defaultSort?: { key: string; dir: "asc" | "desc" };
  empty?: string;
  maxHeight?: string;
  totalLabel?: string;
}) {
  const [sort, setSort] = useState(defaultSort ?? null);
  const hasTotal = columns.some((c) => c.total !== undefined);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sort) return rows;
    const get = col.sort;
    return [...rows].sort((a, b) => {
      const av = get(a), bv = get(b);
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [rows, columns, sort]);

  const toggle = (c: Col<T>) => {
    if (!c.sort) return;
    setSort((cur) => (cur?.key === c.key ? { key: c.key, dir: cur.dir === "desc" ? "asc" : "desc" } : { key: c.key, dir: "desc" }));
  };

  return (
    <div className="overflow-auto" style={maxHeight ? { maxHeight } : undefined}>
      <table className="w-full text-left text-xs">
        <thead className="sticky top-0 z-10 bg-white">
          <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
            {columns.map((c) => (
              <th
                key={c.key} onClick={() => toggle(c)}
                className={`whitespace-nowrap py-2 pr-3 font-semibold ${c.align === "right" ? "text-right" : ""} ${c.sort ? "cursor-pointer select-none hover:text-slate-600" : ""}`}
              >
                <span className="inline-flex items-center gap-1">
                  {c.label}
                  {sort?.key === c.key && (sort.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                </span>
              </th>
            ))}
            {onRowClick && <th className="w-4" />}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr
              key={rowKey(row)} onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`border-b border-slate-50 transition-colors last:border-0 hover:bg-amber-50/50 ${onRowClick ? "cursor-pointer" : ""}`}
              title={onRowClick ? "Click for full details" : undefined}
            >
              {columns.map((c) => (
                <td key={c.key} className={`py-2.5 pr-3 ${c.align === "right" ? "text-right" : ""}`}>{c.render(row)}</td>
              ))}
              {onRowClick && <td className="w-4 text-slate-300"><ChevronRight className="h-3.5 w-3.5" /></td>}
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr><td colSpan={columns.length + (onRowClick ? 1 : 0)} className="py-8 text-center text-slate-400">{empty}</td></tr>
          )}
        </tbody>
        {hasTotal && sorted.length > 0 && (
          <tfoot className="sticky bottom-0 bg-slate-50">
            <tr className="border-t-2 border-slate-200 font-bold text-slate-800">
              {columns.map((c, i) => (
                <td key={c.key} className={`py-2.5 pr-3 ${c.align === "right" ? "text-right" : ""}`}>{c.total ?? (i === 0 ? totalLabel : "")}</td>
              ))}
              {onRowClick && <td />}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
