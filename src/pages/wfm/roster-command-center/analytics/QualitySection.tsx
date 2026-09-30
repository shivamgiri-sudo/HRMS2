import { lazy, useMemo } from "react";
import { Lightbulb, Target, Users } from "lucide-react";
import { ChartCard } from "@/components/wfm/console/ChartCard";
import { KpiTile } from "@/components/wfm/console/KpiTile";
import { correlationView, fmtPeriod } from "./calc";
import { SortableTable } from "./SortableTable";
import { ErrorBox, KpiSkeletons, Lazy, Pill, type OpenDrawer } from "./sectionKit";
import type { OutlierCategory, QualityCorrelation } from "./types";

const SegmentBars = lazy(() => import("./AnalyticsCharts").then((m) => ({ default: m.SegmentBars })));

const CATEGORY: Record<OutlierCategory, { label: string; tone: "green" | "amber" | "red" | "neutral" }> = {
  HIGH_QUALITY_LOW_ATTENDANCE: { label: "High quality, low attendance", tone: "amber" },
  LOW_QUALITY_HIGH_ATTENDANCE: { label: "Low quality, high attendance", tone: "amber" },
  BOTH_LOW: { label: "Low on both", tone: "red" },
  BOTH_HIGH: { label: "High on both", tone: "green" },
};

interface Props { data?: QualityCorrelation; loading: boolean; error: unknown; onRetry: () => void; open: OpenDrawer; onSegments: () => void }

export default function QualitySection({ data, loading, error, onRetry, open, onSegments }: Props) {
  const seg = useMemo(() => data ? [
    { label: `High (${data.segments.highAdherence.adherenceRange})`, ...data.segments.highAdherence },
    { label: `Medium (${data.segments.mediumAdherence.adherenceRange})`, ...data.segments.mediumAdherence },
    { label: `Low (${data.segments.lowAdherence.adherenceRange})`, ...data.segments.lowAdherence },
  ] : [], [data]);

  if (error && !data) return <ErrorBox what="quality correlation" error={error} onRetry={onRetry} />;
  if (loading && !data) return <KpiSkeletons n={4} />;
  if (!data) return null;
  const v = correlationView(data.correlation.coefficient, Boolean(data.insufficientData));
  const n = data.sampleSize ?? seg.reduce((s, x) => s + x.count, 0);

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-600">Period {fmtPeriod(data.period)} · adherence = attended ÷ planned working shifts (completed days) · quality = average of the employee's quality-family KPIs</p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile label="Correlation (r)" value={data.insufficientData ? "n/a" : data.correlation.coefficient.toFixed(2)} sub={v.label} tone={v.tone === "neutral" ? "neutral" : v.tone} icon={Target} progress={v.ringPct} onClick={onSegments} />
        <KpiTile label="Employees analysed" value={n} sub="With both attendance and quality" tone="blue" icon={Users} onClick={onSegments} />
        <KpiTile label="Quality: high adherence" value={data.segments.highAdherence.count ? data.segments.highAdherence.avgQuality : "—"} sub={`${data.segments.highAdherence.count} employees`} tone="green" />
        <KpiTile label="Quality: low adherence" value={data.segments.lowAdherence.count ? data.segments.lowAdherence.avgQuality : "—"} sub={`${data.segments.lowAdherence.count} employees`} tone="red" />
      </div>
      <p className="rounded-md border border-border bg-muted/40 p-3 text-sm text-slate-700">{data.correlation.insight}</p>

      <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        <ChartCard title="Average quality by adherence band" subtitle="Click a bar for the band detail" height={240} empty={n === 0} emptyLabel="No employees with both attendance and quality data">
          <Lazy><SegmentBars data={seg} onPick={onSegments} /></Lazy>
        </ChartCard>
        <ChartCard className="lg:col-span-2" title="Outliers" subtitle="Most extreme first · click a row for the employee's record" height={300} empty={data.outliers.length === 0} emptyLabel="No outliers this period">
          <SortableTable caption="Adherence and quality outliers" rows={data.outliers} rowKey={(o) => o.employeeId} maxHeight={300}
            onRowClick={(o) => open({ type: "employee", id: o.employeeId, label: o.employeeName })} rowLabel={(o) => o.employeeName}
            columns={[
              { key: "n", header: "Employee", sort: (o) => o.employeeName, cell: (o) => <span>{o.employeeName} <span className="text-xs text-slate-500">{o.employeeCode}</span></span> },
              { key: "a", header: "Adherence", align: "right", sort: (o) => o.adherencePct, cell: (o) => `${o.adherencePct}%` },
              { key: "q", header: "Quality", align: "right", sort: (o) => o.qualityPct, cell: (o) => o.qualityPct },
              { key: "c", header: "Category", sort: (o) => o.category, cell: (o) => <Pill tone={CATEGORY[o.category].tone}>{CATEGORY[o.category].label}</Pill> },
            ]} />
        </ChartCard>
      </div>

      {data.actionableInsights.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900"><Lightbulb className="h-4 w-4 text-amber-600" aria-hidden />Actionable insights</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">{data.actionableInsights.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
