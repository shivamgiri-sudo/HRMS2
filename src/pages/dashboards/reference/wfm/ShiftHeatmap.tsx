import { Link } from "react-router-dom";
import { ChartEmpty, Panel, type InsightTable } from "../../kit";
import { cn } from "@/lib/utils";

/** Cell colour by value: below `good` is calm, below `warn` is amber, above is red. Null = nothing was rostered. */
function cellClass(v: number | null, good: number, warn: number): string {
  if (v === null) return "bg-slate-50 text-slate-300";
  if (v < good) return "bg-emerald-50 text-emerald-800";
  if (v < warn) return "bg-amber-100 text-amber-900";
  return "bg-rose-200 text-rose-900 font-bold";
}

/** Shift x day heatmap rendered from a provider table (first column = shift, rest = percentages by date). */
export function ShiftHeatmap({ table, title, subtitle, good, warn, loading }: {
  table: InsightTable | undefined; title: string; subtitle: string; good: number; warn: number; loading?: boolean;
}) {
  const cols = table?.columns ?? [];
  const rows = table?.rows ?? [];
  return (
    <Panel title={title} subtitle={subtitle} href={table?.href} bodyClassName="p-0">
      {loading && !table ? <div className="kit-shimmer m-4 h-40 rounded-xl" />
        : table?.unavailable || !rows.length ? <div className="p-4"><ChartEmpty text={table?.unavailable ?? "No rostered days to compare"} /></div>
        : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-separate border-spacing-1 p-3 text-[12px]">
              <caption className="sr-only">{title}</caption>
              <thead>
                <tr>{cols.map((c, i) => <th key={c.key} scope="col" className={cn("px-2 py-1 text-xs font-semibold text-slate-500", i === 0 ? "text-left" : "text-center")}>{c.label}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={String(r.shift)}>
                    {cols.map((c, i) => {
                      const raw = r[c.key];
                      if (i === 0) return <th key={c.key} scope="row" className="max-w-[150px] truncate px-2 py-1.5 text-left font-semibold text-slate-800"><Link to="/wfm/roster-command-center" className="hover:underline">{String(raw)}</Link></th>;
                      const v = typeof raw === "number" ? raw : null;
                      return <td key={c.key} title={v === null ? "Nobody rostered" : `${v}%`} className={cn("kit-num rounded-md px-2 py-1.5 text-center", cellClass(v, good, warn))}>{v === null ? "·" : `${Math.round(v)}%`}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </Panel>
  );
}
