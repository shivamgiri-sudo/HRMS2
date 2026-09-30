import { CheckCircle2 } from "lucide-react";
import { StatusPill, type PillTone } from "@/components/wfm/console/StatusPill";
import { ChartCard } from "@/components/wfm/console/ChartCard";
import { DataTable, type Column } from "./DataTable";
import { BreakBarChart, BreakTrendChart } from "./lazyCharts";
import { THRESH, fmtDate, fmtMin, fmtNum, fmtPct, toneFor, type BreakResponse, type Recommendation, type ShiftRow, type ShiftType } from "./types";

const TYPE_LABEL: Record<ShiftType, string> = { MORNING: "Morning", AFTERNOON: "Afternoon", EVENING: "Evening", NIGHT: "Night" };
const pill = (v: number | null, t: { good: number; warn: number }) => <StatusPill tone={toneFor(v, t) as PillTone}>{fmtPct(v)}</StatusPill>;

export function ShiftsTable({ shifts, onOpen }: { shifts: ShiftRow[]; onOpen: (id: string) => void }) {
  const cols: Column<ShiftRow>[] = [
    { key: "rank", header: "#", sort: (s) => s.rank, render: (s) => s.rank },
    { key: "name", header: "Shift", primary: true, sort: (s) => s.shiftName, render: (s) => <>{s.shiftName}{s.isOptimal && <span className="ml-2"><StatusPill tone="green">Top shift</StatusPill></span>}</> },
    { key: "time", header: "Time", sort: (s) => s.shiftTime, render: (s) => <span className="text-slate-700">{s.shiftTime}</span> },
    { key: "type", header: "Type", sort: (s) => s.shiftType, render: (s) => TYPE_LABEL[s.shiftType] },
    { key: "emp", header: "Employees", align: "right", sort: (s) => s.totalEmployees, render: (s) => fmtNum(s.totalEmployees) },
    { key: "days", header: "Working days", align: "right", sort: (s) => s.scheduledDays, render: (s) => fmtNum(s.scheduledDays) },
    { key: "adh", header: "Adherence", align: "right", sort: (s) => s.metrics.adherencePct, render: (s) => pill(s.metrics.adherencePct, THRESH.adherence) },
    { key: "d", header: "vs prev 30d", align: "right", sort: (s) => s.trend.adherence, render: (s) => (s.trend.adherence == null ? "—" : <span className={s.trend.adherence < 0 ? "text-red-800" : "text-emerald-800"}>{s.trend.adherence > 0 ? "+" : ""}{s.trend.adherence} pts</span>) },
    { key: "ot", header: "On-time", align: "right", sort: (s) => s.metrics.onTimePct, render: (s) => fmtPct(s.metrics.onTimePct) },
    { key: "q", header: "Quality", align: "right", sort: (s) => s.metrics.qualityAvg, render: (s) => pill(s.metrics.qualityAvg, THRESH.quality) },
    { key: "b", header: "Break compl.", align: "right", sort: (s) => s.metrics.breakCompliancePct, render: (s) => pill(s.metrics.breakCompliancePct, THRESH.breaks) },
    { key: "p", header: "Productivity", align: "right", sort: (s) => s.metrics.productivityScore, render: (s) => (s.metrics.productivityScore ?? "—") },
  ];
  return <DataTable columns={cols} rows={shifts} rowKey={(s) => s.shiftId} onRowClick={(s) => onOpen(s.shiftId)} rowLabel={(s) => s.shiftName} defaultSort={{ key: "rank", dir: "asc" }} caption="Shift performance, sortable" />;
}

interface BreaksProps {
  data: BreakResponse | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  onOpenShift: (id: string) => void;
  onOpenEmployee: (id: string) => void;
  /** Process rows open the break-compliance breakdown drawer. */
  onOpenBreakSummary: () => void;
}

export function BreaksTab({ data, loading, error, onRetry, onOpenShift, onOpenEmployee, onOpenBreakSummary }: BreaksProps) {
  const none = !loading && !error && (data?.overall.sessions ?? 0) === 0;
  const emptyLabel = "No kiosk break data in the last 30 days for this scope";
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title="Break compliance by shift" subtitle="Days within the daily allowance (click a bar for the shift)" height={240} loading={loading} error={error} onRetry={onRetry} empty={none || !data?.byShift.length} emptyLabel={emptyLabel}>
          <BreakBarChart rows={(data?.byShift ?? []).map((s) => ({ id: s.shiftId, name: s.shiftName, compliancePct: s.compliancePct }))} onSelect={onOpenShift} />
        </ChartCard>
        <ChartCard title="Daily break compliance" subtitle="Last 30 completed days" height={240} loading={loading} error={error} onRetry={onRetry} empty={none || !data?.daily.length} emptyLabel={emptyLabel}>
          <BreakTrendChart data={data?.daily ?? []} />
        </ChartCard>
      </div>
      <h3 className="text-sm font-semibold text-slate-900">Break policy violators</h3>
      {loading ? <div className="h-40 animate-pulse rounded-lg bg-slate-100" role="status" aria-label="Loading violators" /> : !data?.topViolators.length ? (
        <p className="rounded-lg border border-border bg-card p-4 text-sm text-slate-600">{none ? emptyLabel : "No employee was over the allowance on 2 or more days."}</p>
      ) : (
        <DataTable
          caption="Employees repeatedly over the daily break allowance"
          rows={data.topViolators}
          rowKey={(v) => v.employeeId}
          onRowClick={(v) => onOpenEmployee(v.employeeId)}
          rowLabel={(v) => v.employeeName}
          defaultSort={{ key: "excess", dir: "desc" }}
          maxHeight={360}
          columns={[
            { key: "emp", header: "Employee", primary: true, sort: (v) => v.employeeName, render: (v) => <>{v.employeeName} <span className="text-xs font-normal text-slate-600">{v.employeeCode}</span></> },
            { key: "excess", header: "Avg excess", align: "right", sort: (v) => v.avgExcessMinutes, render: (v) => <span className="font-semibold text-red-800">+{fmtMin(v.avgExcessMinutes)}</span> },
            { key: "occ", header: "Days over", align: "right", sort: (v) => v.occurrences, render: (v) => <StatusPill tone="red">{v.occurrences} of {v.daysObserved}</StatusPill> },
            { key: "last", header: "Last over", align: "right", sort: (v) => v.lastViolation, render: (v) => fmtDate(v.lastViolation) },
          ]}
        />
      )}
      {!!data?.byProcess.length && (
        <>
          <h3 className="text-sm font-semibold text-slate-900">By process</h3>
          <DataTable
            caption="Break compliance by process"
            rows={data.byProcess}
            rowKey={(p) => p.processId || p.processName}
            onRowClick={() => onOpenBreakSummary()}
            rowLabel={(p) => p.processName}
            defaultSort={{ key: "c", dir: "asc" }}
            maxHeight={300}
            columns={[
              { key: "n", header: "Process", primary: true, sort: (p) => p.processName, render: (p) => p.processName },
              { key: "d", header: "Tracked days", align: "right", sort: (p) => p.days, render: (p) => fmtNum(p.days) },
              { key: "a", header: "Avg break", align: "right", sort: (p) => p.avgBreakMinutes, render: (p) => fmtMin(p.avgBreakMinutes) },
              { key: "e", header: "Avg excess", align: "right", sort: (p) => p.avgExcessMinutes, render: (p) => fmtMin(p.avgExcessMinutes) },
              { key: "c", header: "Compliance", align: "right", sort: (p) => p.compliancePct, render: (p) => pill(p.compliancePct, THRESH.breaks) },
            ]}
          />
        </>
      )}
    </div>
  );
}

export function RecommendationsTab({ recs, loading, onOpenEmployee }: { recs: Recommendation[]; loading: boolean; onOpenEmployee: (id: string) => void }) {
  if (loading) return <div className="h-40 animate-pulse rounded-lg bg-slate-100" role="status" aria-label="Loading recommendations" />;
  if (!recs.length) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-card p-8 text-center">
        <CheckCircle2 className="h-8 w-8 text-emerald-700" aria-hidden />
        <p className="text-sm font-semibold text-slate-900">No shift change recommendations</p>
        <p className="max-w-md text-xs text-slate-600">Nobody has under 70% adherence with a better-performing eligible shift 15+ points above them, or there are not enough comparable shifts (5+ employees each) in this scope.</p>
      </div>
    );
  }
  const conf: Record<Recommendation["confidence"], PillTone> = { HIGH: "green", MEDIUM: "amber", LOW: "neutral" };
  return (
    <DataTable
      caption="Shift change recommendations"
      rows={recs}
      rowKey={(r) => r.employeeId}
      onRowClick={(r) => onOpenEmployee(r.employeeId)}
      rowLabel={(r) => r.employeeName}
      defaultSort={{ key: "gain", dir: "desc" }}
      columns={[
        { key: "emp", header: "Employee", primary: true, sort: (r) => r.employeeName, render: (r) => <>{r.employeeName} <span className="text-xs font-normal text-slate-600">{r.employeeCode}</span></> },
        { key: "cur", header: "Current shift", sort: (r) => r.currentShift, render: (r) => r.currentShift },
        { key: "rec", header: "Recommended", sort: (r) => r.recommendedShift, render: (r) => <span className="font-medium text-blue-800">{r.recommendedShift}</span> },
        { key: "own", header: "Own adherence", align: "right", sort: (r) => r.personalAdherence, render: (r) => `${fmtPct(r.personalAdherence)} (${r.presentDays}/${r.scheduledDays})` },
        { key: "tgt", header: "Target shift", align: "right", sort: (r) => r.targetAdherence, render: (r) => fmtPct(r.targetAdherence) },
        { key: "gain", header: "Gap", align: "right", sort: (r) => r.expectedImprovement, render: (r) => `+${r.expectedImprovement} pts` },
        { key: "conf", header: "Confidence", align: "right", sort: (r) => r.confidence, render: (r) => <StatusPill tone={conf[r.confidence]}>{r.confidence}</StatusPill> },
      ]}
    />
  );
}
