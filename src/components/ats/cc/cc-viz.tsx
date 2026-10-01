import type { ReactNode } from "react";
import { ChevronRight, Download, Lightbulb, TrendingUp, TriangleAlert } from "lucide-react";
import { Empty, fmt } from "@/components/ats/overview/viz";

/** Drill-independent building blocks of the Command Center kit (kept apart so the drill sheet can use them without an import cycle). */
export type InsightTone = "good" | "warn" | "bad" | "info";
export interface InsightItem { tone: InsightTone; title: string; body?: string; onClick?: () => void }
const TONE: Record<InsightTone, { bar: string; icon: ReactNode }> = {
  good: { bar: "border-l-emerald-500", icon: <TrendingUp className="h-4 w-4 text-emerald-500" aria-hidden /> },
  warn: { bar: "border-l-amber-500", icon: <TriangleAlert className="h-4 w-4 text-amber-500" aria-hidden /> },
  bad: { bar: "border-l-red-500", icon: <TriangleAlert className="h-4 w-4 text-red-500" aria-hidden /> },
  info: { bar: "border-l-sky-500", icon: <Lightbulb className="h-4 w-4 text-sky-500" aria-hidden /> },
};

/** Auto-generated findings. Each can drill. */
export function InsightList({ items, empty = "Nothing unusual in this view" }: { items: InsightItem[]; empty?: string }) {
  if (!items.length) return <Empty text={empty} />;
  return (
    <ul className="space-y-2">
      {items.map((it, i) => {
        const body = (
          <div className={`flex items-start gap-2.5 rounded-xl border border-l-4 bg-muted/30 p-2.5 text-left ${TONE[it.tone].bar}`}>
            <span className="mt-0.5">{TONE[it.tone].icon}</span>
            <div className="min-w-0 flex-1"><div className="text-sm font-medium leading-snug">{it.title}</div>{it.body && <div className="mt-0.5 text-xs text-muted-foreground">{it.body}</div>}</div>
            {it.onClick && <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
          </div>
        );
        return <li key={i}>{it.onClick ? <button onClick={it.onClick} className="block w-full cursor-pointer rounded-xl transition-colors hover:bg-muted/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">{body}</button> : body}</li>;
      })}
    </ul>
  );
}

/** Colour a 0..1 position along blue → aqua. Used by every heat grid so scales read the same everywhere. */
export const heatColor = (t: number, hue: "blue" | "red" | "green" = "blue") => {
  const c = { blue: "42,120,214", red: "227,73,72", green: "27,175,122" }[hue];
  return `rgba(${c},${(0.08 + Math.max(0, Math.min(1, t)) * 0.72).toFixed(2)})`;
};

/** Metric heat table: rows are entities, columns are metrics, each column scaled on its own. Cells and row names can drill. */
// `get` is declared with method syntax on purpose: method parameters are compared bivariantly, so a column written against a
// narrower row type still fits a table whose rows carry extra fields.
/**
 * Where a value sits on the colour scale (0 pale .. 1 strong). A red column marks what is BAD when high (rejected %, no-show %, spend),
 * so its strongest shade is always the highest value, whether or not the column is also "lower is better". For other hues, `invert`
 * makes the lowest value the strongest.
 */
export const heatPosition = (t: number, col: { invert?: boolean; hue?: "blue" | "red" | "green" }) => (col.hue === "red" ? t : col.invert ? 1 - t : t);

export interface HeatCol<R> { key: string; label: string; get(r: R): number; format?: (n: number) => string; invert?: boolean; hue?: "blue" | "red" | "green" }
export function HeatTable<R extends { name: string }>({ rows, cols, onRow, onCell, max = 14 }: { rows: R[]; cols: HeatCol<R>[]; onRow?: (r: R) => void; onCell?: (r: R, c: HeatCol<R>) => void; max?: number }) {
  if (!rows.length) return <Empty />;
  const shown = rows.slice(0, max);
  const scale = cols.map((c) => { const v = shown.map(c.get); return { lo: Math.min(...v), hi: Math.max(...v) }; });
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full min-w-[520px] text-sm">
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2 font-medium">Name</th>{cols.map((c) => <th key={c.key} className="px-2 py-2 text-center font-medium">{c.label}</th>)}</tr></thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.name} className="border-t">
              <td className="max-w-[14rem] px-3 py-1.5">{onRow ? <button onClick={() => onRow(r)} className="cursor-pointer truncate text-left font-medium hover:text-primary hover:underline">{r.name}</button> : <span className="font-medium">{r.name}</span>}</td>
              {cols.map((c, ci) => {
                const v = c.get(r), { lo, hi } = scale[ci], t = hi === lo ? 0.4 : (v - lo) / (hi - lo);
                const cell = <span className="cc-num block rounded-md px-1.5 py-1 text-center text-xs font-semibold" style={{ background: heatColor(heatPosition(t, c), c.hue ?? "blue") }}>{(c.format ?? fmt)(v)}</span>;
                return <td key={c.key} className="px-1.5 py-1">{onCell ? <button onClick={() => onCell(r, c)} aria-label={`${r.name} ${c.label}: ${(c.format ?? fmt)(v)}`} className="block w-full cursor-pointer rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">{cell}</button> : cell}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** CSV export for any table the tab holds in memory. Quotes every cell and neutralises spreadsheet formulas. */
export function downloadCsv(filename: string, header: string[], rows: (string | number | null | undefined)[][]) {
  const cell = (v: string | number | null | undefined) => {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const blob = new Blob([[header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ExportButton({ onClick, label = "Export CSV" }: { onClick: () => void; label?: string }) {
  return (
    <button onClick={onClick} className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border bg-card px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
      <Download className="h-3.5 w-3.5" aria-hidden />{label}
    </button>
  );
}

