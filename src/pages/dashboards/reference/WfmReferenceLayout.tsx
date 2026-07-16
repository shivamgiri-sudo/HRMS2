import {
  Activity,
  CalendarClock,
  Clock3,
  Target,
  UserCheck,
  Users,
} from "lucide-react";

import {
  ReferenceHeader,
  ReferenceListRow,
  ReferenceMetricGrid,
  ReferencePanel,
} from "../ReferenceDashboardUI";
import { ReferenceAIBrief, ReferenceWorkInbox } from "./ReferenceOperationalPanels";
import type { ReferenceDashboardData } from "../reference-dashboard-model";
import {
  arrayAt,
  asNumber,
  formatValue,
  metricDetail,
  metricValue,
} from "../reference-dashboard-model";

export function WfmReferenceLayout({
  data,
  filters,
}: {
  data: ReferenceDashboardData;
  filters: React.ReactNode;
}) {
  const m = data.metrics;
  const active = metricDetail(m, "hc", "active") ?? metricValue(m, "hc");
  const required = metricDetail(m, "hc", "required");
  const available = metricDetail(m, "hc", "available") ?? active;
  const absent = metricDetail(m, "att", "absent");
  const late = metricDetail(m, "att", "late");
  const missingPunch = metricDetail(m, "att", "missedPunch");
  const attendanceRate = metricDetail(m, "att", "attendanceRate") ?? metricValue(m, "att");
  const gap = required !== null && available !== null ? Math.max(0, required - available) : null;
  const shrinkage = asNumber(data.biometric.shrinkage_pct);
  const overtimeHours = asNumber(data.biometric.overtime_hours ?? data.biometric.ot_hours);
  const interventionRows = arrayAt(data.opsPulse, "intervention_flags");

  const variance = {
    low: asNumber(data.biometric.variance_0_1 ?? data.biometric.variance_bucket_0_1),
    medium: asNumber(data.biometric.variance_1_4 ?? data.biometric.variance_bucket_1_4),
    high: asNumber(data.biometric.variance_4_plus ?? data.biometric.variance_bucket_4_plus),
  };

  return (
    <div className="reference-dashboard-page">
      <ReferenceHeader
        title="WFM Dashboard"
        subtitle="Workforce management — headcount, roster and attendance"
        badge="WFM View"
        right={filters}
      />

      <ReferenceMetricGrid
        columns={4}
        loading={data.loading}
        metrics={[
          { label: "Required HC", value: required, helper: "vs planned requirement", icon: Users, tone: "blue", trend: m.hc?.variancePct },
          { label: "Available HC", value: available, helper: gap === null ? "Clocked-in workforce" : `${formatValue(gap)} net gap`, icon: UserCheck, tone: gap && gap > 0 ? "amber" : "green" },
          { label: "Roster Adherence", value: attendanceRate, valueSuffix: "%", helper: "vs target adherence", icon: Target, tone: attendanceRate !== null && attendanceRate >= 90 ? "violet" : "amber", trend: m.att?.variancePct },
          { label: "Missing Punch", value: missingPunch, helper: "Attendance exceptions", icon: Clock3, tone: missingPunch && missingPunch > 0 ? "red" : "green" },
        ]}
      />

      <div className="grid gap-4 xl:grid-cols-[1.04fr_0.96fr]">
        <ReferencePanel
          title="Today's Operations Alerts"
          action={<span className="rounded-full bg-[#ef4444] px-2 py-0.5 text-[9px] font-bold text-white">{formatValue(interventionRows.length || 4)}</span>}
          bodyClassName="p-0"
        >
          <div className="divide-y divide-[#edf1f6]">
            {interventionRows.length ? interventionRows.slice(0, 4).map((row, index) => (
              <ReferenceListRow
                key={String(row.id ?? row.title ?? index)}
                icon={index % 3 === 0 ? Users : index % 3 === 1 ? CalendarClock : Clock3}
                title={String(row.title ?? row.label ?? "Operations alert")}
                subtitle={String(row.detail ?? row.description ?? row.message ?? "Requires review")}
                value={String(row.severity ?? row.priority ?? "View")}
                tone={String(row.severity ?? row.priority).toLowerCase().includes("high") ? "red" : "amber"}
                href={String(row.action_url ?? row.href ?? "/work-inbox")}
              />
            )) : (
              <>
                <ReferenceListRow icon={Users} title="Staffing gap in current scope" subtitle="Available headcount versus planned requirement" value={gap} tone={gap && gap > 0 ? "red" : "green"} href="/wfm/auto-roster" />
                <ReferenceListRow icon={Target} title="Low roster adherence" subtitle="Attendance against roster target" value={attendanceRate === null ? null : `${attendanceRate}%`} tone={attendanceRate !== null && attendanceRate < 95 ? "amber" : "green"} href="/attendance" />
                <ReferenceListRow icon={Clock3} title="High missing punches" subtitle="Employees with incomplete punches" value={missingPunch} tone={missingPunch && missingPunch > 0 ? "red" : "green"} href="/wfm/mismatch-queue" />
                <ReferenceListRow icon={Activity} title="Overtime spike" subtitle="Overtime against configured target" value={overtimeHours} tone={overtimeHours && overtimeHours > 0 ? "amber" : "green"} href="/reports" />
              </>
            )}
          </div>
        </ReferencePanel>

        <ReferenceAIBrief
          title="Workforce AI Analysis"
          actionHref="/reports"
          items={[
            { label: "Headcount Gap", value: gap, text: "Required versus available workforce in the selected branch and process.", icon: Users, tone: gap && gap > 0 ? "red" : "green" },
            { label: "Roster Adherence", value: attendanceRate === null ? null : `${attendanceRate}%`, text: "Overall roster adherence compared with the configured target.", icon: Target, tone: attendanceRate !== null && attendanceRate < 95 ? "amber" : "violet" },
            { label: "Missing Punch Issues", value: missingPunch, text: "Employees requiring attendance correction or punch validation.", icon: Clock3, tone: missingPunch && missingPunch > 0 ? "red" : "green" },
            { label: "Shrinkage", value: shrinkage === null ? null : `${shrinkage}%`, text: "Current shrinkage calculated from live workforce and attendance data.", icon: Activity, tone: "blue" },
          ]}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.04fr_0.96fr]">
        <ReferencePanel title="Attendance Variance Buckets (vs Scheduled Hours)">
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { label: "0 – 1 hr", value: variance.low, tone: "green" as const, helper: "Minor variance" },
              { label: "1 – 4 hr", value: variance.medium, tone: "amber" as const, helper: "Moderate variance" },
              { label: "4+ hr", value: variance.high, tone: "red" as const, helper: "Critical variance" },
            ].map((item) => (
              <div key={item.label} className={`rounded-lg border p-4 ${item.tone === "green" ? "border-[#d7f0df] bg-[#f2fbf5]" : item.tone === "amber" ? "border-[#fee3c5] bg-[#fff9f2]" : "border-[#ffdadd] bg-[#fff7f7]"}`}>
                <p className={`text-[11px] font-bold ${item.tone === "green" ? "text-[#16a34a]" : item.tone === "amber" ? "text-[#f97316]" : "text-[#ef4444]"}`}>{item.label}</p>
                <p className="mt-2 text-[25px] font-extrabold leading-none text-[#0b1f44]">{formatValue(item.value)}</p>
                <p className="mt-2 text-[9px] text-[#71809a]">Employees · {item.helper}</p>
              </div>
            ))}
          </div>
        </ReferencePanel>
        <ReferenceWorkInbox maxItems={4} />
      </div>
    </div>
  );
}
