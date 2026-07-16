import {
  BadgeCheck,
  BookOpen,
  CalendarDays,
  Clock3,
  FileText,
  FolderOpen,
  Headphones,
  Target,
  TrendingUp,
  TriangleAlert,
  UserCheck,
} from "lucide-react";

import {
  ReferenceHeader,
  ReferenceMetricGrid,
  ReferencePanel,
  ReferenceProgress,
  ReferenceQuickLink,
} from "../ReferenceDashboardUI";
import type { ReferenceDashboardData } from "../reference-dashboard-model";
import { asNumber, formatValue, stringAt } from "../reference-dashboard-model";
import { ReferenceAIBrief, ReferenceWorkInbox } from "./ReferenceOperationalPanels";

export function EmployeeReferenceLayout({ data, employeeName }: { data: ReferenceDashboardData; employeeName: string }) {
  const attendance = data.employee.attendance;
  const onboarding = data.employee.onboarding;
  const lms = data.employee.lms;
  const present = asNumber(attendance.presentDays ?? attendance.present);
  const absent = asNumber(attendance.absentDays ?? attendance.absent);
  const late = asNumber(attendance.lateDays ?? attendance.late);
  const attendancePct = asNumber(attendance.attendancePct ?? attendance.attendance_pct);
  const completion = asNumber(lms.completion_pct ?? lms.completionPct);
  const mcq = asNumber(lms.mcq_best_score ?? lms.mcqBestScore);
  const readiness = asNumber(lms.readiness_score ?? lms.readinessScore);
  const certification = String(lms.certification_status ?? lms.certificationStatus ?? "—");
  const onboardingPct = asNumber(onboarding.percentComplete ?? onboarding.percent_complete);
  const completedSteps = asNumber(onboarding.completedSteps ?? onboarding.completed_steps);
  const totalSteps = asNumber(onboarding.totalSteps ?? onboarding.total_steps);
  const stage = String(onboarding.stage ?? "Joining Completion");

  const leaveRows = data.employee.balances.slice(0, 4).map((row, index) => {
    const label = String(row.leaveType ?? row.leave_type ?? row.leave_name ?? row.name ?? `Leave ${index + 1}`);
    const remaining = asNumber(row.balance ?? row.remaining ?? row.available);
    const used = asNumber(row.used ?? row.used_days);
    const total = asNumber(row.total ?? row.entitled ?? row.allocated ?? row.allocated_days);
    return { label, remaining, used, total };
  });

  return (
    <div className="reference-dashboard-page">
      <ReferenceHeader title={`Welcome, ${employeeName}`} subtitle="Your personal dashboard" badge="Self Service" />

      <ReferencePanel title="My Attendance This Month" bodyClassName="p-3">
        <ReferenceMetricGrid columns={4} loading={data.loading} metrics={[
          { label: "Present", value: present, helper: "Days", icon: UserCheck, tone: "green" },
          { label: "Absent", value: absent, helper: "Day", icon: TriangleAlert, tone: absent && absent > 0 ? "red" : "green" },
          { label: "Late", value: late, helper: "Days", icon: Clock3, tone: late && late > 0 ? "amber" : "blue" },
          { label: "Attendance %", value: attendancePct, valueSuffix: "%", helper: "This Month", icon: Target, tone: "blue" },
        ]} />
      </ReferencePanel>

      <div className="grid gap-4 xl:grid-cols-[1.02fr_0.98fr]">
        <ReferencePanel title="My Training Status" bodyClassName="p-0">
          <div className="grid min-h-[118px] grid-cols-2 divide-x divide-[#edf1f6] sm:grid-cols-4">
            {[
              { label: "Completion", value: completion, suffix: "%", helper: stringAt(lms, "course_progress") ?? "Courses", icon: BookOpen, tone: "violet" as const },
              { label: "MCQ Best Score", value: mcq, suffix: "%", helper: "Best Score", icon: Target, tone: "green" as const },
              { label: "Readiness Score", value: readiness, suffix: "%", helper: "Above Average", icon: TrendingUp, tone: "amber" as const },
              { label: "Certification", value: certification, suffix: "", helper: stringAt(lms, "course_name") ?? "Certification", icon: BadgeCheck, tone: "blue" as const },
            ].map((item) => {
              const Icon = item.icon;
              return <div key={item.label} className="flex min-w-0 items-center gap-3 px-4 py-5"><span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${item.tone === "violet" ? "bg-[#f3efff] text-[#7c3aed]" : item.tone === "green" ? "bg-[#eaf8ef] text-[#16a34a]" : item.tone === "amber" ? "bg-[#fff4e8] text-[#f97316]" : "bg-[#edf4ff] text-[#0b63e5]"}`}><Icon className="h-5 w-5" /></span><div className="min-w-0"><p className="truncate text-[10px] font-semibold text-[#1d2b45]">{item.label}</p><p className="mt-1 text-[23px] font-extrabold leading-none text-[#0b1f44]">{formatValue(item.value, item.suffix)}</p><p className="mt-2 truncate text-[9px] text-[#71809a]">{item.helper}</p></div></div>;
            })}
          </div>
        </ReferencePanel>

        <ReferenceAIBrief title="Attendance & Leave AI Brief" actionHref="/attendance" actionLabel="Insights powered by AI" items={[
          { label: "Attendance", value: attendancePct === null ? null : `${attendancePct}%`, text: "Current month attendance based on your finalized attendance records.", icon: UserCheck, tone: attendancePct !== null && attendancePct >= 90 ? "green" : "blue" },
          { label: "Leave balance", value: leaveRows.reduce((sum, row) => sum + (row.remaining ?? 0), 0), text: "Total available leave across your visible leave types.", icon: CalendarDays, tone: "violet" },
          { label: "Late days", value: late, text: "Late arrivals recorded during the current month.", icon: Clock3, tone: late && late > 3 ? "amber" : "blue" },
        ]} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <ReferencePanel title="My Onboarding Status" bodyClassName="px-5 py-4">
          <div className="grid items-center gap-4 sm:grid-cols-[52px_1fr_90px]">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#f3efff] text-[#7c3aed]"><UserCheck className="h-5 w-5" /></span>
            <div><div className="flex items-center justify-between gap-3 text-[11px]"><span className="font-semibold text-[#1d2b45]">Stage: {stage}</span><span className="font-medium text-[#61708a]">Completed Steps: {formatValue(completedSteps)} / {formatValue(totalSteps)}</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-[#edf1f6]"><div className="h-full rounded-full bg-[#8b5cf6]" style={{ width: `${Math.min(100, Math.max(0, onboardingPct ?? 0))}%` }} /></div></div>
            <div className="text-right"><p className="text-[26px] font-extrabold leading-none text-[#0b1f44]">{formatValue(onboardingPct, "%")}</p><p className="mt-1 text-[9px] text-[#71809a]">Complete</p></div>
          </div>
        </ReferencePanel>
        <div aria-hidden="true" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <ReferencePanel title="My Leave Balance" action={<a href="/leaves" className="text-[10px] font-semibold text-[#0b63e5]">View Leave Policy</a>} bodyClassName="p-0">
          <div className="divide-y divide-[#edf1f6]">
            {leaveRows.length ? leaveRows.map((row) => {
              const used = row.used ?? (row.total !== null && row.remaining !== null ? Math.max(0, row.total - row.remaining) : null);
              const total = row.total ?? ((used ?? 0) + (row.remaining ?? 0));
              return <div key={row.label} className="grid grid-cols-[minmax(0,1fr)_90px_minmax(120px,1fr)_70px] items-center gap-3 px-5 py-3 text-[10px]"><span className="truncate font-medium text-[#1d2b45]">{row.label}</span><span className="font-bold text-[#16a34a]">{formatValue(row.remaining)} Days</span><ReferenceProgress label="" value={used} max={total || 1} tone="green" /><span className="text-right font-medium text-[#61708a]">{formatValue(used)} / {formatValue(total)}</span></div>;
            }) : <div className="px-5 py-10 text-center text-[10px] text-[#94a3b8]">Leave balance is unavailable</div>}
          </div>
        </ReferencePanel>
        <ReferenceWorkInbox maxItems={4} />
      </div>

      <ReferencePanel title="Quick Links" bodyClassName="p-3">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <ReferenceQuickLink icon={CalendarDays} title="Apply Leave" subtitle="Request time off" href="/leaves" tone="green" />
          <ReferenceQuickLink icon={FileText} title="View Payslip" subtitle="Check your salary details" href="/payroll/payslips" tone="blue" />
          <ReferenceQuickLink icon={Headphones} title="Raise Helpdesk" subtitle="Get support for issues" href="/helpdesk" tone="amber" />
          <ReferenceQuickLink icon={FolderOpen} title="View Documents" subtitle="Access your documents" href="/profile" tone="violet" />
        </div>
      </ReferencePanel>
    </div>
  );
}
