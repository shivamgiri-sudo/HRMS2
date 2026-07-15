import {
  Activity,
  AlertTriangle,
  CalendarClock,
  Clock3,
  Fingerprint,
  ListChecks,
  Network,
  ShieldAlert,
  Target,
  UserCheck,
  UserMinus,
  Users,
} from "lucide-react";

import { AIInsightPanel } from "@/components/ai";
import { WorkInboxPanel } from "@/components/dashboard";
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
  const present = metricDetail(m, "att", "present");
  const absent = metricDetail(m, "att", "absent");
  const late = metricDetail(m, "att", "late");
  const missingPunch = metricDetail(m, "att", "missedPunch");
  const attendanceRate = metricDetail(m, "att", "attendanceRate") ?? metricValue(m, "att");
  const gap = required !== null && available !== null ? required - available : null;
  const adherence = asNumber(data.biometric.adherence_pct ?? attendanceRate);
  const shrinkage = asNumber(data.biometric.shrinkage_pct);
  const latePct = asNumber(data.biometric.late_pct);
  const deviceRows = arrayAt(data.devices, "devices").length ? arrayAt(data.devices, "devices") : arrayAt(data.devices, "data");
  const interventionRows = arrayAt(data.opsPulse, "intervention_flags");
  const shiftRows = arrayAt(data.biometric, "shift_summary");
  const regularization = read(data.biometric, "regularization_summary") as Record<string, unknown> | undefined;
  const rosterCoverage = asNumber(data.biometric.roster_coverage_pct ?? data.biometric.coverage_pct ?? adherence);
  const overtimeHours = asNumber(data.biometric.overtime_hours ?? data.biometric.ot_hours);
  const overtimeEmployees = asNumber(data.biometric.overtime_employees ?? data.biometric.ot_employees);

  const trendRows = arrayAt(data.biometric, "late_arrival_trend").map((row) => ({
    label: String(row.label ?? row.hour ?? row.time ?? ""),
    value: Number(row.value ?? row.count ?? 0),
  }));

  const variance = {
    low: asNumber(data.biometric.variance_0_1 ?? data.biometric.variance_bucket_0_1),
    medium: asNumber(data.biometric.variance_1_4 ?? data.biometric.variance_bucket_1_4),
    high: asNumber(data.biometric.variance_4_plus ?? data.biometric.variance_bucket_4_plus),
  };

  const liveTotal = [present, absent, late, missingPunch].reduce((sum, value) => sum + (value ?? 0), 0);
  const presentPct = liveTotal > 0 && present !== null ? Math.round((present / liveTotal) * 1000) / 10 : attendanceRate;

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
        <ReferencePanel title="Today's Operations Alerts" action={<span className="rounded-full bg-[#ef4444] px-2 py-0.5 text-[9px] font-bold text-white">{formatValue(interventionRows.length)}</span>} bodyClassName="p-0">
          <div className="divide-y divide-[#edf1f6]">
            {interventionRows.length ? interventionRows.slice(0, 5).map((row, index) => (
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
                <ReferenceListRow icon={Users} title="Staffing gap" subtitle="Required versus available headcount" value={gap} tone={gap && gap > 0 ? "red" : "green"} href="/wfm/auto-roster" />
                <ReferenceListRow icon={Target} title="Roster adherence" subtitle="Attendance against roster target" value={attendanceRate === null ? null : `${attendanceRate}%`} tone={attendanceRate !== null && attendanceRate < 90 ? "amber" : "green"} href="/attendance" />
                <ReferenceListRow icon={Clock3} title="Missing punch issues" subtitle="Employees with incomplete punches" value={missingPunch} tone={missingPunch && missingPunch > 0 ? "red" : "green"} href="/wfm/mismatch-queue" />
                <ReferenceListRow icon={Activity} title="Overtime spike" subtitle="Overtime against configured target" value={overtimeHours} tone={overtimeHours && overtimeHours > 0 ? "amber" : "green"} href="/reports" />
              </>
            )}
          </div>
        </ReferencePanel>

        <AIInsightPanel
          contextType="wfm_roster"
          role="wfm"
          title="Workforce AI Analysis"
          enabled={!data.loading}
          data={{ required_hc: required, available_hc: available, hc_gap: gap, roster_adherence_pct: attendanceRate, missing_punch: missingPunch, shrinkage_pct: shrinkage }}
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
        <WorkInboxPanel maxItems={5} />
      </div>

      <div className="mt-2 border-t border-[#e3e9f2] pt-5">
        <ReferenceHeader title="WFM / Attendance Dashboard" subtitle="Monitor workforce attendance, schedules and compliance in real time" />
      </div>

      <ReferenceMetricGrid
        columns={6}
        loading={data.loading}
        metrics={[
          { label: "Total Employees", value: active, helper: "In selected scope", icon: Users, tone: "blue" },
          { label: "Present Today", value: present, helper: presentPct === null ? "Live" : `${presentPct}%`, icon: UserCheck, tone: "green" },
          { label: "Late Arrivals", value: late, helper: latePct === null ? "Today" : `${latePct}%`, icon: Clock3, tone: "amber" },
          { label: "Absent Today", value: absent, helper: "Attendance status", icon: UserMinus, tone: "red" },
          { label: "On Leave", value: numberAt(data.biometric, "on_leave"), helper: "Approved leave", icon: CalendarClock, tone: "blue" },
          { label: "Working Remotely", value: numberAt(data.biometric, "working_remotely"), helper: "WFH / remote", icon: Network, tone: "violet" },
        ]}
      />

      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.05fr_1fr]">
        <ReferencePanel title="Live Attendance Status">
          <ReferenceDonut
            compact
            centerValue={presentPct === null ? null : `${presentPct}%`}
            centerLabel="Present"
            data={[
              { name: "Present", value: present ?? 0 },
              { name: "Late", value: late ?? 0 },
              { name: "Absent", value: absent ?? 0 },
              { name: "On Leave", value: numberAt(data.biometric, "on_leave") ?? 0 },
              { name: "WFH", value: numberAt(data.biometric, "working_remotely") ?? 0 },
            ]}
          />
        </ReferencePanel>

        <ReferencePanel title="Late Arrivals Trend" action={<span className="text-[10px] text-[#61708a]">Today</span>}>
          <ReferenceLineChart data={trendRows} height={170} />
        </ReferencePanel>

        <ReferencePanel title="Regularization Requests Summary" action={<a className="text-[10px] font-semibold text-[#0b63e5]" href="/attendance-regularization">View All</a>}>
          <div className="grid grid-cols-4 gap-2">
            {[
              ["Pending", asNumber(regularization?.pending), "amber"],
              ["Approved", asNumber(regularization?.approved), "green"],
              ["Rejected", asNumber(regularization?.rejected), "red"],
              ["Cancelled", asNumber(regularization?.cancelled), "slate"],
            ].map(([label, value, tone]) => (
              <div key={String(label)} className="rounded-lg border border-[#e3e9f2] p-3 text-center">
                <p className="text-[19px] font-extrabold text-[#0b1f44]">{formatValue(value)}</p>
                <p className="mt-1 text-[9px] text-[#71809a]">{label}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 space-y-3">
            <ReferenceProgress label="Late In" value={asNumber(regularization?.late_in)} max={Math.max(1, asNumber(regularization?.pending) ?? 1)} tone="amber" />
            <ReferenceProgress label="Early Out" value={asNumber(regularization?.early_out)} max={Math.max(1, asNumber(regularization?.pending) ?? 1)} tone="amber" />
            <ReferenceProgress label="Missed Punch" value={asNumber(regularization?.missed_punch)} max={Math.max(1, asNumber(regularization?.pending) ?? 1)} tone="amber" />
          </div>
        </ReferencePanel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.75fr_1.25fr_1fr]">
        <ReferencePanel title="Biometric Device Status" action={<a className="text-[10px] font-semibold text-[#0b63e5]" href="/devices">View All</a>} bodyClassName="p-0">
          <div className="divide-y divide-[#edf1f6]">
            {deviceRows.length ? deviceRows.slice(0, 6).map((row, index) => (
              <ReferenceListRow key={String(row.id ?? index)} icon={Fingerprint} title={String(row.name ?? row.device_name ?? `Device ${index + 1}`)} value={String(row.status ?? "Unknown")} tone={String(row.status).toLowerCase() === "online" ? "green" : "red"} />
            )) : <div className="px-4 py-10 text-center text-[10px] text-[#94a3b8]">Device status is unavailable</div>}
          </div>
        </ReferencePanel>

        <ReferencePanel title="Shift Summary" action={<a className="text-[10px] font-semibold text-[#0b63e5]" href="/reports">View Full Report</a>} bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[9px]">
              <thead className="bg-[#f8fafc] text-[#61708a]"><tr><th className="px-4 py-2">Shift</th><th>Total Emp.</th><th>Present</th><th>Absent</th><th>Late</th><th>Coverage</th></tr></thead>
              <tbody className="divide-y divide-[#edf1f6]">
                {shiftRows.length ? shiftRows.slice(0, 6).map((row, index) => (
                  <tr key={String(row.id ?? index)}><td className="px-4 py-2.5 font-medium text-[#1d2b45]">{String(row.shift_name ?? row.shift ?? `Shift ${index + 1}`)}</td><td>{formatValue(row.total)}</td><td>{formatValue(row.present)}</td><td>{formatValue(row.absent)}</td><td>{formatValue(row.late)}</td><td className="font-semibold text-[#16a34a]">{formatValue(row.coverage_pct, "%")}</td></tr>
                )) : (
                  <tr><td className="px-4 py-8 text-center text-[#94a3b8]" colSpan={6}>Shift summary is unavailable</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </ReferencePanel>

        <ReferencePanel title="Roster Coverage">
          <ReferenceDonut compact centerValue={rosterCoverage === null ? null : `${rosterCoverage}%`} centerLabel="Coverage" data={[
            { name: "Fully Covered", value: asNumber(data.biometric.fully_covered) ?? 0 },
            { name: "Partially Covered", value: asNumber(data.biometric.partially_covered) ?? 0 },
            { name: "Understaffed", value: asNumber(data.biometric.understaffed) ?? 0 },
          ]} />
        </ReferencePanel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr_0.8fr_0.65fr]">
        <ReferencePanel title="Manual Punch Exceptions" bodyClassName="p-0">
          <div className="grid grid-cols-4 border-b border-[#edf1f6]">
            {[
              ["Missed In", asNumber(data.biometric.missed_in)],
              ["Missed Out", asNumber(data.biometric.missed_out)],
              ["Multiple Punch", asNumber(data.biometric.multiple_punch)],
              ["Invalid Punch", asNumber(data.biometric.invalid_punch)],
            ].map(([label, value]) => <div key={String(label)} className="px-3 py-3 text-center"><p className="text-[18px] font-extrabold text-[#0b1f44]">{formatValue(value)}</p><p className="mt-1 text-[8px] text-[#71809a]">{label}</p></div>)}
          </div>
          <div className="px-4 py-4 text-[10px] text-[#71809a]">Open exceptions: {formatValue(missingPunch)}</div>
        </ReferencePanel>

        <ReferencePanel title="Overtime Snapshot">
          <div className="grid grid-cols-2 gap-3">
            <div><p className="text-[9px] text-[#71809a]">Employees</p><p className="mt-1 text-[22px] font-extrabold text-[#0b1f44]">{formatValue(overtimeEmployees)}</p></div>
            <div><p className="text-[9px] text-[#71809a]">OT Hours</p><p className="mt-1 text-[22px] font-extrabold text-[#0b1f44]">{formatValue(overtimeHours)}</p></div>
          </div>
        </ReferencePanel>

        <ReferencePanel title="Attendance Compliance">
          <div className="space-y-4">
            <ReferenceProgress label="On-time In" value={adherence} max={100} suffix="%" tone="green" />
            <ReferenceProgress label="On-time Out" value={asNumber(data.biometric.on_time_out_pct)} max={100} suffix="%" tone="green" />
            <ReferenceProgress label="Weekly Compliance" value={asNumber(data.biometric.weekly_compliance_pct)} max={100} suffix="%" tone="green" />
            <ReferenceProgress label="Biometric Compliance" value={asNumber(data.biometric.biometric_compliance_pct)} max={100} suffix="%" tone="green" />
          </div>
        </ReferencePanel>

        <ReferencePanel title="Quick Actions">
          <div className="space-y-2">
            <ReferenceQuickLink icon={UserCheck} title="Mark Attendance" href="/attendance" tone="blue" />
            <ReferenceQuickLink icon={Fingerprint} title="Manual Punch" href="/attendance-regularization" tone="blue" />
            <ReferenceQuickLink icon={ListChecks} title="Apply Regularization" href="/attendance-regularization" tone="blue" />
            <ReferenceQuickLink icon={CalendarClock} title="View My Schedule" href="/my-roster" tone="blue" />
          </div>
        </ReferencePanel>
      </div>
    </div>
  );
}
