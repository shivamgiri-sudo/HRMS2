import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { DetailDrawer, DrawerSection, FieldGrid } from "@/components/wfm/console/DetailDrawer";
import { StatusPill } from "@/components/wfm/console/StatusPill";
import { KpiTile } from "@/components/wfm/console/KpiTile";
import { scopeParams } from "../filterState";
import { useRosterConsoleFilters } from "../RosterConsoleFilterContext";
import { AdherenceTrendChart, DailyBreakChart } from "./lazyCharts";
import {
  THRESH, fmtDate, fmtDateTime, fmtMin, fmtNum, fmtPct, toneFor,
  type EmployeeBreakDetail, type ShiftDetail,
} from "./types";

const API = "/api/roster-analytics";
const cell = "px-2 py-1.5 text-xs";
const th = `${cell} text-left font-semibold text-slate-600`;
const num = `${cell} text-right tabular-nums`;

function MiniTable({ head, children, empty }: { head: string[]; children: React.ReactNode[]; empty?: boolean }) {
  if (empty) return <p className="text-sm text-slate-500">None</p>;
  return (
    <div className="max-h-64 overflow-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-muted">
          <tr>{head.map((h, i) => <th key={h} className={i === 0 ? th : `${th} text-right`} scope="col">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}

const drawerSkeleton = (
  <div className="space-y-3" role="status" aria-label="Loading detail">
    {[0, 1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-md bg-slate-100 motion-reduce:animate-none" />)}
  </div>
);

const TEMPLATE_LABELS: Array<[string, string]> = [
  ["shift_code", "Shift code"], ["version", "Version"], ["shift_name", "Name"], ["start_time", "Start"], ["end_time", "End"],
  ["productive_minutes", "Productive minutes"], ["grace_minutes", "Grace minutes"], ["break_entitlement", "Break entitlement (min)"],
  ["weekly_off_pattern", "Weekly off pattern"], ["night_shift", "Night shift"], ["effective_from", "Effective from"],
  ["effective_to", "Effective to"], ["active_status", "Active"], ["process_id", "Process id"], ["branch_id", "Branch id"],
  ["created_by", "Created by"], ["created_at", "Created"], ["updated_at", "Updated"], ["eligibility_rules", "Eligibility rules"],
];

function templateValue(key: string, v: unknown): React.ReactNode {
  if (v == null || v === "") return "—";
  if (key === "night_shift" || key === "active_status") return v ? "Yes" : "No";
  if (key.endsWith("_at")) return fmtDateTime(String(v));
  if (key.startsWith("effective_")) return fmtDate(String(v));
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function ShiftDrawer({ shiftId, onClose, onOpenEmployee }: { shiftId: string | null; onClose: () => void; onOpenEmployee: (id: string) => void }) {
  const { filters } = useRosterConsoleFilters();
  const q = useQuery({
    queryKey: ["shift-effectiveness", "shift-detail", shiftId, filters.branchId, filters.processId, filters.lobId],
    queryFn: ({ signal }) => hrmsApi.get<ShiftDetail>(`${API}/shift-effectiveness/${shiftId}?${scopeParams(filters)}`, 120_000, signal),
    enabled: !!shiftId,
    staleTime: 60_000,
  });
  const d = q.data;
  const t = d?.template ?? {};
  return (
    <DetailDrawer
      open={!!shiftId}
      onOpenChange={(o) => !o && onClose()}
      title={(t.shift_name as string) ?? "Shift detail"}
      subtitle={d ? `${String(t.shift_code ?? "")} v${String(t.version ?? "")} · ${fmtDate(d.window.cur.from)} to ${fmtDate(d.window.cur.to)}` : shiftId}
      badge={d ? <StatusPill tone={t.active_status ? "green" : "neutral"}>{t.active_status ? "Active" : "Inactive"}</StatusPill> : undefined}
    >
      {q.isPending ? drawerSkeleton : q.isError || !d ? (
        <p className="text-sm text-red-700" role="alert">Could not load this shift. Close and try again.</p>
      ) : (
        <>
          <DrawerSection label="Performance (last 30 days)">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <KpiTile label="Adherence" value={fmtPct(d.metrics?.adherencePct)} tone={toneFor(d.metrics?.adherencePct, THRESH.adherence)} delta={d.trend.adherence ?? undefined} deltaBad="down" sub={`${fmtNum(d.scheduledDays)} working days`} />
              <KpiTile label="On-time" value={fmtPct(d.metrics?.onTimePct)} />
              <KpiTile label="Quality" value={fmtPct(d.metrics?.qualityAvg)} delta={d.trend.quality ?? undefined} deltaBad="down" />
              <KpiTile label="Break compliance" value={fmtPct(d.metrics?.breakCompliancePct)} sub={`avg ${fmtMin(d.metrics?.avgBreakMinutes)}`} />
            </div>
          </DrawerSection>
          <DrawerSection label="Daily adherence trend">
            {d.daily.length ? <div style={{ height: 200 }}><AdherenceTrendChart data={d.daily} showOnTime /></div> : undefined}
          </DrawerSection>
          <DrawerSection label="Template record"><FieldGrid fields={TEMPLATE_LABELS.map(([k, l]) => [l, templateValue(k, t[k])])} /></DrawerSection>
          <DrawerSection label="Adherence by process">
            <MiniTable head={["Process", "Employees", "Days", "Adherence"]} empty={!d.byProcess.length}>
              {d.byProcess.map((p) => (
                <tr key={p.processName}><td className={cell}>{p.processName}</td><td className={num}>{fmtNum(p.employees)}</td><td className={num}>{fmtNum(p.scheduledDays)}</td><td className={num}>{fmtPct(p.adherencePct)}</td></tr>
              ))}
            </MiniTable>
          </DrawerSection>
          <DrawerSection label="Lowest adherence employees">
            <MiniTable head={["Employee", "Present", "Days", "Adherence"]} empty={!d.lowestAdherence.length}>
              {d.lowestAdherence.map((e) => (
                <tr key={e.employeeId} className="cursor-pointer hover:bg-muted" onClick={() => onOpenEmployee(e.employeeId)}>
                  <td className={cell}>
                    <button type="button" className="cursor-pointer text-left font-medium text-blue-800 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={(ev) => { ev.stopPropagation(); onOpenEmployee(e.employeeId); }}>{e.employeeName}</button>
                    <span className="ml-1 text-slate-500">{e.employeeCode}</span>
                  </td>
                  <td className={num}>{e.presentDays}</td><td className={num}>{e.scheduledDays}</td><td className={num}>{fmtPct(e.adherencePct)}</td>
                </tr>
              ))}
            </MiniTable>
          </DrawerSection>
          <DrawerSection label="Version history">
            <MiniTable head={["Version", "Effective", "Status", "Created"]} empty={!d.versions.length}>
              {d.versions.map((v) => (
                <tr key={v.id}><td className={cell}>v{v.version}</td><td className={num}>{fmtDate(v.effective_from)} to {v.effective_to ? fmtDate(v.effective_to) : "open"}</td><td className={num}>{v.active_status ? "Active" : "Inactive"}</td><td className={num}>{fmtDateTime(v.created_at)}</td></tr>
              ))}
            </MiniTable>
          </DrawerSection>
          <DrawerSection label="Audit trail">
            <MiniTable head={["Action", "Actor", "When"]} empty={!d.audit.length}>
              {d.audit.map((a, i) => (
                <tr key={i}><td className={cell}>{a.action_type}</td><td className={num}>{a.actor_user_id ?? "system"}</td><td className={num}>{fmtDateTime(a.created_at)}</td></tr>
              ))}
            </MiniTable>
          </DrawerSection>
        </>
      )}
    </DetailDrawer>
  );
}

interface EmployeeProfile {
  currentPeriod: { month: string; adherencePct: number; onTime: number; late: number; absent: number };
  shiftPattern: Array<{ shiftName: string; totalRostered: number; adherencePct: number }>;
  dayOfWeekPattern: Array<{ day: string; adherencePct: number; isWeakDay: boolean }>;
  comparison: { teamAvg: number; branchAvg: number; employeePct: number };
  riskSignals: { tier: string | null; signals: string[] };
  recentInterventions: Array<{ id: string; date: string; action: string; outcome: string | null }>;
}

export function EmployeeDrawer({ employeeId, onClose }: { employeeId: string | null; onClose: () => void }) {
  const breakQ = useQuery({
    queryKey: ["shift-effectiveness", "employee-break", employeeId],
    queryFn: ({ signal }) => hrmsApi.get<EmployeeBreakDetail>(`${API}/break-compliance/employee/${employeeId}`, 60_000, signal),
    enabled: !!employeeId,
    staleTime: 60_000,
  });
  // Existing dedicated adherence-profile endpoint; optional (drawer still works if the caller lacks access to it).
  const profQ = useQuery({
    queryKey: ["shift-effectiveness", "employee-profile", employeeId],
    queryFn: ({ signal }) => hrmsApi.get<EmployeeProfile>(`${API}/employee-profile/${employeeId}`, 60_000, signal),
    enabled: !!employeeId,
    staleTime: 60_000,
    retry: false,
  });
  const d = breakQ.data;
  const p = profQ.data;
  return (
    <DetailDrawer
      open={!!employeeId}
      onOpenChange={(o) => !o && onClose()}
      title={d?.employee.fullName ?? "Employee detail"}
      subtitle={d ? `${d.employee.employeeCode} · ${d.employee.processName ?? "No process"} · ${d.employee.branchName ?? "No branch"}` : employeeId}
      badge={d ? <StatusPill tone={toneFor(d.summary.compliancePct, THRESH.breaks)}>{d.summary.compliancePct == null ? "No break data" : `${fmtPct(d.summary.compliancePct)} compliant`}</StatusPill> : undefined}
    >
      {breakQ.isPending ? drawerSkeleton : breakQ.isError || !d ? (
        <p className="text-sm text-red-700" role="alert">Could not load this employee. Close and try again.</p>
      ) : (
        <>
          <DrawerSection label="Employee">
            <FieldGrid fields={[["Code", d.employee.employeeCode], ["Process", d.employee.processName], ["Branch", d.employee.branchName], ["Manager", d.employee.managerName], ["Window", `${fmtDate(d.window.cur.from)} to ${fmtDate(d.window.cur.to)}`]]} />
          </DrawerSection>
          <DrawerSection label="Break summary">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <KpiTile label="Days tracked" value={d.summary.daysObserved} />
              <KpiTile label="Over allowance" value={d.summary.overBudgetDays} tone={d.summary.overBudgetDays ? "red" : "green"} />
              <KpiTile label="Avg break" value={fmtMin(d.summary.avgBreakMinutes)} />
              <KpiTile label="Avg excess" value={fmtMin(d.summary.avgExcessMinutes)} />
            </div>
          </DrawerSection>
          <DrawerSection label="Daily break minutes vs allowance">
            {d.days.length ? <div style={{ height: 180 }}><DailyBreakChart days={d.days} /></div> : undefined}
          </DrawerSection>
          <DrawerSection label="Break days">
            <MiniTable head={["Date", "Total", "Allowance", "Mini/Long", "Status"]} empty={!d.days.length}>
              {[...d.days].reverse().map((x) => (
                <tr key={x.date}><td className={cell}>{fmtDate(x.date)}</td><td className={`${num} ${x.overBudget ? "font-semibold text-red-700" : ""}`}>{x.totalBreakMinutes}m{x.overBudget ? " (over)" : ""}</td><td className={num}>{x.budgetMinutes}m</td><td className={num}>{x.miniBreaks}/{x.longBreaks}</td><td className={num}>{x.status ?? "—"}</td></tr>
              ))}
            </MiniTable>
          </DrawerSection>
          <DrawerSection label="Break session timeline">
            <MiniTable head={["Start", "End", "Min", "Type", "Status / approval"]} empty={!d.sessions.length}>
              {d.sessions.map((s) => (
                <tr key={s.id}>
                  <td className={cell}>{fmtDateTime(s.start_time)}</td><td className={num}>{fmtDateTime(s.end_time)}</td><td className={num}>{s.duration_minutes ?? "—"}</td>
                  <td className={num}>{s.break_type ?? "—"}</td>
                  <td className={num} title={s.exception_reason ?? undefined}>{s.status}{s.manager_approved_by ? ` · approved ${fmtDateTime(s.manager_approved_at)}` : ""}</td>
                </tr>
              ))}
            </MiniTable>
          </DrawerSection>
          <DrawerSection label="Break alerts (audit)">
            <MiniTable head={["When", "Level", "Actual / limit", "Over by", "Email"]} empty={!d.alerts.length}>
              {d.alerts.map((a, i) => (
                <tr key={i}><td className={cell}>{fmtDateTime(a.sent_at ?? a.created_at)}</td><td className={num}>{a.alert_level}</td><td className={num}>{a.actual_minutes}/{a.threshold_minutes}m</td><td className={num}>{a.exceeded_by_minutes}m</td><td className={num}>{a.email_status}</td></tr>
              ))}
            </MiniTable>
          </DrawerSection>
          <DrawerSection label="Attendance profile">
            {profQ.isPending ? <p className="text-sm text-slate-500">Loading...</p> : !p ? undefined : (
              <div className="space-y-3">
                <FieldGrid fields={[
                  [`Adherence (${p.currentPeriod.month})`, fmtPct(p.currentPeriod.adherencePct)], ["On time / Late / Absent", `${p.currentPeriod.onTime} / ${p.currentPeriod.late} / ${p.currentPeriod.absent}`],
                  ["Employee vs team vs branch", `${fmtPct(p.comparison.employeePct)} / ${fmtPct(p.comparison.teamAvg)} / ${fmtPct(p.comparison.branchAvg)}`],
                  ["Risk", p.riskSignals.tier ? `${p.riskSignals.tier}${p.riskSignals.signals.length ? `: ${p.riskSignals.signals.join("; ")}` : ""}` : "None"],
                ]} />
                <MiniTable head={["Shift (3 months)", "Days", "Adherence"]} empty={!p.shiftPattern.length}>
                  {p.shiftPattern.map((s) => <tr key={s.shiftName}><td className={cell}>{s.shiftName}</td><td className={num}>{s.totalRostered}</td><td className={num}>{fmtPct(s.adherencePct)}</td></tr>)}
                </MiniTable>
                <MiniTable head={["Intervention", "Date", "Outcome"]} empty={!p.recentInterventions.length}>
                  {p.recentInterventions.map((i) => <tr key={i.id}><td className={cell}>{i.action}</td><td className={num}>{fmtDate(i.date)}</td><td className={num}>{i.outcome ?? "pending"}</td></tr>)}
                </MiniTable>
              </div>
            )}
          </DrawerSection>
        </>
      )}
    </DetailDrawer>
  );
}
