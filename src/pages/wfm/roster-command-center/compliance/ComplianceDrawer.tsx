import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { DetailDrawer, DrawerSection, FieldGrid } from "@/components/wfm/console/DetailDrawer";
import { StatusPill, type PillTone } from "@/components/wfm/console/StatusPill";
import { Sparkline } from "@/components/wfm/console/Sparkline";
import { fmtDate, fmtDateTime, fmtInt, fmtMonth, fmtPct, scoreBand } from "./format";
import type { ComplianceSummary, DrawerTarget, RuleId, Severity } from "./types";

const SEV_TONE: Record<Severity, PillTone> = { high: "red", medium: "amber", low: "blue" };
export const SeverityPill = ({ s }: { s: Severity }) => <StatusPill tone={SEV_TONE[s] ?? "neutral"}>{s === "high" ? "High" : s === "medium" ? "Medium" : "Low"}</StatusPill>;

interface Props {
  target: DrawerTarget | null;
  onClose: () => void;
  onOpen: (t: DrawerTarget) => void;
  scopeQs: string;
  month: string;
  summary?: ComplianceSummary;
}

function useDetail<T>(path: string | null, scopeQs: string, month: string) {
  return useQuery({
    queryKey: ["compliance", "detail", path, scopeQs, month],
    enabled: !!path,
    staleTime: 60_000,
    queryFn: ({ signal }) => hrmsApi.get<T>(`${path}?${scopeQs}${scopeQs ? "&" : ""}period=${month}`, 60_000, signal),
  });
}

function Loading({ q }: { q: { isPending: boolean; isError: boolean } }) {
  if (q.isPending) return <div className="space-y-3" role="status" aria-label="Loading details">{[70, 90, 55, 80].map((w) => <div key={w} className="h-4 animate-pulse rounded bg-slate-100" style={{ width: `${w}%` }} />)}</div>;
  if (q.isError) return <p className="text-sm text-red-800">Details could not be loaded. Close and try again.</p>;
  return null;
}

function Table({ head, rows, empty = "None" }: { head: string[]; rows: ReactNode[][]; empty?: string }) {
  if (!rows.length) return <p className="text-sm text-slate-500">{empty}</p>;
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/60"><tr>{head.map((h, i) => <th key={h} scope="col" className={`px-3 py-1.5 text-xs font-semibold text-slate-700 ${i === 0 ? "text-left" : "text-right first:text-left"}`}>{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-border">{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={`px-3 py-1.5 tabular-nums ${j === 0 ? "text-left" : "text-right"}`}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

const LinkBtn = ({ children, onClick }: { children: ReactNode; onClick: () => void }) => (
  <button type="button" onClick={onClick} className="cursor-pointer text-left font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{children}</button>
);

interface EmployeeDetail {
  employee: { id: string; code: string; name: string; branchName: string | null; processName: string | null; designation: string | null; employmentType: string | null; employmentStatus: string | null; active: boolean; dateOfJoining: string | null; dateOfExit: string | null; managerName: string | null; managerCode: string | null };
  incidents: Array<{ id: string; ruleId: RuleId; ruleName: string; severity: Severity; date: string; detail: string; dates: string[] }>;
  monthly: Array<{ month: string; violations: number; compliant: boolean }>;
  rosterDays: Array<{ date: string; weekOff: boolean; shiftName: string | null; shiftTime: string | null; attendanceStatus: string | null; late: boolean }>;
  timeline: Array<{ id: string; at: string; actor: string; decision: string; rosterDate: string; remarks: string | null }>;
}

function EmployeeBody({ id, scopeQs, month }: { id: string; scopeQs: string; month: string }) {
  const q = useDetail<EmployeeDetail>(`/api/wfm/compliance/detail/employee/${encodeURIComponent(id)}`, scopeQs, month);
  if (!q.data) return <Loading q={q} />;
  const d = q.data;
  const e = d.employee;
  return (
    <>
      <DrawerSection label="Employee">
        <FieldGrid fields={[["Name", e.name], ["Code", e.code], ["Branch", e.branchName], ["Process", e.processName], ["Designation", e.designation], ["Reporting manager", e.managerName ? `${e.managerName} (${e.managerCode ?? ""})` : null], ["Employment", `${e.employmentType ?? "—"} / ${e.employmentStatus ?? "—"}`], ["Joined", fmtDate(e.dateOfJoining)], ["Exit date", e.dateOfExit ? fmtDate(e.dateOfExit) : null]]} />
      </DrawerSection>
      <DrawerSection label={`Rule breaches in ${fmtMonth(month)}`}>
        {d.incidents.length ? (
          <ul className="space-y-2">{d.incidents.map((i) => (
            <li key={i.id} className="rounded-md border border-border p-2 text-sm">
              <div className="flex items-center justify-between gap-2"><span className="font-medium">{i.ruleName}</span><SeverityPill s={i.severity} /></div>
              <p className="mt-1 text-slate-700">{i.detail}</p>
              <p className="mt-1 text-xs text-slate-600 tabular-nums">Dates: {i.dates.slice(0, 10).map(fmtDate).join(", ")}{i.dates.length > 10 ? ` +${i.dates.length - 10} more` : ""}</p>
            </li>))}</ul>
        ) : undefined}
      </DrawerSection>
      <DrawerSection label="Six-month trend">
        <div className="flex items-center gap-3">
          <Sparkline values={d.monthly.map((m) => m.violations)} className="text-red-700" ariaLabel="Violations per month" />
          <span className="text-xs text-slate-600">Violations per month, oldest to newest</span>
        </div>
        <Table head={["Month", "Violations", "Status"]} rows={d.monthly.map((m) => [fmtMonth(m.month), fmtInt(m.violations), m.violations === 0 ? "Compliant" : "Breach"])} />
      </DrawerSection>
      <DrawerSection label={`Roster and attendance, ${fmtMonth(month)}`}>
        <Table head={["Date", "Shift", "Attendance"]} rows={d.rosterDays.map((r) => [fmtDate(r.date), r.weekOff ? "Week off" : `${r.shiftName ?? "—"}${r.shiftTime ? ` ${r.shiftTime}` : ""}`, r.attendanceStatus ? `${r.attendanceStatus.replace(/_/g, " ")}${r.late ? " (late)" : ""}` : "—"])} />
      </DrawerSection>
      <DrawerSection label="Roster decision timeline and audit entries">
        {d.timeline.length ? (
          <ol className="space-y-2 border-l border-border pl-3">{d.timeline.map((t) => (
            <li key={t.id} className="text-sm"><p className="font-medium capitalize">{t.decision} <span className="font-normal text-slate-600">for {fmtDate(t.rosterDate)}</span></p><p className="text-xs text-slate-600 tabular-nums">{t.actor} on {fmtDateTime(t.at)}</p>{t.remarks && <p className="text-xs text-slate-700">{t.remarks}</p>}</li>))}</ol>
        ) : undefined}
      </DrawerSection>
    </>
  );
}

interface RuleDetail { ruleName: string; description: string; threshold: string; severity: Severity; totalIncidents: number; employeesAffected: number; monthly: Array<{ month: string; violations: number }>; byBranch: Array<{ branchId: string; branchName: string; incidents: number; employees: number }>; incidents: Array<{ id: string; date: string; employeeId: string; employeeCode: string; employeeName: string; branchName: string | null; severity: Severity; detail: string }>; truncated: boolean }

function RuleBody({ id, scopeQs, month, onOpen }: { id: RuleId; scopeQs: string; month: string; onOpen: Props["onOpen"] }) {
  const q = useDetail<RuleDetail>(`/api/wfm/compliance/detail/rule/${id}`, scopeQs, month);
  if (!q.data) return <Loading q={q} />;
  const d = q.data;
  return (
    <>
      <DrawerSection label="Rule"><FieldGrid fields={[["Rule", d.ruleName], ["Definition", d.description], ["Threshold", d.threshold], ["Incidents", fmtInt(d.totalIncidents)], ["Employees affected", fmtInt(d.employeesAffected)]]} /></DrawerSection>
      <DrawerSection label="Six-month trend">
        <div className="flex items-center gap-3"><Sparkline values={d.monthly.map((m) => m.violations)} className="text-red-700" ariaLabel="Incidents per month" /><span className="text-xs text-slate-600">Incidents per month</span></div>
        <Table head={["Month", "Incidents"]} rows={d.monthly.map((m) => [fmtMonth(m.month), fmtInt(m.violations)])} />
      </DrawerSection>
      <DrawerSection label="By branch"><Table head={["Branch", "Incidents", "Employees"]} rows={d.byBranch.map((b) => [b.branchId === "none" ? b.branchName : <LinkBtn key={b.branchId} onClick={() => onOpen({ type: "branch", id: b.branchId })}>{b.branchName}</LinkBtn>, fmtInt(b.incidents), fmtInt(b.employees)])} /></DrawerSection>
      <DrawerSection label="Incidents">
        <Table head={["Date", "Employee", "Detail"]} rows={d.incidents.map((i) => [fmtDate(i.date), <LinkBtn key={i.id} onClick={() => onOpen({ type: "employee", id: i.employeeId })}>{i.employeeName} ({i.employeeCode})</LinkBtn>, <span key="d" className="text-left text-xs">{i.detail}</span>])} />
        {d.truncated && <p className="text-xs text-slate-600">Showing the latest 200 incidents.</p>}
      </DrawerSection>
    </>
  );
}

interface BranchDetail { branchName: string; compliancePct: number | null; previousCompliancePct: number | null; rostered: number; employeesWithViolations: number; totalViolations: number; rules: Array<{ ruleId: RuleId; ruleName: string; violationCount: number; employeesAffected: number }>; monthly: Array<{ month: string; compliancePct: number | null; violations: number }>; topEmployees: Array<{ employeeId: string; employeeCode: string; employeeName: string; processName: string | null; violations: number }> }

function BranchBody({ id, scopeQs, month, onOpen }: { id: string; scopeQs: string; month: string; onOpen: Props["onOpen"] }) {
  const q = useDetail<BranchDetail>(`/api/wfm/compliance/detail/branch/${encodeURIComponent(id)}`, scopeQs, month);
  if (!q.data) return <Loading q={q} />;
  const d = q.data;
  return (
    <>
      <DrawerSection label="Branch"><FieldGrid fields={[["Branch", d.branchName], ["Compliance", `${fmtPct(d.compliancePct)} (${scoreBand(d.compliancePct).label})`], ["Previous month", fmtPct(d.previousCompliancePct)], ["Rostered employees", fmtInt(d.rostered)], ["Employees with breaches", fmtInt(d.employeesWithViolations)], ["Total violations", fmtInt(d.totalViolations)]]} /></DrawerSection>
      <DrawerSection label="Rules"><Table head={["Rule", "Incidents", "Employees"]} rows={d.rules.map((r) => [<LinkBtn key={r.ruleId} onClick={() => onOpen({ type: "rule", id: r.ruleId })}>{r.ruleName}</LinkBtn>, fmtInt(r.violationCount), fmtInt(r.employeesAffected)])} /></DrawerSection>
      <DrawerSection label="Six-month trend">
        <div className="flex items-center gap-3"><Sparkline values={d.monthly.map((m) => m.compliancePct ?? 0)} className="text-blue-800" ariaLabel="Compliance per month" /><span className="text-xs text-slate-600">Compliance per month</span></div>
        <Table head={["Month", "Compliance", "Violations"]} rows={d.monthly.map((m) => [fmtMonth(m.month), fmtPct(m.compliancePct), fmtInt(m.violations)])} />
      </DrawerSection>
      <DrawerSection label="Employees with most breaches"><Table head={["Employee", "Process", "Violations"]} rows={d.topEmployees.map((e) => [<LinkBtn key={e.employeeId} onClick={() => onOpen({ type: "employee", id: e.employeeId })}>{e.employeeName} ({e.employeeCode})</LinkBtn>, e.processName ?? "—", fmtInt(e.violations)])} /></DrawerSection>
    </>
  );
}

function OverviewBody({ summary, month, onOpen }: { summary?: ComplianceSummary; month: string; onOpen: Props["onOpen"] }) {
  if (!summary) return <p className="text-sm text-slate-500">None</p>;
  const a = summary.attendance;
  return (
    <>
      <DrawerSection label="Period"><FieldGrid fields={[["Month", fmtMonth(month)], ["Compliance", fmtPct(summary.compliancePct)], ["Rostered employees", fmtInt(summary.totalEmployees)], ["Employees with breaches", fmtInt(summary.employeesWithViolations)], ["Total violations", fmtInt(summary.totalViolations)], ["Previous month", summary.previous ? `${fmtPct(summary.previous.compliancePct)} / ${fmtInt(summary.previous.totalViolations)} violations` : null]]} /></DrawerSection>
      <DrawerSection label="How the score is calculated"><p className="text-sm text-slate-700">Compliance is the share of rostered employees with no breach of the five roster rules in the month. It is not an attendance measure. Every count on this tab comes from the same incident list, so the score, rule counts, violation feed and trend always agree.</p></DrawerSection>
      <DrawerSection label="Rules"><Table head={["Rule", "Incidents", "Employees"]} rows={summary.rules.map((r) => [<LinkBtn key={r.ruleId} onClick={() => onOpen({ type: "rule", id: r.ruleId })}>{r.ruleName}</LinkBtn>, fmtInt(r.violationCount), fmtInt(r.employeesAffected)])} /></DrawerSection>
      <DrawerSection label="Six-month history"><Table head={["Month", "Compliance", "Violations"]} rows={summary.history.map((h) => [fmtMonth(h.month), fmtPct(h.compliancePct), fmtInt(h.violations)])} /></DrawerSection>
      <DrawerSection label="Attendance adherence (separate measure)">{a ? <FieldGrid fields={[["Through", fmtDate(a.through)], ["Rostered working days", fmtInt(a.scheduled)], ["Attended", fmtInt(a.adhered + a.late)], ["Late", fmtInt(a.late)], ["Absent", fmtInt(a.absent)], ["Missing punch", fmtInt(a.missingPunch)], ["Not reconciled", fmtInt(a.unreconciled)], ["Leave / holiday (excluded)", fmtInt(a.excused)]]} /> : undefined}</DrawerSection>
    </>
  );
}

export function ComplianceDrawer({ target, onClose, onOpen, scopeQs, month, summary }: Props) {
  const title = !target ? "" : target.type === "employee" ? "Employee compliance" : target.type === "rule" ? "Rule detail" : target.type === "branch" ? "Branch compliance" : "Compliance overview";
  return (
    <DetailDrawer open={!!target} onOpenChange={(o) => { if (!o) onClose(); }} title={title} subtitle={`Period: ${fmtMonth(month)}`} badge={target?.type === "overview" ? <StatusPill tone={scoreBand(summary?.compliancePct ?? null).tone}>{scoreBand(summary?.compliancePct ?? null).label}</StatusPill> : undefined}>
      {target?.type === "employee" && <EmployeeBody id={target.id} scopeQs={scopeQs} month={month} />}
      {target?.type === "rule" && <RuleBody id={target.id} scopeQs={scopeQs} month={month} onOpen={onOpen} />}
      {target?.type === "branch" && <BranchBody id={target.id} scopeQs={scopeQs} month={month} onOpen={onOpen} />}
      {target?.type === "overview" && <OverviewBody summary={summary} month={month} onOpen={onOpen} />}
    </DetailDrawer>
  );
}
