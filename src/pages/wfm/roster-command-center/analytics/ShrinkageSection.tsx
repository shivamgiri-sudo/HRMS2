import { lazy, useMemo } from "react";
import { AlertTriangle, Clock, LogOut, TrendingUp, Users, Wallet } from "lucide-react";
import { ChartCard } from "@/components/wfm/console/ChartCard";
import { KpiTile } from "@/components/wfm/console/KpiTile";
import { formatINR, fmtDate, rankTone, shrinkageTone } from "./calc";
import { SortableTable } from "./SortableTable";
import { ErrorBox, KpiSkeletons, Lazy, NeedBranch, Pill, type OpenDrawer } from "./sectionKit";
import type { ShrinkageIntelligence } from "./types";

const DayBars = lazy(() => import("./AnalyticsCharts").then((m) => ({ default: m.DayBars })));
const HBars = lazy(() => import("./AnalyticsCharts").then((m) => ({ default: m.HBars })));

interface Props { branchSelected: boolean; data?: ShrinkageIntelligence; loading: boolean; error: unknown; onRetry: () => void; open: OpenDrawer }

export default function ShrinkageSection({ branchSelected, data, loading, error, onRetry, open }: Props) {
  const cats = useMemo(() => {
    if (!data) return [];
    const b = data.breakdown;
    return [
      { key: "planned_leave", label: "Planned leave", value: b.plannedLeave.pct, color: 1 },
      { key: "unplanned_absence", label: "Unplanned absence", value: b.unplannedAbsence.pct, color: "risk" as const },
      { key: "training", label: "Training", value: b.training.pct, color: 4 },
      { key: "late", label: "Late arrivals", value: b.lateArrival.pct, color: 3 },
      { key: "early", label: "Short shifts", value: b.earlyDeparture.pct, color: 6 },
    ];
  }, [data]);

  if (!branchSelected) return <NeedBranch what="shrinkage intelligence" />;
  if (error && !data) return <ErrorBox what="shrinkage data" error={error} onRetry={onRetry} />;
  if (loading && !data) return <KpiSkeletons n={4} />;
  if (!data) return null;
  const b = data.breakdown;
  const tone = shrinkageTone(b.total.pct, data.budgetPct);
  const kt = tone === "neutral" ? "neutral" : tone;
  const noData = b.total.count === 0 && b.unplannedAbsence.count === 0 && data.costImpact.hoursLost === 0 && data.managerRanking.length === 0;

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-600">
        {data.branchName} · week {fmtDate(data.weekStart)} – {fmtDate(data.weekEnd)} · shrinkage = (leave + training + unplanned absence) ÷ (counted shifts + leave + training)
      </p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <KpiTile label="Total shrinkage" value={`${b.total.pct}%`} sub={`Budget ${data.budgetPct}% · ${data.varianceFromBudget > 0 ? "+" : ""}${data.varianceFromBudget}pp`} tone={kt}
          icon={AlertTriangle} progress={data.budgetPct > 0 ? Math.min(100, (b.total.pct / data.budgetPct) * 100) : b.total.pct > 0 ? 100 : 0}
          spark={data.prevWeekPct !== undefined ? [data.prevWeekPct, b.total.pct] : undefined} onClick={() => open({ type: "shrinkage", kind: "total", label: "Total shrinkage" })} />
        <KpiTile label="Unplanned absence" value={`${b.unplannedAbsence.pct}%`} sub={`${b.unplannedAbsence.count} shifts`} tone="red" icon={Users} onClick={() => open({ type: "shrinkage", kind: "unplanned_absence", label: "Unplanned absence" })} />
        <KpiTile label="Planned leave" value={`${b.plannedLeave.pct}%`} sub={`${b.plannedLeave.count} days`} tone="blue" icon={Users} onClick={() => open({ type: "shrinkage", kind: "planned_leave", label: "Planned leave" })} />
        <KpiTile label="Late arrivals" value={`${b.lateArrival.pct}%`} sub={`${b.lateArrival.count} of counted shifts`} tone="amber" icon={Clock} onClick={() => open({ type: "shrinkage", kind: "late", label: "Late arrivals" })} />
        <KpiTile label="Short shifts" value={`${b.earlyDeparture.pct}%`} sub={`${b.earlyDeparture.count} under 80% of shift`} tone="violet" icon={LogOut} onClick={() => open({ type: "shrinkage", kind: "early", label: "Early departures / short shifts" })} />
        <KpiTile label="vs previous week" value={`${data.trendVsPrevWeek > 0 ? "+" : ""}${data.trendVsPrevWeek}pp`} sub={data.prevWeekPct !== undefined ? `Prev week ${data.prevWeekPct}%` : "No previous-week data"}
          tone={data.trendVsPrevWeek > 0 ? "red" : "green"} icon={TrendingUp} />
      </div>

      {noData ? <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-slate-600">No roster data for this branch and week.</p> : (
        <>
          <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
            <ChartCard className="lg:col-span-2" title="Shrinkage by day" subtitle="Click a bar to see who was out. Red = above 1.5x budget." height={240}
              footer={<span className="inline-flex items-center gap-1"><Wallet className="h-3 w-3" aria-hidden />{data.costImpact.hoursLost} h lost · {formatINR(data.costImpact.estimatedCostINR)} · {data.costImpact.productivityLossPct}% of planned hours</span>}>
              <Lazy><DayBars data={data.dayOfWeekPattern} budget={data.budgetPct}
                onDay={(d) => d.date && open({ type: "shrinkage", kind: "day", key: d.date, label: `${d.day} ${fmtDate(d.date)}` })} /></Lazy>
            </ChartCard>
            <ChartCard title="Shrinkage breakdown" subtitle="% of counted shifts (late/short: % of worked shifts)" height={240}>
              <Lazy><HBars data={cats} unit="%" onPick={(k, l) => open({ type: "shrinkage", kind: k, label: l })} /></Lazy>
            </ChartCard>
          </div>
          <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <ChartCard title="Manager ranking" subtitle="Top 10 by shrinkage · click a row for the team's days" height={300}>
              <SortableTable caption="Managers ranked by shrinkage" rows={data.managerRanking} rowKey={(m) => m.managerId} maxHeight={300}
                onRowClick={(m) => open({ type: "shrinkage", kind: "manager", key: m.managerId, label: m.managerName })} rowLabel={(m) => m.managerName}
                columns={[
                  { key: "rank", header: "#", sort: (m) => m.rank, cell: (m) => m.rank },
                  { key: "name", header: "Manager", sort: (m) => m.managerName, cell: (m) => m.managerName },
                  { key: "days", header: "Team days", align: "right", sort: (m) => m.teamSize, cell: (m) => m.teamSize },
                  { key: "unpl", header: "Unplanned", align: "right", sort: (m) => m.unplannedCount, cell: (m) => m.unplannedCount },
                  { key: "pct", header: "Shrinkage", align: "right", sort: (m) => m.shrinkagePct, cell: (m) => <Pill tone={rankTone(m.shrinkagePct)}>{m.shrinkagePct}%</Pill> },
                ]} />
            </ChartCard>
            <ChartCard title="Process ranking" subtitle="Top 10 by shrinkage · click a row for detail" height={300}>
              <SortableTable caption="Processes ranked by shrinkage" rows={data.processRanking} rowKey={(p) => p.processId} maxHeight={300}
                onRowClick={(p) => open({ type: "shrinkage", kind: "process", key: p.processId, label: p.processName })} rowLabel={(p) => p.processName}
                columns={[
                  { key: "name", header: "Process", sort: (p) => p.processName, cell: (p) => p.processName },
                  { key: "days", header: "Counted days", align: "right", sort: (p) => p.planned, cell: (p) => p.planned },
                  { key: "pct", header: "Shrinkage", align: "right", sort: (p) => p.shrinkagePct, cell: (p) => <Pill tone={rankTone(p.shrinkagePct)}>{p.shrinkagePct}%</Pill> },
                ]} />
            </ChartCard>
          </div>
        </>
      )}
    </div>
  );
}
