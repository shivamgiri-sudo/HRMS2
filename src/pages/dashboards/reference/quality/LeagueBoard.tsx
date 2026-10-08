import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { ChartEmpty, Panel, type InsightTable } from "../../kit";
import { medal } from "./qualityModel";

const tone = (v: number) => (v >= 85 ? "bg-emerald-500" : v >= 75 ? "bg-amber-400" : "bg-rose-500");

/** Process league: rank medal, score bar against the 85% target line, fail / fatal / coverage chips. */
export function LeagueBoard({ table, loading }: { table?: InsightTable; loading?: boolean }) {
  const rows = table?.rows ?? [];
  return (
    <Panel title="Process league table" subtitle="average quality score of scored calls, last 30 days" href="/quality-dashboard">
      {loading && !table ? <div className="kit-shimmer h-48 rounded-xl" /> : table?.unavailable || !rows.length ? <ChartEmpty text={table?.unavailable ?? "No process has enough scored calls"} /> : (
        <ol className="space-y-2.5">
          {rows.map((r, i) => {
            const score = typeof r.avg === "number" ? r.avg : 0;
            return (
              <li key={i}>
                <Link to={r.href ?? "/quality-dashboard"} className="kit-lift flex items-center gap-3 rounded-xl border border-slate-100 px-3 py-2">
                  <span className={cn("kit-num flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-black", medal(i + 1))}>{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2"><span className="truncate text-[13px] font-semibold text-slate-900">{String(r.name)}</span><span className="kit-num text-[14px] font-extrabold text-slate-900">{score}%</span></div>
                    <div className="relative mt-1.5 h-2 rounded-full bg-slate-100"><div className={cn("h-full rounded-full", tone(score))} style={{ width: `${Math.min(100, score)}%` }} /><span aria-hidden className="absolute -top-0.5 h-3 w-0.5 bg-slate-800/70" style={{ left: "85%" }} title="85% target" /></div>
                    <p className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-slate-500">
                      <span>fail {typeof r.fail === "number" ? `${r.fail}%` : "—"}</span><span>fatal {typeof r.fatal === "number" ? r.fatal : "—"}</span><span>coverage {typeof r.cov === "number" ? `${r.cov}%` : "—"}</span><span>{typeof r.agents === "number" ? r.agents : "—"} agents</span>
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}
