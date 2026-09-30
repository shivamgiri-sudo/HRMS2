/** Right slide-over drill-down for every KPI / chart segment / table row on the Analytics panel (Drill-Down Mandate). */
import { Suspense, lazy, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { DetailDrawer, DrawerSection, FieldGrid } from "@/components/wfm/console/DetailDrawer";
import { StatusPill, type PillTone } from "@/components/wfm/console/StatusPill";
import { HEAVY_QUERY_TIMEOUT_MS } from "../heavyQuery";
import { fmtDate, fmtDateTime, fmtPeriod, formatINR } from "./calc";
import { SortableTable, type Column } from "./SortableTable";
import type { CostDetail, DrawerTarget, EmployeeDetail, ForecastDayDetail, ShrinkageDetail } from "./types";

const TrendChart = lazy(() => import("./AnalyticsCharts").then((m) => ({ default: m.TrendChart })));

const STATUS_TONE: Record<string, PillTone> = { PRESENT: "green", ABSENT: "red", LEAVE: "blue", TRAINING: "violet", OFF: "neutral", NOT_DUE: "neutral" };
const STATUS_LABEL: Record<string, string> = { PRESENT: "Present", ABSENT: "Absent", LEAVE: "Leave", TRAINING: "Training", OFF: "Off", NOT_DUE: "Not yet due" };
const Status = ({ s }: { s: string }) => <StatusPill tone={STATUS_TONE[s] ?? "neutral"}>{STATUS_LABEL[s] ?? s}</StatusPill>;

const num = (n: number, d = 1) => n.toLocaleString("en-IN", { maximumFractionDigits: d });

function MiniTrend({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="h-[180px]" role="img" aria-label={label}>
      <Suspense fallback={<div className="h-full animate-pulse rounded-md bg-slate-100" />}>{children}</Suspense>
    </div>
  );
}

const EmptyTimeline = () => (
  <>
    <DrawerSection label="Timeline"><p className="text-sm text-slate-500">None</p></DrawerSection>
    <DrawerSection label="Audit trail"><p className="text-sm text-slate-500">None</p></DrawerSection>
  </>
);

function Skeleton() {
  return (
    <div className="space-y-3" role="status" aria-label="Loading details">
      {[0, 1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse rounded-md bg-slate-100" />)}
    </div>
  );
}

function Failed({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
      Could not load details{error instanceof Error ? `: ${error.message}` : ""}.{" "}
      <button type="button" onClick={onRetry} className="cursor-pointer font-semibold underline">Retry</button>
    </div>
  );
}

export interface DrawerCtx { branchId: string; processId: string; lobId: string; weekStart: string; period: string; scopeQs: string }

function useDetail<T>(target: DrawerTarget | null, ctx: DrawerCtx) {
  const path = (() => {
    if (!target) return null;
    const lob = ctx.lobId && ctx.lobId !== "__all__" ? `&lobId=${encodeURIComponent(ctx.lobId)}` : "";
    const proc = ctx.processId && ctx.processId !== "__all__" ? `&processId=${encodeURIComponent(ctx.processId)}` : "";
    switch (target.type) {
      case "shrinkage":
        return `/api/roster-analytics/shrinkage/${ctx.branchId}/detail?weekStart=${ctx.weekStart}&kind=${target.kind}${target.key ? `&key=${encodeURIComponent(target.key)}` : ""}${proc}${lob}`;
      case "employee": return `/api/roster-analytics/employee/${target.id}/detail?period=${ctx.period}`;
      case "cost": return `/api/roster-analytics/cost/detail?period=${ctx.period}&component=${target.component}${ctx.scopeQs}`;
      case "forecast": return `/api/roster-analytics/forecast/${ctx.branchId}/detail?date=${target.date}${proc}${lob}`;
      default: return null;
    }
  })();
  return useQuery({
    queryKey: ["roster-analytics", "detail", path],
    queryFn: ({ signal }) => hrmsApi.get<T>(path!, HEAVY_QUERY_TIMEOUT_MS, signal),
    enabled: Boolean(path),
    // No placeholderData: each drawer kind has a different payload shape, so a previous target's data must never render.
    staleTime: 120_000,
    retry: false,
  });
}

// ── Bodies ───────────────────────────────────────────────────────────────────

function ShrinkageBody({ d }: { d: ShrinkageDetail }) {
  const cols: Column<ShrinkageDetail["records"][number]>[] = [
    { key: "date", header: "Date", sort: (r) => r.date, cell: (r) => `${fmtDate(r.date)} ${r.day.slice(0, 3)}` },
    { key: "emp", header: "Employee", sort: (r) => r.employeeName, cell: (r) => <span>{r.employeeName ?? "—"} <span className="text-xs text-slate-500">{r.employeeCode}</span></span> },
    { key: "status", header: "Status", sort: (r) => r.status, cell: (r) => <Status s={r.status} /> },
    { key: "late", header: "Late (min)", align: "right", sort: (r) => r.lateMinutes, cell: (r) => (r.lateMinutes ? r.lateMinutes : "—") },
    { key: "worked", header: "Worked / Shift (h)", align: "right", sort: (r) => r.workedHours, cell: (r) => (r.expectedHours ? `${num(r.workedHours)} / ${num(r.expectedHours)}` : "—") },
    { key: "lost", header: "Hours lost", align: "right", sort: (r) => r.hoursLost, cell: (r) => num(r.hoursLost) },
  ];
  const b = d.summary.breakdown;
  return (
    <>
      <DrawerSection label="Summary">
        <FieldGrid fields={[
          ["Week", `${fmtDate(d.weekStart)} – ${fmtDate(d.weekEnd)}`],
          ["Shrinkage", `${d.summary.shrinkagePct}% (${d.summary.shrinkageCount} of ${d.summary.counted})`],
          ["Budget", `${d.budgetPct}%`],
          ["Hours lost", num(d.summary.hoursLost)],
          ["Cost of lost hours", formatINR(d.summary.costINR)],
          ["Planned leave / Unplanned / Training", `${b.plannedLeave.count} / ${b.unplannedAbsence.count} / ${b.training.count}`],
          ["Late / Short shifts", `${b.lateArrival.count} / ${b.earlyDeparture.count}`],
        ]} />
      </DrawerSection>
      <DrawerSection label="Shrinkage trend (8 weeks)">
        <MiniTrend label="Weekly shrinkage percent for the last 8 weeks">
          <TrendChart data={d.trend} xKey="weekStart" yKey="shrinkagePct" name="Shrinkage" unit="%" xKind="date" />
        </MiniTrend>
      </DrawerSection>
      <DrawerSection label={`Related records (${d.totalRecords})`}>
        {d.records.length ? (
          <>
            <SortableTable caption="Affected roster days" columns={cols} rows={d.records} rowKey={(r) => `${r.employeeId}-${r.date}`} maxHeight={320} initialSort={{ key: "date", dir: "asc" }} />
            {d.totalRecords > d.records.length && <p className="text-xs text-slate-500">Showing first {d.records.length} of {d.totalRecords}.</p>}
          </>
        ) : <p className="text-sm text-slate-500">None</p>}
      </DrawerSection>
      <EmptyTimeline />
    </>
  );
}

function EmployeeBody({ d }: { d: EmployeeDetail }) {
  const e = d.employee;
  const cols: Column<EmployeeDetail["days"][number]>[] = [
    { key: "date", header: "Date", sort: (r) => r.date, cell: (r) => `${fmtDate(r.date)} ${r.day.slice(0, 3)}` },
    { key: "status", header: "Status", sort: (r) => r.status, cell: (r) => <Status s={r.status} /> },
    { key: "in", header: "Clock in", cell: (r) => (r.clockIn ? fmtDateTime(r.clockIn).slice(11) : "—") },
    { key: "worked", header: "Worked / Shift (h)", align: "right", sort: (r) => r.workedHours, cell: (r) => (r.expectedHours ? `${num(r.workedHours)} / ${num(r.expectedHours)}` : "—") },
    { key: "lost", header: "Lost (h)", align: "right", sort: (r) => r.hoursLost, cell: (r) => num(r.hoursLost) },
  ];
  return (
    <>
      <DrawerSection label="Employee">
        <FieldGrid fields={[
          ["Name", e.name], ["Code", e.code], ["Designation", e.designation], ["Status", e.employmentStatus],
          ["Process", e.processName], ["Branch", e.branchName], ["Manager", e.managerName], ["Joined", fmtDate(e.dateOfJoining)],
        ]} />
      </DrawerSection>
      <DrawerSection label={`This month (${fmtPeriod(d.period)})`}>
        <FieldGrid fields={[
          ["Adherence", d.summary.adherencePct === null ? "—" : `${d.summary.adherencePct}% (${d.summary.attended} of ${d.summary.planned} shifts)`],
          ["Hours lost", num(d.summary.hoursLost)], ["Cost of lost hours", formatINR(d.summary.costINR)],
        ]} />
      </DrawerSection>
      <DrawerSection label="Adherence trend (6 months)">
        {d.adherenceTrend.length ? (
          <MiniTrend label="Monthly adherence percent"><TrendChart data={d.adherenceTrend} xKey="period" yKey="adherencePct" name="Adherence" unit="%" xKind="period" /></MiniTrend>
        ) : <p className="text-sm text-slate-500">None</p>}
      </DrawerSection>
      <DrawerSection label="Quality scores">
        {d.quality.length ? (
          <SortableTable caption="Quality metrics" maxHeight={220} rows={d.quality} rowKey={(q) => `${q.period}-${q.metric}`}
            columns={[
              { key: "p", header: "Period", sort: (q) => q.period, cell: (q) => fmtPeriod(q.period) },
              { key: "m", header: "Metric", sort: (q) => q.metric, cell: (q) => q.metric },
              { key: "v", header: "Value", align: "right", sort: (q) => q.value, cell: (q) => (q.value === null ? "—" : `${num(q.value, 2)}${q.unit ? ` ${q.unit}` : ""}`) },
            ]} initialSort={{ key: "p", dir: "desc" }} />
        ) : <p className="text-sm text-slate-500">None</p>}
      </DrawerSection>
      <DrawerSection label={`Daily record (${d.days.length})`}>
        {d.days.length ? <SortableTable caption="Daily attendance against roster" columns={cols} rows={d.days} rowKey={(r) => r.date} maxHeight={320} initialSort={{ key: "date", dir: "asc" }} /> : <p className="text-sm text-slate-500">None</p>}
      </DrawerSection>
      <EmptyTimeline />
    </>
  );
}

function CostBody({ d, open }: { d: CostDetail; open: (id: string, label: string) => void }) {
  return (
    <>
      <DrawerSection label="Summary">
        <FieldGrid fields={[
          ["Period", fmtPeriod(d.period)], ["Hours lost", num(d.summary.hoursLost)], ["Cost", formatINR(d.summary.costINR)],
          ["Employees affected", d.summary.employees], ["Hourly cost assumption", `${formatINR(d.hourlyCostINR)} / hour (default rate, not payroll)`],
        ]} />
      </DrawerSection>
      <DrawerSection label="Cost trend (6 months)">
        {d.trend.length ? <MiniTrend label="Monthly cost of lost hours"><TrendChart data={d.trend} xKey="period" yKey="costINR" name="Cost" unit="₹" xKind="period" /></MiniTrend> : <p className="text-sm text-slate-500">None</p>}
      </DrawerSection>
      <DrawerSection label="Day-wise cost this month">
        {d.daily.length ? <MiniTrend label="Daily cost of lost hours"><TrendChart data={d.daily} xKey="date" yKey="costINR" name="Cost" unit="₹" xKind="date" /></MiniTrend> : <p className="text-sm text-slate-500">None</p>}
      </DrawerSection>
      <DrawerSection label={`Top employees (${d.topEmployees.length})`}>
        {d.topEmployees.length ? (
          <SortableTable caption="Employees by cost of lost hours" rows={d.topEmployees} rowKey={(r) => r.employeeId} maxHeight={320}
            onRowClick={(r) => open(r.employeeId, r.employeeName)} rowLabel={(r) => r.employeeName}
            columns={[
              { key: "n", header: "Employee", sort: (r) => r.employeeName, cell: (r) => <span>{r.employeeName} <span className="text-xs text-slate-500">{r.employeeCode}</span></span> },
              { key: "d", header: "Days", align: "right", sort: (r) => r.days, cell: (r) => r.days },
              { key: "h", header: "Hours lost", align: "right", sort: (r) => r.hoursLost, cell: (r) => num(r.hoursLost) },
              { key: "c", header: "Cost", align: "right", sort: (r) => r.costINR, cell: (r) => formatINR(r.costINR) },
            ]} initialSort={{ key: "c", dir: "desc" }} />
        ) : <p className="text-sm text-slate-500">None</p>}
      </DrawerSection>
      <EmptyTimeline />
    </>
  );
}

function ForecastBody({ d }: { d: ForecastDayDetail }) {
  return (
    <>
      <DrawerSection label="Summary">
        <FieldGrid fields={[["Date", `${d.day} ${fmtDate(d.date)}`], ["Same-weekday samples", d.summary.sameWeekdaySamples], ["Average absence", `${d.summary.avgAbsencePct}%`]]} />
      </DrawerSection>
      <DrawerSection label={`History: last ${d.day}s`}>
        {d.history.length ? (
          <>
            <MiniTrend label="Absence percent on previous same weekdays"><TrendChart data={d.history} xKey="date" yKey="absencePct" name="Absence" unit="%" xKind="date" /></MiniTrend>
            <SortableTable caption="Previous same-weekday absence" rows={d.history} rowKey={(r) => r.date} maxHeight={240}
              columns={[
                { key: "d", header: "Date", sort: (r) => r.date, cell: (r) => fmtDate(r.date) },
                { key: "p", header: "Planned", align: "right", sort: (r) => r.planned, cell: (r) => r.planned },
                { key: "a", header: "Absent", align: "right", sort: (r) => r.absent, cell: (r) => r.absent },
                { key: "r", header: "Absence %", align: "right", sort: (r) => r.absencePct, cell: (r) => `${r.absencePct}%` },
              ]} initialSort={{ key: "d", dir: "desc" }} />
          </>
        ) : <p className="text-sm text-slate-500">None</p>}
      </DrawerSection>
      <EmptyTimeline />
    </>
  );
}

// ── Drawer ───────────────────────────────────────────────────────────────────

export interface AnalyticsDrawerProps {
  target: DrawerTarget | null;
  onClose: () => void;
  /** Open a nested employee drawer (cost table row). */
  onOpenEmployee: (id: string, label: string) => void;
  ctx: DrawerCtx;
  /** Rendered for target.type === "correlation" (already-loaded segment data, no separate endpoint). */
  correlationBody?: ReactNode;
}

export function AnalyticsDrawer({ target, onClose, onOpenEmployee, ctx, correlationBody }: AnalyticsDrawerProps) {
  const q = useDetail<unknown>(target, ctx);
  let body: ReactNode = null;
  if (target?.type === "correlation") body = correlationBody ?? <p className="text-sm text-slate-500">None</p>;
  else if (target) {
    if (q.isPending && !q.data) body = <Skeleton />;
    else if (q.error) body = <Failed error={q.error} onRetry={() => void q.refetch()} />;
    else if (q.data) {
      if (target.type === "shrinkage") body = <ShrinkageBody d={q.data as ShrinkageDetail} />;
      else if (target.type === "employee") body = <EmployeeBody d={q.data as EmployeeDetail} />;
      else if (target.type === "cost") body = <CostBody d={q.data as CostDetail} open={onOpenEmployee} />;
      else if (target.type === "forecast") body = <ForecastBody d={q.data as ForecastDayDetail} />;
    }
  }
  const sub = target?.type === "shrinkage" ? `Week of ${fmtDate(ctx.weekStart)}` : target?.type === "forecast" ? fmtDate(target.date) : fmtPeriod(ctx.period);
  return (
    <DetailDrawer open={Boolean(target)} onOpenChange={(o) => { if (!o) onClose(); }} title={target?.label ?? "Details"} subtitle={sub}
      badge={q.isFetching && target && target.type !== "correlation" ? <span className="text-xs text-slate-500" aria-live="polite">Updating…</span> : undefined}>
      {body}
    </DetailDrawer>
  );
}
