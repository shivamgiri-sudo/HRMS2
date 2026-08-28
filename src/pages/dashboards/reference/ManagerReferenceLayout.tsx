import type { ReactNode } from "react";
import {
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileText,
  Goal,
  ListChecks,
  Megaphone,
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
  ReferenceQuickLink,
} from "../ReferenceDashboardUI";
import type { ReferenceDashboardData } from "../reference-dashboard-model";
import {
  arrayAt,
  asNumber,
  countEmployeesOnLeaveOnDate,
  formatValue,
  metricDetail,
  metricUnavailableReason,
  metricValue,
  numberAt,
  statusCount,
} from "../reference-dashboard-model";
import { useReferenceDashboardShell } from "./ReferenceDashboardShell";
import { TodayCelebrationsWidget } from "@/components/dashboard/TodayCelebrationsWidget";
import {
  AttendanceBreakdownPanel,
  TrainingProgressPanel,
  LeaveApprovalPanel,
} from "./ReferenceSharedPanels";

export function ManagerReferenceLayout({ data, managerName, filters }: { data: ReferenceDashboardData; managerName: string; filters?: ReactNode }) {
  const { productHeaderControls } = useReferenceDashboardShell();
  const m = data.metrics;
  const drill = data.drilldownFor ?? (() => ({}));
  const team = metricDetail(m, "hc", "active") ?? metricValue(m, "hc");
  const present = metricDetail(m, "att", "present");
  const absent = metricDetail(m, "att", "absent");
  const late = metricDetail(m, "att", "late");
  const attendance = metricDetail(m, "att", "attendanceRate") ?? metricValue(m, "att");
  const newJoiners = numberAt(data.workforce, "summary", "new_joiners_30d") ?? metricDetail(m, "onb", "pending") ?? metricValue(m, "onb");
  const openActions = asNumber(data.summary.workItems?.pending_count);
  const overdue = asNumber(data.summary.workItems?.overdue_count);
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  // /api/leave/requests can fail (it was slow enough in production to 500 — see the
  // query fix in leave.secure.routes.ts). managerLeaves defaults to [] on any query
  // failure the same as it would on a genuinely empty result, so leaveDataFailed is the
  // only way this panel can tell "0 requests" from "could not load" — without it a
  // manager reading a failed fetch as "nothing pending" is the exact failure this page
  // must not produce.
  const leaveDataFailed = Boolean(data.managerLeavesError);
  const approvedLeaves = leaveDataFailed ? null : statusCount(data.managerLeaves, "approved");
  const employeesOnLeaveToday = countEmployeesOnLeaveOnDate(data.managerLeaves, today);
  /**
   * Prefer the LEAVE_APPROVALS metric over counting the request list.
   *
   * Two reasons. The list is /api/leave/requests?limit=100 ordered by applied_at DESC,
   * so counting statuses in it counts the first hundred rows, not the queue. And it
   * includes the db_bill import's mis-statused rows: 547 of the 586 requests this
   * database calls pending were already 'Not Approved' in the legacy system, so a
   * manager saw an approval queue in which nothing could be approved. The metric applies
   * the legacy_leave_id split (see getLeaveApprovalMetrics) and is branch-scoped; the
   * list count stays as the fallback for when the metric itself is unavailable.
   */
  const pendingLeaves = metricDetail(m, "leaveApprovals", "pending")
    ?? (leaveDataFailed ? null : statusCount(data.managerLeaves, "pending"));
  const legacyLeaveBacklog = metricDetail(m, "leaveApprovals", "legacyBacklog");
  const rejectedLeaves = leaveDataFailed ? null : statusCount(data.managerLeaves, "rejected");
  const positiveInsights = arrayAt(data.managerInsights, "good", "items");
  const overdueInsights = arrayAt(data.managerInsights, "bad", "items");
  const accountabilityRows = data.managerAccountability;
  const interventionRows = arrayAt(data.opsPulse, "intervention_flags");
  const teamRows = arrayAt(data.workforce, "team_members").length ? arrayAt(data.workforce, "team_members") : arrayAt(data.workforce, "team");
  const performanceTrend = arrayAt(data.orgKpi, "trend").slice(-10).flatMap((row) => {
    const value = asNumber(row.performance_score ?? row.avg_score ?? row.score ?? row.value);
    return value === null ? [] : [{
      label: String(row.period ?? row.label ?? ""),
      value,
    }];
  });
  const orgScore = asNumber(data.orgKpi.org_average_score ?? data.orgKpi.score);
  const processes = arrayAt(data.orgKpi, "processes");
  // Derive productivity donut from KPI process scores: above average = achieved, within 10% below = in progress, further below = at risk
  const threshold = orgScore ?? 0;
  const achievedCount = processes.filter((p) => asNumber(p.score) !== null && (asNumber(p.score) as number) >= threshold).length;
  const inProgressCount = processes.filter((p) => { const s = asNumber(p.score); return s !== null && s >= threshold - 10 && s < threshold; }).length;
  const atRiskCount = processes.filter((p) => { const s = asNumber(p.score); return s !== null && s < threshold - 10; }).length;
  const productivity = orgScore;
  const adherence = attendance;

  return (
    <div className="reference-dashboard-page">
      <ReferenceHeader title="Manager Dashboard 👋" subtitle={`Overview of ${managerName}'s team and key management insights.`} right={filters ?? productHeaderControls} />
      <TodayCelebrationsWidget />

      <ReferenceMetricGrid
        columns={6}
        loading={data.loading}
        metrics={[
          // unavailableReason on every metric-backed tile. This layout never passed it, so a
          // manager whose reporting hierarchy maps nobody — 4 of the 10 team-scoped accounts
          // live on 2026-08-28 — read a confident "Team Members 0 / Present 0 / Absent 0"
          // instead of "No data recorded yet". An unmapped team and an empty team looked
          // identical, and only one of them is a person's actual situation.
          { label: "Team Members", value: team, helper: "Total", icon: Users, tone: "blue",
            unavailableReason: metricUnavailableReason(m, "hc"), ...drill("hc"), },
          { label: "Present Today", value: present, helper: attendance === null ? "Live" : `${attendance}%`, icon: UserCheck, tone: "green",
            unavailableReason: metricUnavailableReason(m, "att") },
          { label: "On Leave", value: employeesOnLeaveToday, helper: team ? `${Math.round((employeesOnLeaveToday / Math.max(team, 1)) * 1000) / 10}%` : "Today", icon: CalendarDays, tone: "amber" },
          { label: "Absent", value: absent, helper: team && absent !== null ? `${Math.round((absent / Math.max(team, 1)) * 1000) / 10}%` : "Today", icon: UserMinus, tone: "red",
            unavailableReason: metricUnavailableReason(m, "att") },
          { label: "New Joiners (This Month)", value: newJoiners, helper: "Last 30 days", icon: UserPlus, tone: "violet",
            unavailableReason: metricUnavailableReason(m, "onb"), ...drill("onb") },
          { label: "Open Positions", value: asNumber(data.ats.open_positions ?? data.ats.openPositions), helper: "View jobs", icon: BriefcaseBusiness, tone: "blue", href: "/ats/dashboard" },
        ]}
      />

      <div className="grid gap-4 xl:grid-cols-[0.92fr_0.92fr_1.16fr]">
        <ReferencePanel title="Team Attendance" action={<a className="text-xs font-semibold text-[#0b63e5]" href="/attendance">View Details</a>}>
          <ReferenceDonut compact centerValue={attendance === null ? null : `${attendance}%`} centerLabel="Present" data={[
            { name: "Present", value: present ?? 0 },
            { name: "On Leave", value: employeesOnLeaveToday ?? 0 },
            { name: "Absent", value: absent ?? 0 },
            { name: "Work From Home", value: asNumber(data.workforce.working_remotely) ?? 0 },
          ]} />
          <p className="mt-3 text-center text-xs text-[#71809a]">Based on {formatValue(team)} team members</p>
        </ReferencePanel>

        <ReferencePanel title="Leave Requests Summary" action={<a className="text-xs font-semibold text-[#0b63e5]" href="/leaves">View All</a>} bodyClassName="p-0">
          <div className="divide-y divide-[#edf1f6]">
            <ReferenceListRow icon={Clock3} title="Pending Approval" value={pendingLeaves} tone="amber" href="/leaves" />
            <ReferenceListRow icon={CheckCircle2} title="Approved" value={approvedLeaves} tone="green" href="/leaves" />
            <ReferenceListRow icon={TriangleAlert} title="Rejected" value={rejectedLeaves} tone="red" href="/leaves" />
            <div className="flex items-center justify-between px-4 py-3 text-xs"><span className="font-semibold text-[#61708a]">Total Requests</span><span className="font-bold text-[#0b1f44]">{formatValue(leaveDataFailed ? null : data.managerLeaves.length)}</span></div>
            {leaveDataFailed && (
              <div className="px-4 py-2 text-[11px] text-amber-700 bg-amber-50">Leave requests could not be loaded — these counts are unavailable, not zero.</div>
            )}
          </div>
        </ReferencePanel>

        <ReferencePanel title="Team Member Status" action={<a className="text-xs font-semibold text-[#0b63e5]" href="/my-team">View All</a>} bodyClassName="p-0">
          <div className="max-h-[240px] divide-y divide-[#edf1f6] overflow-y-auto">
            {teamRows.length ? teamRows.slice(0, 8).map((row, index) => (
              <ReferenceListRow key={String(row.id ?? index)} icon={Users} title={String(row.employee_name ?? row.full_name ?? row.name ?? `Team Member ${index + 1}`)} subtitle={String(row.designation_name ?? row.designation ?? row.role ?? "Employee")} value={String(row.status ?? row.attendance_status ?? "—")} tone={String(row.status ?? row.attendance_status).toLowerCase().includes("present") ? "green" : String(row.status ?? row.attendance_status).toLowerCase().includes("leave") ? "amber" : "red"} />
            )) : <div className="px-4 py-8 text-center">
              <p className="text-xs text-[#94a3b8] mb-2">Team roster data not loaded</p>
              <a href="/wfm/roster-view" className="text-xs font-semibold text-[#0b63e5] hover:underline">View Full Roster →</a>
            </div>}
          </div>
        </ReferencePanel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.92fr_0.92fr_1.16fr]">
        <ReferencePanel title="Team Performance Trend" action={<span className="text-xs text-[#61708a]">This Month</span>}><ReferenceLineChart data={performanceTrend} height={180} /></ReferencePanel>

        <ReferencePanel title="My Tasks" action={<a className="text-xs font-semibold text-[#0b63e5]" href="/work-inbox">View All</a>}>
          <div className="divide-y divide-[#edf1f6]">
            {interventionRows.length ? interventionRows.slice(0, 5).map((row, index) => (
              <ReferenceListRow key={String(row.id ?? index)} icon={ListChecks} title={String(row.title ?? row.label ?? "Management task")} subtitle={String(row.detail ?? row.description ?? "Requires action")} value={String(row.priority ?? row.severity ?? "Open")} tone={String(row.priority ?? row.severity).toLowerCase().includes("high") ? "red" : "amber"} href={String(row.action_url ?? row.href ?? "/work-inbox")} />
            )) : <><ReferenceListRow icon={ListChecks} title="Pending actions" subtitle="Approvals and team follow-ups" value={openActions} tone={overdue && overdue > 0 ? "red" : "blue"} href="/work-inbox" /><ReferenceListRow icon={Clock3} title="Late arrival reviews" subtitle="Attendance follow-up" value={late} tone="amber" href="/attendance" /></>}
          </div>
        </ReferencePanel>

        <ReferencePanel title="Quick Links">
          <div className="grid grid-cols-3 gap-3">
            <ReferenceQuickLink icon={Users} title="Team Directory" href="/my-team" tone="blue" />
            <ReferenceQuickLink icon={CalendarDays} title="Attendance Report" href="/attendance" tone="green" />
            <ReferenceQuickLink icon={CalendarDays} title="Leave Calendar" href="/leaves" tone="amber" />
            <ReferenceQuickLink icon={FileText} title="Performance Report" href="/performance" tone="violet" />
            <ReferenceQuickLink icon={Clock3} title="Team Timesheets" href="/work-inbox" tone="blue" />
            <ReferenceQuickLink icon={Megaphone} title="Announcements" href="/communication/dispatch" tone="red" />
          </div>
        </ReferencePanel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.92fr_0.92fr_1.16fr]">
        <ReferencePanel title="Pending Approvals" bodyClassName="p-0">
          <div className="divide-y divide-[#edf1f6]">
            <ReferenceListRow icon={CalendarDays} title="Leave Requests" subtitle={legacyLeaveBacklog ? `${legacyLeaveBacklog.toLocaleString()} legacy rows excluded` : undefined} value={pendingLeaves} tone="amber" href="/leaves" />
            <ReferenceListRow icon={Clock3} title="Timesheets" value={openActions} tone="red" href="/work-inbox" />
            <ReferenceListRow icon={FileText} title="Expense Claims" value={asNumber(data.workforce.pending_expense_claims)} tone="green" href="/expenses/approvals" />
          </div>
        </ReferencePanel>

        <ReferencePanel title="Productivity Snapshot" action={<span className="text-xs text-[#61708a]">This Month</span>}>
          <ReferenceDonut compact centerValue={productivity === null ? null : `${productivity}/100`} centerLabel="Avg KPI Score" data={[
            { name: "Goals Achieved", value: achievedCount || (productivity ?? 0) },
            { name: "In Progress", value: inProgressCount },
            { name: "At Risk", value: atRiskCount },
          ]} />
        </ReferencePanel>

        <ReferencePanel title="Shift Adherence" action={<span className="text-xs text-[#61708a]">This Month</span>}>
          <ReferenceDonut compact centerValue={adherence === null ? null : `${adherence}%`} centerLabel="Adherence" data={[
            { name: "On-time", value: adherence ?? 0 },
            { name: "Late", value: asNumber(data.biometric.late_pct) ?? 0 },
            { name: "Early Leave", value: asNumber(data.biometric.early_leave_pct) ?? 0 },
          ]} />
          <p className="mt-3 text-right text-xs text-[#71809a]">Avg. Late: {formatValue(data.biometric.avg_late_minutes)} mins</p>
        </ReferencePanel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ReferencePanel title="Coaching Follow-ups" action={<a className="text-xs font-semibold text-[#0b63e5]" href="/performance">View All</a>} bodyClassName="p-0">
          <div className="divide-y divide-[#edf1f6]">
            {arrayAt(data.workforce, "coaching_followups").length ? arrayAt(data.workforce, "coaching_followups").slice(0, 5).map((row, index) => (
              <ReferenceListRow key={String(row.id ?? index)} icon={Goal} title={String(row.employee_name ?? row.name ?? "Employee")} subtitle={String(row.topic ?? row.description ?? "Coaching discussion")} value={String(row.due_date ?? row.date ?? "Open")} tone="blue" />
            )) : <div className="px-4 py-10 text-center text-xs text-[#94a3b8]">No coaching follow-ups available</div>}
          </div>
        </ReferencePanel>

        <ReferencePanel title="Escalation Alerts" action={<a className="text-xs font-semibold text-[#0b63e5]" href="/work-inbox">View All</a>} bodyClassName="p-0">
          <div className="divide-y divide-[#edf1f6]">
            <ReferenceListRow icon={TriangleAlert} title="Employees with attendance warnings" value={late} tone="red" href="/attendance" />
            <ReferenceListRow icon={TriangleAlert} title="Projects with deadline risk" value={asNumber(data.workforce.projects_at_risk)} tone="red" href="/work-inbox" />
            <ReferenceListRow icon={TriangleAlert} title="Overdue tasks" value={overdue} tone="red" href="/work-inbox" />
          </div>
        </ReferencePanel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ReferencePanel title="Work Queue Insights" bodyClassName="p-0">
          <div className="divide-y divide-[#edf1f6]">
            {positiveInsights.slice(0, 3).map((row, index) => (
              <ReferenceListRow key={`good-${index}`} icon={CheckCircle2} title={String(row.item_type ?? "On-track work")} subtitle={String(row.priority ?? "Normal priority")} value={asNumber(row.count)} tone="green" href="/work-inbox" />
            ))}
            {overdueInsights.slice(0, 3).map((row, index) => (
              <ReferenceListRow key={`bad-${index}`} icon={TriangleAlert} title={String(row.item_type ?? "Overdue work")} subtitle={`${formatValue(asNumber(row.overdue))} overdue`} value={asNumber(row.count)} tone="red" href="/work-inbox" />
            ))}
            {!positiveInsights.length && !overdueInsights.length ? <div className="px-4 py-10 text-center text-xs text-[#94a3b8]">No work queue insights available</div> : null}
          </div>
        </ReferencePanel>

        <ReferencePanel title="Owner Accountability" bodyClassName="p-0">
          <div className="divide-y divide-[#edf1f6]">
            {accountabilityRows.slice(0, 5).map((row, index) => {
              const overdueCount = asNumber(row.overdue);
              return <ReferenceListRow key={String(row.role ?? index)} icon={Users} title={String(row.role ?? "Assigned role")} subtitle={`${formatValue(asNumber(row.completed))} completed of ${formatValue(asNumber(row.total))}`} value={overdueCount} tone={overdueCount !== null && overdueCount > 0 ? "red" : "green"} href="/work-inbox" />;
            })}
            {!accountabilityRows.length ? <div className="px-4 py-10 text-center text-xs text-[#94a3b8]">No accountable work items available</div> : null}
          </div>
        </ReferencePanel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <AttendanceBreakdownPanel data={data} />
        <TrainingProgressPanel data={data} />
        <LeaveApprovalPanel data={data} />
      </div>
    </div>
  );
}
