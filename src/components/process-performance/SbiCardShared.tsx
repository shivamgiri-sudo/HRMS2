import { useCallback, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useSortableRows } from "./useSortableRows";
import { fmtN } from "./lpCallShared";

export const nz = (n: number | null | undefined): string => (n === null || n === undefined || Number.isNaN(n) ? "—" : fmtN(n));
export const pctTxt = (n: number | null | undefined): string => (n === null || n === undefined || Number.isNaN(n) ? "—" : `${n.toFixed(1)}%`);
export const inr = (n: number | null | undefined): string =>
  n === null || n === undefined || Number.isNaN(n) ? "—" : `₹${Math.round(n).toLocaleString("en-IN")}`;
/** Safe percentage of summed counts (never a fabricated figure: null when the denominator is 0). */
export const ratio = (num: number, den: number): number | null => (den > 0 ? (num / den) * 100 : null);
export const timeTxt = (v: string | null | undefined): string => {
  if (!v) return "—";
  const m = String(v).match(/(\d{1,2}:\d{2})/);
  return m ? m[1] : String(v);
};

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">{children}</p>;
}

export interface Col<T> { key: string; label: string; align?: "left" | "right"; value: (r: T) => string | number | null | undefined; render?: (r: T) => ReactNode }

/** Sortable, accessible table (aria-sort on headers, keyboard-activatable sort buttons). */
export function SortTable<T>({ rows, cols, caption, rowKey, footer }: {
  rows: T[]; cols: Array<Col<T>>; caption: string; rowKey: (r: T, i: number) => string; footer?: ReactNode;
}) {
  const getValue = useCallback((r: T, k: string) => cols.find((c) => c.key === k)?.value(r), [cols]);
  const { sorted, sortKey, sortDir, toggleSort } = useSortableRows(rows, getValue);
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-xs">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            {cols.map((c) => {
              const active = sortKey === c.key;
              return (
                <th key={c.key} scope="col" aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                  className={`whitespace-nowrap px-3 py-2 font-semibold ${c.align === "left" ? "text-left" : "text-right"}`}>
                  <button type="button" onClick={() => toggleSort(c.key)} className="inline-flex cursor-pointer items-center gap-1 rounded hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
                    {c.label}
                    {active ? (sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {sorted.map((r, i) => (
            <tr key={rowKey(r, i)} className="hover:bg-slate-50/70">
              {cols.map((c) => (
                <td key={c.key} className={`whitespace-nowrap px-3 py-1.5 tabular-nums text-slate-700 ${c.align === "left" ? "text-left" : "text-right"}`}>
                  {c.render ? c.render(r) : (() => { const v = c.value(r); return v === null || v === undefined || v === "" ? "—" : typeof v === "number" ? fmtN(v) : v; })()}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer}
      </table>
    </div>
  );
}
