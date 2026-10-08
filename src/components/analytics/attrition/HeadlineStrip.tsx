import { Activity, AlertOctagon, LogOut, Percent, TrendingDown, Users } from "lucide-react";
import { DegradedBanner, StatTile, num, pct } from "@/components/analytics/analytics-kit";
import { useHubOverview } from "./api";
import { DRILL_FOCUS, ErrorCard, Shimmer, TIER_COLOR, drillable } from "./charts";
import { useDrill } from "./DrillContext";

export default function HeadlineStrip() {
  const drill = useDrill();
  const q = useHubOverview();
  if (q.isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3" aria-busy="true">
        {Array.from({ length: 6 }).map((_, i) => <Shimmer key={i} className="h-[92px] rounded-xl" />)}
      </div>
    );
  }
  if (q.error || !q.data) return <ErrorCard what="the headline figures" error={q.error} onRetry={() => q.refetch()} />;
  const o = q.data;
  const delta = o.exitsPrev30 > 0 ? ((o.exits30 - o.exitsPrev30) / o.exitsPrev30) * 100 : null;
  const highRisk = (o.atRisk.CRITICAL ?? 0) + (o.atRisk.HIGH ?? 0);
  return (
    <div className="space-y-3">
      <DegradedBanner degraded={o.degraded} onRetry={() => q.refetch()} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatTile label="Active headcount" value={num(o.headcount)} denominator={`as of ${o.asOf}${o.inNotice ? ` · ${num(o.inNotice)} in notice` : ""}`} icon={<Users className="h-4 w-4" />} onClick={() => drill({ population: "active", sort: "score", title: `Active headcount - ${num(o.headcount)} people` })} />
        {/* more exits is worse, so the delta tile is tinted by its sign only via the shared tile; label states direction */}
        <StatTile
          label="Exits, last 30d" value={num(o.exits30)}
          denominator={`prev 30d: ${num(o.exitsPrev30)}`}
          delta={delta} deltaLabel="vs prev 30d" icon={<LogOut className="h-4 w-4" />}
          intent={delta !== null && delta > 10 ? "warning" : "neutral"}
          onClick={() => drill({ population: "exits", windowDays: 30, sort: "date", title: `Exits in the last 30 days - ${num(o.exits30)}` })}
        />
        <StatTile label="Annualised attrition" value={o.annualisedRatePct === null ? "n/a" : pct(o.annualisedRatePct)} denominator={`${num(o.exits90)} exits in 90d × 4 ÷ avg headcount`} icon={<Percent className="h-4 w-4" />} onClick={() => drill({ population: "exits", windowDays: 90, sort: "date", title: `Exits in the last 90 days - ${num(o.exits90)}` })} />
        <StatTile label="Early exits (≤90d)" value={o.earlyExitSharePct === null ? "n/a" : pct(o.earlyExitSharePct)} denominator="of last-90d exits left within 90d of joining" icon={<TrendingDown className="h-4 w-4" />} intent={(o.earlyExitSharePct ?? 0) >= 40 ? "critical" : "neutral"} onClick={() => drill({ population: "exits", windowDays: 90, sort: "aon", title: "Last-90-day exits, shortest tenure first" })} />
        <StatTile label="Expected exits, next 30d" value={`~${num(Math.round(o.expectedExits30))}`} denominator="sum of calibrated probabilities" icon={<Activity className="h-4 w-4" />} onClick={() => drill({ population: "active", sort: "score", title: `Most likely to leave in 30 days - ~${num(Math.round(o.expectedExits30))} expected` })} />
        <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-[#e34948]">
          <div className="flex items-start justify-between gap-2 pl-1.5">
            <div className="min-w-0">
              <span className="truncate text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">High + Critical at risk</span>
              <div className="mt-1.5 text-2xl font-bold tabular-nums leading-none text-slate-900">{num(highRisk)}</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(["CRITICAL", "HIGH"] as const).map(t => (
                  <span key={t} {...drillable(() => drill({ population: "active", tier: t, sort: "score", title: `${t === "CRITICAL" ? "Critical" : "High"} risk - ${num(o.atRisk[t] ?? 0)} people` }), `Open ${o.atRisk[t] ?? 0} people at ${t.toLowerCase()} risk`)}
                    className={`inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-slate-700 hover:bg-slate-100 ${DRILL_FOCUS}`}>
                    <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: TIER_COLOR[t] }} />{num(o.atRisk[t] ?? 0)} {t === "CRITICAL" ? "critical" : "high"}
                  </span>
                ))}
              </div>
            </div>
            <div className="shrink-0 rounded-lg bg-slate-50 p-1.5 text-slate-400"><AlertOctagon className="h-4 w-4" /></div>
          </div>
        </div>
      </div>
    </div>
  );
}
