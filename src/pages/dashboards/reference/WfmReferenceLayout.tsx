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
} from "../reference-dashboard-model";

export function WfmReferenceLayout({
  data,
  filters,
}: {
  data: ReferenceDashboardData;
  filters: React.ReactNode;
}) {
  const m = data.metrics;
  const required = metricDetail(m, "hc", "required");
  const available = metricDetail(m, "hc", "available");
  const missingPunch = metricDetail(m, "att", "missedPunch");
  const rosterAdherence = asNumber(data.biometric.roster_adherence_pct);
  const gap = required !== null && available !== null ? Math.max(0, required - available) : null;
  const shrinkage = asNumber(data.biometric.shrinkage_pct);
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
          { label: "Required HC", value: required, helper: required === null ? "Planning source unavailable" : "Planned or mandated requirement", icon: Users, tone: required === null ? "slate" : "blue" },
          { label: "Available HC", value: available, helper: available === null ? "Login-session source unavailable" : gap === null ? "Clocked-in workforce" : `${formatValue(gap)} net gap`, icon: UserCheck, tone: available === null || gap === null ? "slate" : gap > 0 ? "amber" : "green" },
          { label: "Roster Adherence", value: rosterAdherence, valueSuffix: "%", helper: "Rostered versus actual attendance", icon: Target, tone: rosterAdherence === null ? "slate" : "violet" },
          { label: "Missing Punch", value: missingPunch, helper: "Attendance exceptions", icon: Clock3, tone: missingPunch && missingPunch > 0 ? "red" : "green" },
        ]}
      />

      <div className="grid gap-4 xl:grid-cols-[1.04fr_0.96fr]">
        <ReferencePanel
          title="Today's Operations Alerts"
          action={<span className="rounded-full bg-[#ef4444] px-2 py-0.5 text-xs font-bold text-white">{formatValue(interventionRows.length)}</span>}
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
              <p className="px-4 py-8 text-center text-sm text-[#a0aec0]">
                No source-backed operations alerts returned
              </p>
            )}
          </div>
        </ReferencePanel>

        <ReferenceAIBrief
          title="Automated Workforce Summary"
          actionHref="/reports"
          items={[
            { label: "Headcount Gap", value: gap, text: "Required versus available workforce in the selected branch and process.", icon: Users, tone: gap === null ? "slate" : gap > 0 ? "red" : "green" },
            { label: "Roster Adherence", value: rosterAdherence === null ? null : `${rosterAdherence}%`, text: "Rostered workforce compared with actual attendance.", icon: Target, tone: rosterAdherence === null ? "slate" : "violet" },
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
                <p className={`text-xs font-bold ${item.tone === "green" ? "text-[#16a34a]" : item.tone === "amber" ? "text-[#f97316]" : "text-[#ef4444]"}`}>{item.label}</p>
                <p className="mt-2 text-[25px] font-extrabold leading-none text-[#0b1f44]">{formatValue(item.value)}</p>
                <p className="mt-2 text-xs text-[#71809a]">Employees · {item.helper}</p>
              </div>
            ))}
          </div>
        </ReferencePanel>
        <ReferenceWorkInbox maxItems={4} />
      </div>
    </div>
  );
}
