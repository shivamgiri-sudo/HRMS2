import { Link } from "react-router-dom";
import { ChartEmpty, Panel, type InsightTable } from "../../kit";
import { fteScale, type FteRow } from "./operationsModel";

/** FTE actual (bar) against required (marker) per process: the staffing gap at a glance. */
export function FteVsRequired({ table, loading }: { table?: InsightTable; loading?: boolean }) {
  const rows: FteRow[] = (table?.rows ?? []).map((r) => ({ name: String(r.name), actual: Number(r.actual), required: Number(r.required), href: r.href })).filter((r) => Number.isFinite(r.actual) && Number.isFinite(r.required));
  const scale = fteScale(rows);
  return (
    <Panel title="FTE vs required" subtitle="actual closing headcount against mandate + buffer - processes short" href={table?.href ?? "/operations-dashboard?tab=hiring&by=process"} hrefLabel="Hiring view">
      {loading && !table ? <div className="kit-shimmer h-40 rounded-xl" /> : table?.unavailable || !rows.length ? <ChartEmpty text={table?.unavailable ?? "No process is short of its mandate"} /> : (
        <ul className="space-y-3">
          {rows.map((r, i) => (
            <li key={i}>
              <Link to={r.href ?? "/operations-dashboard?tab=hiring"} className="block rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">
                <div className="flex items-baseline justify-between text-[12px]"><span className="truncate font-medium text-slate-700">{r.name}</span><span className="kit-num font-bold text-rose-700">-{r.required - r.actual} <span className="font-medium text-slate-400">({r.actual}/{r.required})</span></span></div>
                <div className="relative mt-1 h-3 rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-cyan-600" style={{ width: `${(r.actual / scale) * 100}%` }} />
                  <span aria-hidden className="absolute -top-0.5 h-4 w-0.5 bg-slate-900" style={{ left: `${Math.min(100, (r.required / scale) * 100)}%` }} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
