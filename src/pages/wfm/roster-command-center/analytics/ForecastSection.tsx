import { lazy, useMemo } from "react";
import { Calendar, Lightbulb, Target, TrendingUp } from "lucide-react";
import { ChartCard } from "@/components/wfm/console/ChartCard";
import { KpiTile } from "@/components/wfm/console/KpiTile";
import { fmtDate } from "./calc";
import { SortableTable } from "./SortableTable";
import { ErrorBox, KpiSkeletons, Lazy, NeedBranch, Pill, type OpenDrawer } from "./sectionKit";
import type { Forecast } from "./types";

const ForecastBars = lazy(() => import("./AnalyticsCharts").then((m) => ({ default: m.ForecastBars })));

interface Props { branchSelected: boolean; data?: Forecast; loading: boolean; error: unknown; onRetry: () => void; open: OpenDrawer }

const CONF_TONE = { HIGH: "green", MEDIUM: "amber", LOW: "red" } as const;

export default function ForecastSection({ branchSelected, data, loading, error, onRetry, open }: Props) {
  const days = useMemo(() => {
    if (!data) return [];
    const [y, m, d] = data.nextWeek.weekStart.split("-").map(Number);
    const risk = new Map(data.nextWeek.riskDays.map((r) => [r.date, r]));
    // All 7 days (risk days carry the model's prediction; others fall back to the headline).
    return Array.from({ length: 7 }, (_, i) => {
      const dt = new Date(Date.UTC(y, m - 1, d + i));
      const date = dt.toISOString().slice(0, 10);
      const r = risk.get(date);
      return { date, day: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][dt.getUTCDay()], predictedPct: r?.predictedPct ?? data.nextWeek.predictedShrinkagePct, risk: Boolean(r) };
    });
  }, [data]);

  if (!branchSelected) return <NeedBranch what="the shrinkage forecast" />;
  if (error && !data) return <ErrorBox what="forecast" error={error} onRetry={onRetry} />;
  if (loading && !data) return <KpiSkeletons n={4} />;
  if (!data) return null;
  const f = data.nextWeek;
  const p = data.patterns;
  const eff = (n: number) => `${n > 0 ? "+" : ""}${n}pp`;

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-600">Week of {fmtDate(f.weekStart)} · unplanned-absence rate from the last 8 completed weeks (excludes leave and training) · "predicted" bars for non-risk days show the weekly average</p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile label="Predicted absence" value={`${f.predictedShrinkagePct}%`} sub="Average across next week" tone="blue" icon={Target} />
        <KpiTile label="Confidence" value={f.confidence} sub="Based on days of history" tone={CONF_TONE[f.confidence]} icon={TrendingUp} />
        <KpiTile label="Risk days" value={f.riskDays.length} sub="Above baseline or pattern-driven" tone={f.riskDays.length >= 3 ? "red" : f.riskDays.length ? "amber" : "green"} icon={Calendar} />
        <KpiTile label="Monday / Friday effect" value={`${eff(p.mondayEffect)} / ${eff(p.fridayEffect)}`} sub={`Month-end ${eff(p.monthEndEffect)}`} tone={p.mondayEffect > 3 || p.fridayEffect > 3 ? "amber" : "neutral"} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        <ChartCard className="lg:col-span-2" title="Predicted absence by day" subtitle="Click a bar for that weekday's history" height={240}>
          <Lazy><ForecastBars data={days} base={f.predictedShrinkagePct} onDay={(date) => open({ type: "forecast", date, label: `Forecast ${fmtDate(date)}` })} /></Lazy>
        </ChartCard>
        <ChartCard title="Risk days" subtitle="Click a row for the history behind it" height={240} empty={f.riskDays.length === 0} emptyLabel="No high-risk days forecast">
          <SortableTable caption="Forecast risk days" rows={f.riskDays} rowKey={(r) => r.date} maxHeight={240}
            onRowClick={(r) => open({ type: "forecast", date: r.date, label: `Forecast ${fmtDate(r.date)}` })} rowLabel={(r) => `${r.day} ${fmtDate(r.date)}`}
            columns={[
              { key: "d", header: "Day", sort: (r) => r.date, cell: (r) => `${r.day.slice(0, 3)} ${fmtDate(r.date).slice(0, 5)}` },
              { key: "p", header: "Predicted", align: "right", sort: (r) => r.predictedPct, cell: (r) => <Pill tone={r.predictedPct > f.predictedShrinkagePct * 1.3 ? "red" : "amber"}>{r.predictedPct}%</Pill> },
              { key: "r", header: "Reason", cell: (r) => r.reason },
            ]} initialSort={{ key: "d", dir: "asc" }} />
        </ChartCard>
      </div>
      {data.recommendations.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900"><Lightbulb className="h-4 w-4 text-amber-600" aria-hidden />Recommendations</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">{data.recommendations.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
