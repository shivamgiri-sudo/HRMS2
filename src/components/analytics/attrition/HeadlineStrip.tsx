import { Activity, AlertOctagon, LogOut, Percent, TrendingDown, Users } from "lucide-react";
import { ChartSkeleton, DegradedBanner, StatTile, num, pct } from "@/components/analytics/analytics-kit";
import { useHubOverview } from "./api";
import { ErrorCard } from "./charts";

export default function HeadlineStrip({ onHighRisk }: { onHighRisk: () => void }) {
  const q = useHubOverview();
  if (q.isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3" aria-busy="true">
        {Array.from({ length: 6 }).map((_, i) => <ChartSkeleton key={i} height={40} />)}
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
        <StatTile label="Active headcount" value={num(o.headcount)} denominator={`as of ${o.asOf}${o.inNotice ? ` · ${num(o.inNotice)} in notice` : ""}`} icon={<Users className="h-4 w-4" />} />
        {/* more exits is worse, so the delta tile is tinted by its sign only via the shared tile; label states direction */}
        <StatTile
          label="Exits, last 30d" value={num(o.exits30)}
          denominator={`prev 30d: ${num(o.exitsPrev30)}`}
          delta={delta} deltaLabel="vs prev 30d" icon={<LogOut className="h-4 w-4" />}
          intent={delta !== null && delta > 10 ? "warning" : "neutral"}
        />
        <StatTile label="Annualised attrition" value={o.annualisedRatePct === null ? "n/a" : pct(o.annualisedRatePct)} denominator={`${num(o.exits90)} exits in 90d × 4 ÷ avg headcount`} icon={<Percent className="h-4 w-4" />} />
        <StatTile label="Early exits (≤90d)" value={o.earlyExitSharePct === null ? "n/a" : pct(o.earlyExitSharePct)} denominator="of last-90d exits left within 90d of joining" icon={<TrendingDown className="h-4 w-4" />} intent={(o.earlyExitSharePct ?? 0) >= 40 ? "critical" : "neutral"} />
        <StatTile label="Expected exits, next 30d" value={`~${num(Math.round(o.expectedExits30))}`} denominator="sum of calibrated probabilities" icon={<Activity className="h-4 w-4" />} />
        <StatTile
          label="High + Critical at risk" value={num(highRisk)}
          denominator={`${num(o.atRisk.CRITICAL ?? 0)} critical · ${num(o.atRisk.HIGH ?? 0)} high · tap to view`}
          icon={<AlertOctagon className="h-4 w-4" />} intent={highRisk > 0 ? "critical" : "good"} onClick={onHighRisk}
        />
      </div>
    </div>
  );
}
