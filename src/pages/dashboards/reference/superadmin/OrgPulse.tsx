import {
  Activity, BellRing, Building2, CalendarDays, Database, FileCheck2, FileText, Fingerprint, Megaphone, Network,
  Settings, ShieldCheck, UserCheck, UserMinus, UserPlus, Users, UserX,
} from "lucide-react";
import { DonutChart, LazySection, Panel, PulseGrid, PulseTile, TrendChart } from "../../kit";
import { ReferenceListRow, ReferenceProgress, ReferenceQuickLink } from "../../ReferenceDashboardUI";
import type { ReferenceDashboardData } from "../../reference-dashboard-model";
import { arrayAt, asNumber, formatValue, metricAsOf, metricDetail, metricUnavailableReason, metricValue, numberAt, read } from "../../reference-dashboard-model";

/** Org pulse: every headline the old dashboard carried, regrouped, with each tile drilling somewhere real. */
export function OrgPulse({ data }: { data: ReferenceDashboardData }) {
  const m = data.metrics;
  const drill = (key: string): { onDrilldown?: () => void } => (data.drilldownFor ?? (() => ({})))(key);
  const sys = (read(data.system, "metrics") ?? {}) as Record<string, unknown>;
  const loading = data.loading;
  const active = asNumber(sys.activeEmployees) ?? metricDetail(m, "hc", "active") ?? metricValue(m, "hc");
  const asOf = metricAsOf(m, "att");
  const present = metricDetail(m, "att", "present");
  const live = metricDetail(m, "att", "livePresent");
  const absent = metricDetail(m, "att", "absent");
  const onLeave = metricDetail(m, "att", "onLeave");
  const rate = metricDetail(m, "att", "attendanceRate") ?? metricValue(m, "att");
  const shortage = metricDetail(m, "hiringAlert", "shortage") ?? metricValue(m, "hiringAlert");
  const short = metricDetail(m, "hiringAlert", "processesShort");
  const branches = asNumber(sys.totalBranches ?? data.workforce.total_branches);
  const openPositions = asNumber(data.ats.open_positions ?? data.ats.openPositions ?? data.ats.total_open_positions);
  const uptime = sys.systemUptime ?? sys.uptime ?? data.system.uptime;
  const ready = metricDetail(m, "payroll", "readyCount");
  const payTotal = metricDetail(m, "payroll", "total");
  const payPct = ready !== null && payTotal ? Math.round((ready / payTotal) * 100) : null;
  const leaveRows = arrayAt(data.workforce, "leave_summary");
  const sumLeave = (needle?: string) => leaveRows.reduce((s, r) => (!needle || String(r.status ?? "").toLowerCase().includes(needle) ? s + (asNumber(r.count ?? r.value) ?? 0) : s), 0);
  const movement = arrayAt(data.workforce, "movement").slice(-12).map((r) => ({ label: String(r.period ?? r.label ?? ""), value: Number(r.headcount ?? r.value ?? 0) }));
  const joiners = arrayAt(data.workforce, "recent_joiners");
  const branchRows = arrayAt(data.workforce, "branches").length ? arrayAt(data.workforce, "branches") : arrayAt(data.workforce, "branch_snapshot");
  const day = asOf ? `Processed day ${asOf}` : "Last processed day";

  return (
    <div className="space-y-4">
      <PulseGrid cols={5}>
        <PulseTile label="Total employees" value={active} icon={Users} tone="blue" loading={loading} helper="Active, joined on or before today" unavailable={metricUnavailableReason(m, "hc")} onDrill={drill("hc").onDrilldown} href={drill("hc").onDrilldown ? undefined : "/employees"} />
        <PulseTile label="Logged in now" value={live} icon={Fingerprint} tone="green" loading={loading} helper="Live attendance sessions today" href="/attendance" />
        <PulseTile label="Present" value={present} icon={UserCheck} tone="green" loading={loading} helper={`${rate === null ? "—" : `${rate}%`} of expected · ${day}`} onDrill={drill("att").onDrilldown} href={drill("att").onDrilldown ? undefined : "/attendance"} />
        <PulseTile label="On leave" value={onLeave} icon={CalendarDays} tone="amber" loading={loading} helper={day} onDrill={drill("att").onDrilldown} href={drill("att").onDrilldown ? undefined : "/leaves"} />
        <PulseTile label="Absent" value={absent} icon={UserMinus} tone="red" loading={loading} helper={day} onDrill={drill("att").onDrilldown} href={drill("att").onDrilldown ? undefined : "/attendance"} />
        <PulseTile label="Hiring shortage" value={shortage} icon={UserX} tone="red" loading={loading} helper={short ? `${short} process${short === 1 ? "" : "es"} short of mandate + buffer` : "Against mandate + buffer"} unavailable={metricUnavailableReason(m, "hiringAlert")} onDrill={drill("hiringAlert").onDrilldown} href={drill("hiringAlert").onDrilldown ? undefined : "/recruitment/job-requisition"} />
        <PulseTile label="Open positions" value={openPositions} icon={Network} tone="blue" loading={loading} helper="Approved requisitions, unfilled seats" href="/recruitment/job-requisition" />
        <PulseTile label="Payroll ready" value={payPct} unit="percent" icon={FileCheck2} tone={payPct === null ? "slate" : payPct >= 95 ? "green" : "amber"} loading={loading} helper={ready !== null && payTotal ? `${ready.toLocaleString("en-IN")} of ${payTotal.toLocaleString("en-IN")} employees payable` : undefined} unavailable={metricUnavailableReason(m, "payroll")} onDrill={drill("payroll").onDrilldown} href={drill("payroll").onDrilldown ? undefined : "/payroll"} />
        <PulseTile label="Branches" value={branches} icon={Building2} tone="violet" loading={loading} helper="Active branches" href="/employees" />
        <PulseTile label="API process uptime" value={typeof uptime === "string" ? uptime : "—"} icon={Activity} tone={uptime ? "green" : "slate"} loading={loading} helper={uptime ? "Since the last server restart, not availability" : "Source unavailable"} href="/security-center" />
      </PulseGrid>

      <div className="grid gap-4 xl:grid-cols-3">
        <LazySection eager><Panel title="Attendance mix" subtitle={day}><DonutChart size={150} centerLabel={rate === null ? undefined : `${rate}%`} points={[{ label: "Present", value: present }, { label: "On leave", value: onLeave }, { label: "Absent", value: absent }]} /></Panel></LazySection>
        <LazySection><Panel title="Leave overview" subtitle="Requests this month" href="/leaves">
          <div className="grid grid-cols-3 gap-3 text-center">
            {[["Total", sumLeave()], ["Approved", sumLeave("approved")], ["Pending", sumLeave("pending")]].map(([l, v]) => <div key={String(l)}><p className="text-[11px] text-slate-500">{l}</p><p className="kit-num text-[24px] font-extrabold text-slate-900">{formatValue(v)}</p></div>)}
          </div>
          <div className="mt-4 rounded-xl bg-slate-50 p-3"><ReferenceProgress label="Leave balance used" value={asNumber(data.workforce.leave_balance_usage_pct)} max={100} suffix="%" tone="blue" /></div>
        </Panel></LazySection>
        <LazySection><Panel title="Headcount trend" subtitle="This year" href="/employees"><TrendChart points={movement} height={170} /></Panel></LazySection>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <LazySection><Panel title="Branch snapshot" subtitle="Staff logged in right now (not a completed day)" href="/employees" bodyClassName="p-0">
          <div className="overflow-x-auto"><table className="w-full min-w-[420px] text-left text-[12px]"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-4 py-2">Branch / process</th><th>Staff</th><th>Logged in</th><th>Share</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{branchRows.length ? branchRows.slice(0, 8).map((r, i) => {
              const p = asNumber(r.present_pct ?? r.attendance_pct);
              return <tr key={String(r.id ?? i)}><td className="px-4 py-2.5 font-medium text-slate-900">{String(r.branch_name ?? r.process_name ?? r.name ?? `Scope ${i + 1}`)}</td><td>{formatValue(r.employee_count ?? r.employees)}</td><td>{formatValue(asNumber(r.present_count ?? r.present))}</td><td className={p === null ? "text-slate-400" : "font-semibold"}>{p === null ? "No sessions" : formatValue(p, "%")}</td></tr>;
            }) : <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-400">{loading ? "Loading branches…" : "No branch data"}</td></tr>}</tbody></table></div>
        </Panel></LazySection>
        <LazySection><Panel title="Recent joiners" subtitle="Last 30 days" href="/employees" bodyClassName="p-0">
          <div className="max-h-[260px] divide-y divide-slate-100 overflow-y-auto">{joiners.length ? joiners.slice(0, 6).map((r, i) => (
            <ReferenceListRow key={String(r.id ?? i)} icon={UserPlus} title={String(r.employee_name ?? r.full_name ?? r.name ?? `New joiner ${i + 1}`)} subtitle={String(r.designation_name ?? r.designation ?? "Designation not set")} value={String(r.joining_date ?? r.date ?? "—")} tone="blue" />
          )) : <p className="px-4 py-10 text-center text-[12px] text-slate-400">No joiners in the last 30 days</p>}</div>
        </Panel></LazySection>
        <LazySection><Panel title="Approval snapshot" subtitle="Counts from the workforce feed" bodyClassName="p-0"><div className="divide-y divide-slate-100">
          <ReferenceListRow icon={CalendarDays} title="Leave requests (since 25 Aug)" value={asNumber(data.workforce.pending_leave_requests)} tone="green" href="/leaves" />
          <ReferenceListRow icon={FileCheck2} title="Timesheet approvals" subtitle="Not tracked: nothing writes timesheet items" value={asNumber(data.workforce.pending_timesheets)} tone="slate" href="/work-inbox" />
          <ReferenceListRow icon={FileText} title="Employee expense claims" value={asNumber(data.workforce.pending_expense_claims)} tone="amber" href="/payroll/reimbursements" />
        </div></Panel></LazySection>
      </div>
    </div>
  );
}

const QUICK = [
  [UserPlus, "Add employee", "/employees", "blue"], [Megaphone, "Announcement", "/communication/dispatch", "red"], [Database, "Bulk import", "/bulk-upload", "green"],
  [FileCheck2, "Run payroll", "/payroll", "violet"], [Activity, "Reports", "/reports", "green"], [Users, "Access control", "/settings/access-control", "blue"],
  [Settings, "Settings", "/settings", "slate"], [FileText, "Audit log", "/audit-log", "amber"],
] as const;

export function QuickActions() {
  return <Panel title="Quick actions"><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{QUICK.map(([icon, title, href, tone]) => <ReferenceQuickLink key={href} icon={icon} title={title} href={href} tone={tone} />)}</div></Panel>;
}

/** Things the platform owner would want a number for but nothing records. Said plainly, never as a zero. */
export function BlindSpots({ data }: { data: ReferenceDashboardData }) {
  const sys = (read(data.system, "metrics") ?? {}) as Record<string, unknown>;
  const twoFa = asNumber(sys.usersWithout2fa);
  const rows: Array<[string, string, unknown]> = [
    ["Users without 2FA", "auth_user has no 2FA flag; a challenge table exists but no per-user enrolment.", twoFa],
    ["Database backup status", "No backup job reports into the database.", data.system.backup_status ?? null],
    ["API latency and 5xx rate", "No request log is stored. The old analytics panel queried tables that do not exist.", null],
    ["Statutory filing due dates", "Not linked to payroll runs.", null],
  ];
  return (
    <Panel title="Blind spots" subtitle="No data source yet: shown as unknown, not as zero" bodyClassName="p-0">
      <ul className="divide-y divide-slate-100">{rows.map(([t, why, v]) => (
        <li key={t} className="flex items-center gap-3 px-4 py-2.5"><ShieldCheck className="h-4 w-4 shrink-0 text-slate-400" aria-hidden /><div className="min-w-0 flex-1"><p className="text-[13px] font-semibold text-slate-800">{t}</p><p className="text-[11px] text-slate-500">{why}</p></div><span className="kit-num text-[14px] font-extrabold text-slate-500">{v === null || v === undefined ? "—" : String(v)}</span></li>
      ))}</ul>
    </Panel>
  );
}

export function RecentActivity({ data }: { data: ReferenceDashboardData }) {
  const acts = arrayAt(data.system, "activities");
  const mods = arrayAt(data.system, "modules");
  return (
    <Panel title="Recent audited activity" href="/audit-log" hrefLabel="Audit log" bodyClassName="p-0">
      <div className="max-h-[300px] divide-y divide-slate-100 overflow-y-auto">
        {acts.length ? acts.slice(0, 10).map((r, i) => <ReferenceListRow key={String(r.id ?? i)} icon={BellRing} title={String(r.user ?? r.user_name ?? r.actor ?? "System")} subtitle={String(r.action ?? r.description ?? "System activity")} value={String(r.timestamp ?? r.created_at ?? "—")} tone={String(r.status ?? "").toLowerCase() === "error" ? "red" : "blue"} />)
          : mods.slice(0, 8).map((r, i) => <ReferenceListRow key={String(r.module ?? i)} icon={Activity} title={String(r.module ?? `Module ${i + 1}`)} subtitle={`${formatValue(r.recordCount)} records`} value={String(r.status ?? "—")} tone={String(r.status ?? "").toLowerCase() === "operational" ? "green" : "amber"} />)}
      </div>
    </Panel>
  );
}

export function ComplianceAlerts({ data }: { data: ReferenceDashboardData }) {
  return (
    <Panel title="Compliance" href="/compliance/statutory" hrefLabel="Statutory" bodyClassName="p-0"><div className="divide-y divide-slate-100">
      <ReferenceListRow icon={ShieldCheck} title="Documents expired" value={asNumber(data.workforce.expired_documents)} tone="red" href="/compliance/statutory" />
      <ReferenceListRow icon={ShieldCheck} title="Policies pending acknowledgement" value={asNumber(data.workforce.pending_policy_acknowledgements)} tone="amber" href="/compliance/statutory" />
      <ReferenceListRow icon={CalendarDays} title="Statutory filing due" subtitle="Run-linked source unavailable" value="—" tone="slate" href="/payroll/statutory-filing" />
      <ReferenceListRow icon={Activity} title="Annual appraisal cycle" value={data.workforce.appraisal_completion_pct} tone="blue" href="/performance" />
      <ReferenceListRow icon={Building2} title="On approved leave today" value={asNumber(data.workforce.on_leave ?? numberAt(data.workforce, "summary", "on_leave"))} tone="slate" href="/leaves" />
    </div></Panel>
  );
}

