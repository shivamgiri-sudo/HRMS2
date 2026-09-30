import { lazy, useMemo } from "react";
import { Clock, DollarSign, Info, TrendingUp, Zap } from "lucide-react";
import { ChartCard } from "@/components/wfm/console/ChartCard";
import { KpiTile } from "@/components/wfm/console/KpiTile";
import { fmtPeriod, formatINR, formatINRCompact } from "./calc";
import { ErrorBox, KpiSkeletons, Lazy, Pill, type OpenDrawer } from "./sectionKit";
import type { CostComponent, CostImpact } from "./types";

const HBars = lazy(() => import("./AnalyticsCharts").then((m) => ({ default: m.HBars })));

interface Props { data?: CostImpact; loading: boolean; error: unknown; onRetry: () => void; open: OpenDrawer }

export default function CostSection({ data, loading, error, onRetry, open }: Props) {
  const bars = useMemo(() => data ? [
    { key: "absent", label: "Unplanned absence", value: data.breakdown.unplannedAbsenceCost, color: "risk" as const },
    { key: "late", label: "Late arrival", value: data.breakdown.lateCost, color: 3 },
    { key: "early", label: "Short shift", value: data.breakdown.earlyDepartureCost, color: 6 },
    { key: "incomplete", label: "Incomplete shift", value: data.breakdown.incompleteShiftCost, color: 4 },
  ] : [], [data]);

  if (error && !data) return <ErrorBox what="cost impact" error={error} onRetry={onRetry} />;
  if (loading && !data) return <KpiSkeletons n={4} />;
  if (!data) return null;
  const m = data.metrics;
  const gapTone = data.benchmarks.gapPct > 0 ? "red" : "green";
  const rate = data.assumptions?.hourlyCostINR ?? m.avgHourlyCostINR;
  const pick = (component: CostComponent, label: string) => open({ type: "cost", component, label });

  return (
    <div className="space-y-4">
      <p className="flex items-start gap-1.5 text-xs text-slate-600">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>{fmtPeriod(data.period)} · completed days only · hours lost = absent shift hours + shortfall on worked shifts (never double counted) × {formatINR(rate)}/hour. The hourly rate is a default assumption, not payroll data.</span>
      </p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile label="Direct cost of lost hours" value={formatINRCompact(m.directCostLossINR)} sub={formatINR(m.directCostLossINR)} tone="red" icon={DollarSign} onClick={() => pick("total", "Cost of lost hours")} />
        <KpiTile label="Hours lost" value={m.hoursLost.toLocaleString("en-IN")} sub={`of ${m.totalPlannedHours.toLocaleString("en-IN")} planned · ${m.actualWorkedHours.toLocaleString("en-IN")} worked`} tone="amber" icon={Clock} onClick={() => pick("total", "Cost of lost hours")} />
        <KpiTile label="Productivity loss" value={`${m.productivityImpactPct}%`} sub={`Benchmark ${data.benchmarks.industryAvgShrinkage}% · gap ${data.benchmarks.gapPct > 0 ? "+" : ""}${data.benchmarks.gapPct}pp`} tone={gapTone} icon={Zap} progress={Math.min(100, (m.productivityImpactPct / Math.max(1, data.benchmarks.industryAvgShrinkage * 2)) * 100)} />
        <KpiTile label="Annualised at this rate" value={formatINRCompact(data.projectedAnnual.currentTrend)} sub={`Save ${formatINRCompact(data.projectedAnnual.potentialSavings)} with 5pp less loss`} tone="violet" icon={TrendingUp} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        <ChartCard className="lg:col-span-2" title="Cost by cause" subtitle="Click a bar for the employees behind it" height={240} empty={m.directCostLossINR === 0} emptyLabel="No lost hours in this period">
          <Lazy><HBars data={bars} unit="₹" onPick={(k, l) => pick(k as CostComponent, l)} /></Lazy>
        </ChartCard>
        <ChartCard title="Projection" subtitle="Monthly loss × 12 (straight-line)" height={240}>
          <dl className="space-y-3 text-sm">
            <div className="flex items-center justify-between"><dt className="text-slate-600">At current rate</dt><dd className="font-semibold tabular-nums">{formatINR(data.projectedAnnual.currentTrend)}</dd></div>
            <div className="flex items-center justify-between"><dt className="text-slate-600">If loss falls 5pp</dt><dd className="font-semibold tabular-nums text-emerald-800">{formatINR(data.projectedAnnual.ifImproved5Pct)}</dd></div>
            <div className="flex items-center justify-between"><dt className="text-slate-600">Potential savings</dt><dd className="font-semibold tabular-nums text-emerald-800">{formatINR(data.projectedAnnual.potentialSavings)}</dd></div>
            <div className="flex items-center justify-between border-t border-border pt-3"><dt className="text-slate-600">Vs industry ({data.benchmarks.industryAvgShrinkage}%)</dt>
              <dd><Pill tone={gapTone}>{data.benchmarks.gapPct > 0 ? "+" : ""}{data.benchmarks.gapPct}pp gap</Pill></dd></div>
          </dl>
        </ChartCard>
      </div>
    </div>
  );
}
