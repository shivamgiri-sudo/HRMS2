import {
  Activity,
  BellRing,
  Building2,
  CalendarDays,
  Database,
  FileCheck2,
  FileText,
  Megaphone,
  Network,
  Settings,
  ShieldCheck,
  TriangleAlert,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react";

import {
  ReferenceDonut,
  ReferenceHeader,
  ReferenceLineChart,
  ReferenceListRow,
  ReferenceMetricGrid,
  ReferencePanel,
  ReferenceProgress,
  ReferenceQuickLink,
} from "../ReferenceDashboardUI";
import type { ReferenceDashboardData } from "../reference-dashboard-model";
import {
  arrayAt,
  asNumber,
  formatValue,
  metricDetail,
  metricValue,
  numberAt,
  read,
} from "../reference-dashboard-model";
import { useReferenceDashboardShell } from "./ReferenceDashboardShell";

export function SuperAdminReferenceLayout({ data }: { data: ReferenceDashboardData }) {
  const { productHeaderControls } = useReferenceDashboardShell();
  const m = data.metrics;
  const systemMetrics = (read(data.system, "metrics") ?? {}) as Record<string, unknown>;
  const active = asNumber(systemMetrics.activeEmployees) ?? metricDetail(m, "hc", "active") ?? metricValue(m, "hc");
  const present = metricDetail(m, "att", "present");
  const absent = metricDetail(m, "att", "absent");
  const attendance = metricDetail(m, "att", "attendanceRate") ?? metricValue(m, "att");
  const onLeave = metricDetail(m, "att", "onLeave") ?? asNumber(data.workforce.on_leave ?? numberAt(data.workforce, "summary", "on_leave"));
  const branches = asNumber(systemMetrics.totalBranches ?? data.workforce.total_branches);
  const openPositions = asNumber(data.ats.open_positions ?? data.ats.openPositions ?? data.ats.total_open_positions);
  const uptime = systemMetrics.systemUptime ?? systemMetrics.uptime ?? data.system.uptime ?? "—";
  const leaveRows = arrayAt(data.workforce, "leave_summary");
  const recentJoiners = arrayAt(data.workforce, "recent_joiners");
  const movement = arrayAt(data.workforce, "movement").slice(-12).map((row) => ({ label: String(row.period ?? row.label ?? ""), value: Number(row.headcount ?? row.value ?? 0) }));
  const branchRows = arrayAt(data.workforce, "branches").length ? arrayAt(data.workforce, "branches") : arrayAt(data.workforce, "branch_snapshot");
  const activities = arrayAt(data.system, "activities");
  const modules = arrayAt(data.system, "modules");
  const pending = asNumber(data.summary.workItems?.pending_count);
  const leaveTotal = leaveRows.reduce((sum, row) => sum + (asNumber(row.count ?? row.value) ?? 0), 0);
  const leaveApproved = leaveRows.reduce((sum, row) => String(row.status ?? "").toLowerCase().includes("approved") ? sum + (asNumber(row.count ?? row.value) ?? 0) : sum, 0);
  const leavePending = leaveRows.reduce((sum, row) => String(row.status ?? "").toLowerCase().includes("pending") ? sum + (asNumber(row.count ?? row.value) ?? 0) : sum, 0);
  const pendingQueues = (read(data.payroll, "pendingQueues") ?? {}) as Record<string, unknown>;

  return (
    <div className="reference-dashboard-page">
      <ReferenceHeader title="Super Admin Dashboard 👋" subtitle="Monitor your entire HR ecosystem and system health" right={productHeaderControls} />

      <ReferenceMetricGrid columns={7} loading={data.loading} metrics={[
        { label: "Total Employees", value: active, helper: "vs last month", icon: Users, tone: "blue" },
        { label: "Present Today", value: present, helper: attendance === null ? "Today" : `${attendance}%`, icon: UserCheck, tone: "green" },
        { label: "On Leave Today", value: onLeave, helper: "Approved leave", icon: CalendarDays, tone: "red" },
        { label: "Absent Today", value: absent, helper: "Attendance status", icon: UserMinus, tone: "red" },
        { label: "Total Branches", value: branches, helper: "Active", icon: Building2, tone: "green" },
        { label: "Open Positions", value: openPositions, helper: "Across departments", icon: Network, tone: "blue" },
        { label: "System Uptime", value: uptime, helper: "Excellent", icon: Activity, tone: "green" },
      ]} />

      <div className="grid gap-4 xl:grid-cols-[0.82fr_0.78fr_0.78fr_1.22fr]">
        <ReferencePanel title="Attendance Overview">
          <ReferenceDonut compact centerValue={attendance === null ? null : `${attendance}%`} centerLabel="Present" data={[
            { name: "Present", value: present ?? 0 },
            { name: "On Leave", value: onLeave ?? 0 },
            { name: "Absent", value: absent ?? 0 },
          ]} />
        </ReferencePanel>

        <ReferencePanel title="Leave Overview (This Month)" action={<a className="text-[10px] font-semibold text-[#0b63e5]" href="/leaves">View all</a>}>
          <div className="grid grid-cols-3 gap-3">
            <div><p className="text-[9px] text-[#71809a]">Total Leaves</p><p className="mt-2 text-[23px] font-extrabold text-[#0b1f44]">{formatValue(leaveTotal || null)}</p></div>
            <div><p className="text-[9px] text-[#71809a]">Approved</p><p className="mt-2 text-[23px] font-extrabold text-[#0b1f44]">{formatValue(leaveApproved || null)}</p></div>
            <div><p className="text-[9px] text-[#71809a]">Pending</p><p className="mt-2 text-[23px] font-extrabold text-[#0b1f44]">{formatValue(leavePending || null)}</p></div>
          </div>
          <div className="mt-5 rounded-lg bg-[#f4f8ff] p-4"><ReferenceProgress label="Leave Balance Usage" value={asNumber(data.workforce.leave_balance_usage_pct)} max={100} suffix="%" tone="blue" /></div>
        </ReferencePanel>

        <ReferencePanel title="Recent Joiners" action={<a className="text-[10px] font-semibold text-[#0b63e5]" href="/employees">View all</a>} bodyClassName="p-0">
          <div className="max-h-[230px] divide-y divide-[#edf1f6] overflow-y-auto">
            {recentJoiners.length ? recentJoiners.slice(0, 6).map((row, index) => (
              <ReferenceListRow key={String(row.id ?? index)} icon={UserPlus} title={String(row.employee_name ?? row.full_name ?? row.name ?? `New Joiner ${index + 1}`)} subtitle={String(row.designation_name ?? row.designation ?? "Employee")} value={String(row.joining_date ?? row.date ?? "—")} tone="blue" />
            )) : <div className="px-4 py-12 text-center text-[10px] text-[#94a3b8]">Recent joiners are unavailable</div>}
          </div>
        </ReferencePanel>

        <ReferencePanel title="Employee Trend (This Year)" action={<span className="text-[10px] text-[#61708a]">This Year</span>}><ReferenceLineChart data={movement} height={190} /></ReferencePanel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.05fr_0.9fr_1.05fr]">
        <ReferencePanel title="Branch / Process Snapshot" action={<a className="text-[10px] font-semibold text-[#0b63e5]" href="/reports">View all</a>} bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-[9px]"><thead className="bg-[#f8fafc] text-[#61708a]"><tr><th className="px-4 py-2">Branch / Process</th><th>Employees</th><th>Present %</th><th>Status</th></tr></thead><tbody className="divide-y divide-[#edf1f6]">
              {branchRows.length ? branchRows.slice(0, 8).map((row, index) => { const pct = asNumber(row.present_pct ?? row.attendance_pct); return <tr key={String(row.id ?? index)}><td className="px-4 py-2.5 font-medium text-[#1d2b45]">{String(row.branch_name ?? row.process_name ?? row.name ?? `Scope ${index + 1}`)}</td><td>{formatValue(row.employee_count ?? row.employees)}</td><td>{formatValue(pct, "%")}</td><td className={pct !== null && pct >= 70 ? "font-semibold text-[#16a34a]" : "font-semibold text-[#f97316]"}>{pct !== null && pct >= 70 ? "Healthy" : "Warning"}</td></tr>; }) : <tr><td colSpan={4} className="px-4 py-10 text-center text-[#94a3b8]">Branch snapshot is unavailable</td></tr>}
            </tbody></table>
          </div>
        </ReferencePanel>

        <ReferencePanel title="Approval Queue" action={<span className="rounded-full bg-[#edf4ff] px-2 py-0.5 text-[9px] font-bold text-[#0b63e5]">{formatValue(pending)} Pending</span>} bodyClassName="p-0">
          <div className="divide-y divide-[#edf1f6]">
            <ReferenceListRow icon={CalendarDays} title="Leave Requests" value={asNumber(data.workforce.pending_leave_requests)} tone="green" href="/leaves" />
            <ReferenceListRow icon={FileCheck2} title="Timesheet Approvals" value={asNumber(data.workforce.pending_timesheets)} tone="blue" href="/work-inbox" />
            <ReferenceListRow icon={FileText} title="Expense Claims" value={asNumber(data.workforce.pending_expense_claims)} tone="amber" href="/expenses/approvals" />
            <ReferenceListRow icon={Network} title="Job Requisitions" value={asNumber(data.ats.pending_requisitions)} tone="violet" href="/ats/dashboard" />
          </div>
        </ReferencePanel>

        <ReferencePanel title="Quick Actions">
          <div className="grid grid-cols-4 gap-3">
            <ReferenceQuickLink icon={UserPlus} title="Add Employee" href="/employees" tone="blue" />
            <ReferenceQuickLink icon={Megaphone} title="Create Announcement" href="/communication/dispatch" tone="red" />
            <ReferenceQuickLink icon={Database} title="Bulk Import" href="/bulk-upload" tone="green" />
            <ReferenceQuickLink icon={FileCheck2} title="Run Payroll" href="/payroll" tone="violet" />
            <ReferenceQuickLink icon={Activity} title="Generate Reports" href="/reports" tone="green" />
            <ReferenceQuickLink icon={Users} title="User Management" href="/settings/access-control" tone="blue" />
            <ReferenceQuickLink icon={Settings} title="System Settings" href="/settings" tone="slate" />
            <ReferenceQuickLink icon={FileText} title="Audit Logs" href="/audit-log" tone="amber" />
          </div>
        </ReferencePanel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.9fr_0.9fr_1.2fr]">
        <ReferencePanel title="System Alerts" action={<a className="text-[10px] font-semibold text-[#0b63e5]" href="/audit-log">View all</a>} bodyClassName="p-0">
          <div className="divide-y divide-[#edf1f6]">
            <ReferenceListRow icon={TriangleAlert} title="High number of absences" subtitle="Review attendance exceptions" value={absent} tone="red" href="/attendance" />
            <ReferenceListRow icon={TriangleAlert} title="Payroll pending" subtitle="Review current payroll cycle" value={asNumber(pendingQueues.total)} tone="amber" href="/payroll" />
            <ReferenceListRow icon={ShieldCheck} title="2FA not enabled" subtitle="Improve account security" value={asNumber(systemMetrics.usersWithout2fa)} tone="amber" href="/settings/access-control" />
            <ReferenceListRow icon={Database} title="System backup" subtitle="Latest backup status" value={String(data.system.backup_status ?? "—")} tone="blue" />
          </div>
        </ReferencePanel>

        <ReferencePanel title="Compliance Alerts" action={<a className="text-[10px] font-semibold text-[#0b63e5]" href="/compliance/statutory">View all</a>} bodyClassName="p-0">
          <div className="divide-y divide-[#edf1f6]">
            <ReferenceListRow icon={TriangleAlert} title="Documents expired" value={asNumber(data.workforce.expired_documents)} tone="red" href="/compliance/statutory" />
            <ReferenceListRow icon={TriangleAlert} title="Policies pending acknowledgement" value={asNumber(data.workforce.pending_policy_acknowledgements)} tone="amber" href="/compliance/statutory" />
            <ReferenceListRow icon={CalendarDays} title="Statutory filing due" value={arrayAt(data.payroll, "statutoryFiling").length} tone="amber" href="/payroll/statutory-filing" />
            <ReferenceListRow icon={Activity} title="Annual appraisal cycle" value={data.workforce.appraisal_completion_pct} tone="blue" href="/performance" />
          </div>
        </ReferencePanel>

        <ReferencePanel title="Recent Activity" action={<a className="text-[10px] font-semibold text-[#0b63e5]" href="/audit-log">View all</a>} bodyClassName="p-0">
          <div className="max-h-[270px] divide-y divide-[#edf1f6] overflow-y-auto">
            {activities.length ? activities.slice(0, 8).map((row, index) => (
              <ReferenceListRow key={String(row.id ?? index)} icon={BellRing} title={String(row.user ?? row.user_name ?? row.actor ?? "System")} subtitle={String(row.action ?? row.description ?? "System activity")} value={String(row.timestamp ?? row.created_at ?? "—")} tone={String(row.status ?? "").toLowerCase().includes("error") ? "red" : "blue"} />
            )) : modules.slice(0, 8).map((row, index) => (
              <ReferenceListRow key={String(row.module ?? index)} icon={Activity} title={String(row.module ?? `Module ${index + 1}`)} subtitle={`${formatValue(row.recordCount)} records`} value={String(row.status ?? "—")} tone={String(row.status ?? "").toLowerCase() === "operational" ? "green" : "amber"} />
            ))}
          </div>
        </ReferencePanel>
      </div>
    </div>
  );
}
