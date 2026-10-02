import { Link } from "react-router-dom";
import { Radio } from "lucide-react";
import { ChartEmpty, Panel, type InsightTable } from "../../kit";
import { cn } from "@/lib/utils";

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * Live shift floor: one card per shift with a three-part bar - logged in (green), no-show (red) and
 * not yet due (grey) - so a WFM analyst reads staffing at a glance. Cards link to the live tracker.
 */
export function FloorBoard({ table, loading, clock }: { table: InsightTable | undefined; loading?: boolean; clock?: string | null }) {
  const rows = table?.rows ?? [];
  return (
    <Panel title="Live shift floor" subtitle={clock ? `Logged-in agents against rostered, as of ${clock} IST` : "Logged-in agents against rostered"} href="/wfm/live-tracker" hrefLabel="Live tracker"
      action={<span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700 ring-1 ring-emerald-200"><Radio className="h-3 w-3" aria-hidden />Live</span>}>
      {loading && !table ? <div className="grid gap-3 sm:grid-cols-2">{[0, 1, 2, 3].map((i) => <div key={i} className="kit-shimmer h-24 rounded-xl" />)}</div>
        : table?.unavailable || !rows.length ? <ChartEmpty text={table?.unavailable ?? "No roster rows for today in this scope"} />
        : (
          <ul className="grid gap-3 sm:grid-cols-2" aria-label="Shifts today">
            {rows.map((r) => {
              const rostered = Math.max(1, num(r.rostered)), inNow = num(r.inNow), noShow = num(r.noShow);
              const due = num(r.due), notDue = Math.max(0, rostered - due);
              const fill = typeof r.fill === "number" ? r.fill : null;
              return (
                <li key={String(r.shift)}>
                  <Link to="/wfm/live-tracker" className="block rounded-xl border border-slate-200 p-3 transition hover:border-cyan-300 hover:bg-cyan-50/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate text-[13px] font-bold text-slate-900">{String(r.shift)}</p>
                      <p className={cn("kit-num text-[13px] font-extrabold", fill === null ? "text-slate-400" : fill >= 90 ? "text-emerald-600" : fill >= 75 ? "text-amber-600" : "text-rose-600")}>{fill === null ? "not started" : `${fill}%`}</p>
                    </div>
                    <div className="mt-2 flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`${inNow} logged in, ${noShow} no-show, ${notDue} not yet due of ${rostered} rostered`}>
                      <span className="bg-emerald-500" style={{ width: `${(inNow / rostered) * 100}%` }} />
                      <span className="bg-rose-500" style={{ width: `${(noShow / rostered) * 100}%` }} />
                      <span className="bg-slate-300" style={{ width: `${(notDue / rostered) * 100}%` }} />
                    </div>
                    <p className="mt-2 flex flex-wrap gap-x-3 text-[12px] text-slate-500">
                      <span><b className="kit-num text-slate-800">{inNow}</b> in</span>
                      <span><b className={cn("kit-num", noShow ? "text-rose-600" : "text-slate-800")}>{noShow}</b> no-show</span>
                      <span><b className="kit-num text-slate-800">{rostered}</b> rostered</span>
                      {r.startAt ? <span>starts {String(r.startAt)}</span> : null}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
    </Panel>
  );
}
