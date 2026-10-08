import {
  BadgeCheck, BookOpen, Briefcase, CalendarDays, Clock, Clock3, FileText, FolderOpen, Headphones, Target, TrendingUp, TriangleAlert, UserCheck,
} from "lucide-react";
import { ReferenceMetricGrid, ReferencePanel, ReferenceProgress, ReferenceQuickLink } from "../../ReferenceDashboardUI";
import type { ReferenceDashboardData } from "../../reference-dashboard-model";
import { METRIC_NO_DATA_REASON, asNumber, formatValue, stringAt } from "../../reference-dashboard-model";
import { ReferenceAIBrief, ReferenceWorkInbox } from "../ReferenceOperationalPanels";
import { LeaveApprovalPanel } from "../ReferenceSharedPanels";
import type { InsightIndex } from "./insightIndex";

/** Leave types that are not a pool the person can plan with (see employeeCalc.buildLeaveBalances). */
const NOT_POOLED = new Set(["LWP", "MTRL", "PTRL", "PL", "PML"]);

function leaveRowsFrom(balances: ReferenceDashboardData["employee"]["balances"]) {
  return balances
    .map((row, index) => {
      const code = String(row.leave_code ?? row.code ?? "").toUpperCase();
      const label = String(row.leaveType ?? row.leave_type ?? row.leave_name ?? row.name ?? `Leave ${index + 1}`);
      const remaining = asNumber(row.balance ?? row.remaining ?? row.available ?? row.available_days);
      const used = asNumber(row.used ?? row.used_days);
      // Entitlement = allocated + adjusted. The API's available_days already includes adjustments, so
      // showing "used / allocated" alone made the row disagree with its own "left" figure.
      const allocated = asNumber(row.total ?? row.entitled ?? row.allocated ?? row.allocated_days);
      const adjusted = asNumber(row.adjusted_days) ?? 0;
      const total = allocated === null ? null : allocated + adjusted;
      return { code, label, remaining, used, total };
    })
    // Types with nothing granted and nothing used are noise (the API returns every active type).
    .filter((r) => (r.total ?? 0) > 0 || (r.used ?? 0) > 0);
}

/** Every pre-redesign datapoint, kept reachable: summary-feed attendance, training, onboarding, leave, inbox, freshness, links. */
export function LegacyDetails({ data, ix }: { data: ReferenceDashboardData; ix: InsightIndex }) {
  const drill = data.drilldownFor ?? (() => ({}));
  const { attendance, onboarding, lms } = data.employee;
  // One truth: when the provider has the completed-day figures, show those; the summary feed
  // (/wfm/my-attendance) still counts today's unreconciled row.
  const pick = (key: string, fallback: unknown) => ix.kpi(key)?.value ?? asNumber(fallback);
  const present = pick("att_present", attendance.presentDays ?? attendance.present);
  const absent = pick("att_absent", attendance.absentDays ?? attendance.absent);
  const late = pick("att_late", attendance.lateDays ?? attendance.late);
  const attendancePct = pick("att_pct", attendance.attendancePct ?? attendance.attendance_pct);
  const halfDay = pick("att_half", attendance.halfDays ?? attendance.half_day ?? attendance.halfDay);
  const attendanceMissing = (data.employee.sourceErrors ?? []).some((m) => m.startsWith("Attendance:")) && !ix.kpi("att_pct");
  const attendanceReason = attendanceMissing ? METRIC_NO_DATA_REASON : null;
  const completion = asNumber(lms.completion_pct ?? lms.completionPct ?? lms.course_completion_pct);
  const mcq = asNumber(lms.mcq_best_score ?? lms.mcqBestScore);
  const readiness = asNumber(lms.readiness_score ?? lms.readinessScore);
  const certification = String(lms.certification_status ?? lms.certificationStatus ?? "—");
  const lmsSyncedAt = stringAt(lms, "synced_at") ?? stringAt(lms, "last_synced_at") ?? stringAt(lms, "updated_at");
  const syncDate = lmsSyncedAt ? new Date(lmsSyncedAt) : null;
  const syncValid = syncDate !== null && !Number.isNaN(syncDate.getTime());
  const ageH = syncValid ? Math.floor((Date.now() - syncDate.getTime()) / 3_600_000) : 0;
  const lmsStale = syncValid && ageH >= 24;
  const lmsSyncLabel = !syncValid ? null : ageH < 1 ? "Synced just now" : ageH < 24 ? `Synced ${ageH}h ago` : `Synced ${Math.floor(ageH / 24)}d ago`;
  const onboardingPct = asNumber(onboarding.percentComplete ?? onboarding.percent_complete);
  const completedSteps = asNumber(onboarding.completedSteps ?? onboarding.completed_steps);
  const totalSteps = asNumber(onboarding.totalSteps ?? onboarding.total_steps);
  const stage = String(onboarding.stage ?? "—");
  const leaveRows = leaveRowsFrom(data.employee.balances);
  const pooled = leaveRows.filter((r) => !NOT_POOLED.has(r.code));
  const sourceFreshness = Object.entries(data.employee.sourceFreshness ?? {});
  const freshnessLabel = (v: string | null) => {
    if (!v) return "Timestamp unavailable";
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? "Timestamp unavailable" : d.toLocaleString("en-IN");
  };

  return (
    <div className="space-y-4">
      <ReferencePanel title="My Attendance This Month" bodyClassName="p-2 sm:p-3">
        <ReferenceMetricGrid columns={5} loading={data.loading} metrics={[
          { label: "Present", value: present, helper: "Full days", icon: UserCheck, tone: "green", unavailableReason: attendanceReason, ...drill("att") },
          { label: "Half Day", value: halfDay, helper: "Counts as 0.5", icon: Clock3, tone: halfDay && halfDay > 0 ? "amber" : "blue", unavailableReason: attendanceReason, ...drill("att") },
          { label: "Absent", value: absent, helper: "Day", icon: TriangleAlert, tone: absent && absent > 0 ? "red" : "green", unavailableReason: attendanceReason, ...drill("att") },
          { label: "Late", value: late, helper: "Days", icon: Clock3, tone: late && late > 0 ? "amber" : "blue", unavailableReason: attendanceReason, ...drill("att") },
          { label: "Attendance %", value: attendancePct, valueSuffix: "%", helper: "Full + half days", icon: Target, tone: "blue", unavailableReason: attendanceReason, ...drill("att") },
        ]} />
      </ReferencePanel>

      <div className="grid gap-3 sm:gap-4 grid-cols-1 lg:grid-cols-2">
        <ReferencePanel
          title="My Training Status"
          bodyClassName="p-0"
          action={lmsSyncLabel ? (
            <span className={`flex items-center gap-1 text-xs font-medium ${lmsStale ? "text-[#f97316]" : "text-[#61708a]"}`}>
              <Clock className="h-3 w-3" aria-hidden="true" />{lmsSyncLabel}{lmsStale ? " — data may be outdated" : ""}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-[#94a3b8]"><Clock className="h-3 w-3" aria-hidden="true" />Sync time unknown</span>
          )}
        >
          <div className="grid min-h-[118px] grid-cols-2 divide-x divide-[#edf1f6] sm:grid-cols-4">
            {[
              { label: "Completion", value: completion, suffix: "%", helper: stringAt(lms, "course_progress") ?? "Courses", icon: BookOpen, tone: "bg-[#f3efff] text-[#7c3aed]" },
              { label: "MCQ Best Score", value: mcq, suffix: "%", helper: "Best Score", icon: Target, tone: "bg-[#eaf8ef] text-[#16a34a]" },
              { label: "Readiness Score", value: readiness, suffix: "%", helper: "LMS readiness", icon: TrendingUp, tone: "bg-[#fff4e8] text-[#f97316]" },
              { label: "Certification", value: certification, suffix: "", helper: stringAt(lms, "course_name") ?? "Certification", icon: BadgeCheck, tone: "bg-[#edf4ff] text-[#0b63e5]" },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.label} className="flex min-w-0 items-center gap-3 px-4 py-5">
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${item.tone}`}><Icon className="h-5 w-5" /></span>
                  <div className="min-w-0"><p className="truncate text-xs font-semibold text-[#1d2b45]">{item.label}</p><p className="mt-1 text-[23px] font-extrabold leading-none text-[#0b1f44]">{formatValue(item.value, item.suffix)}</p><p className="mt-2 truncate text-xs text-[#71809a]">{item.helper}</p></div>
                </div>
              );
            })}
          </div>
        </ReferencePanel>

        <ReferenceAIBrief title="Automated Attendance & Leave Summary" actionHref="/attendance" actionLabel="View attendance details" items={[
          { label: "Attendance", value: attendancePct === null ? null : `${attendancePct}%`, text: "Current month attendance based on your completed, finalized attendance records.", icon: UserCheck, tone: attendancePct !== null && attendancePct >= 90 ? "green" : "blue" },
          { label: "Leave balance", value: pooled.length ? pooled.reduce((sum, r) => sum + (r.remaining ?? 0), 0) : null, text: "Total available across regular leave types (excludes unpaid, maternity and paternity).", icon: CalendarDays, tone: "violet" },
          { label: "Late days", value: late, text: "Late arrivals recorded during the current month.", icon: Clock3, tone: late && late > 3 ? "amber" : "blue" },
        ]} />
      </div>

      <div className="grid gap-3 sm:gap-4 grid-cols-1 lg:grid-cols-2">
        <ReferencePanel title="My Onboarding Status" bodyClassName="px-5 py-4">
          <div className="grid items-center gap-4 sm:grid-cols-[52px_1fr_90px]">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#f3efff] text-[#7c3aed]"><UserCheck className="h-5 w-5" /></span>
            <div>
              <div className="flex items-center justify-between gap-3 text-xs"><span className="font-semibold text-[#1d2b45]">Stage: {stage}</span><span className="font-medium text-[#61708a]">Completed Steps: {formatValue(completedSteps)} / {formatValue(totalSteps)}</span></div>
              {onboardingPct === null ? <p className="mt-3 text-xs text-[#94a3b8]">Onboarding progress unavailable</p> : <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#edf1f6]"><div className="h-full rounded-full bg-[#8b5cf6]" style={{ width: `${Math.min(100, Math.max(0, onboardingPct))}%` }} /></div>}
            </div>
            <div className="text-right"><p className="text-[26px] font-extrabold leading-none text-[#0b1f44]">{formatValue(onboardingPct, "%")}</p><p className="mt-1 text-xs text-[#71809a]">Complete</p></div>
          </div>
        </ReferencePanel>
        <ReferenceWorkInbox maxItems={4} />
      </div>

      <ReferencePanel title="My Leave Balance" action={<a href="/leaves" className="text-xs font-semibold text-[#0b63e5]">View Leave Policy</a>} bodyClassName="p-0">
        <div className="divide-y divide-[#edf1f6]">
          {leaveRows.length ? leaveRows.map((row) => {
            const used = row.used ?? (row.total !== null && row.remaining !== null ? Math.max(0, row.total - row.remaining) : null);
            const total = row.total ?? ((used ?? 0) + (row.remaining ?? 0));
            return (
              <div key={row.label} className="grid grid-cols-2 sm:grid-cols-[minmax(0,1fr)_90px_minmax(120px,1fr)_70px] items-center gap-2 sm:gap-3 px-3 sm:px-5 py-3 text-xs">
                <span className="truncate font-medium text-[#1d2b45]">{row.label}</span>
                <span className="font-bold text-[#16a34a] text-right sm:text-left">{formatValue(row.remaining)} Days</span>
                <div className="hidden sm:block"><ReferenceProgress label="" value={used} max={total || 1} tone="green" /></div>
                <span className="hidden sm:block text-right font-medium text-[#61708a]">{formatValue(used)} / {formatValue(total)}</span>
              </div>
            );
          }) : <div className="px-5 py-10 text-center text-xs text-[#94a3b8]">Leave balance is unavailable</div>}
        </div>
      </ReferencePanel>

      <ReferencePanel title="Source Freshness" bodyClassName="p-0">
        <div className="grid divide-y divide-[#edf1f6] grid-cols-2 sm:grid-cols-3 sm:divide-x sm:divide-y-0 lg:grid-cols-5">
          {sourceFreshness.map(([source, asOf]) => (
            <div key={source} className="px-4 py-3"><p className="text-xs font-semibold capitalize text-[#1d2b45]">{source}</p><p className="mt-1 text-xs text-[#71809a]">{freshnessLabel(asOf)}</p></div>
          ))}
        </div>
      </ReferencePanel>

      <LeaveApprovalPanel data={data} />

      <ReferencePanel title="Quick Links" bodyClassName="p-3">
        <div className="grid gap-2 sm:gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
          <ReferenceQuickLink icon={CalendarDays} title="Apply Leave" subtitle="Request time off" href="/leaves" tone="green" />
          <ReferenceQuickLink icon={FileText} title="View Payslip" subtitle="Check your salary details" href="/payroll/payslips" tone="blue" />
          <ReferenceQuickLink icon={Headphones} title="Raise Helpdesk" subtitle="Get support for issues" href="/helpdesk" tone="amber" />
          <ReferenceQuickLink icon={FolderOpen} title="View Documents" subtitle="Access your documents" href="/profile" tone="violet" />
          <ReferenceQuickLink icon={Briefcase} title="Internal Jobs" subtitle="Career opportunities" href="/people/ijp" tone="green" />
          <ReferenceQuickLink icon={BadgeCheck} title="My Engagement" subtitle="Points, badges & games" href="/engagement" tone="violet" />
        </div>
      </ReferencePanel>
    </div>
  );
}
