import {
  CalendarClock,
  Clock3,
  Fingerprint,
  ListChecks,
  Network,
  ShieldAlert,
  UserCheck,
  UserMinus,
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

export function WfmAttendanceReferenceLayout({ data }: { data: ReferenceDashboardData }) {
  const { productHeaderControls } = useReferenceDashboardShell();
  const m = data.metrics;
  const active = metricDetail(m, "hc", "active") ?? metricValue(m, "hc");
  const present = metricDetail(m, "att", "present");
  const absent = metricDetail(m, "att", "absent");
  const late = metricDetail(m, "att", "late");
  const missingPunch = metricDetail(m, "att", "missedPunch");
  const onLeave = metricDetail(m, "att", "onLeave") ?? numberAt(data.biometric, "on_leave");
  const attendanceRate = metricDetail(m, "att", "attendanceRate") ?? metricValue(m, "att");
  const notMarked = metricDetail(m, "att", "notMarked");
  const workingRemotely = numberAt(data.biometric, "working_remotely");
  const adherence = asNumber(data.biometric.adherence_pct ?? attendanceRate);
  const rosterCoverage = asNumber(data.biometric.roster_coverage_pct ?? data.biometric.coverage_pct ?? adherence);
  const latePct = asNumber(data.biometric.late_pct);
  const deviceRows = arrayAt(data.devices, "devices").length ? arrayAt(data.devices, "devices") : arrayAt(data.devices, "data");
  const shiftRows = arrayAt(data.biometric, "shift_summary");
  const exceptionRows = arrayAt(data.biometric, "manual_punch_exceptions");
  const alertRows = arrayAt(data.opsPulse, "intervention_flags");
  const regularization = (read(data.biometric, "regularization_summary") ?? {}) as Record<string, unknown>;
  const overtimeHours = asNumber(data.biometric.overtime_hours ?? data.biometric.ot_hours);
  const overtimeEmployees = asNumber(data.biometric.overtime_employees ?? data.biometric.ot_employees);

  const trendRows = arrayAt(data.biometric, "late_arrival_trend").map((row) => ({
    label: String(row.label ?? row.hour ?? row.time ?? ""),
    value: Number(row.value ?? row.count ?? 0),
  }));

  return (
    <div className="reference-dashboard-page">
      <ReferenceHeader
        title="WFM / Attendance Dashboard"
        subtitle="Monitor workforce attendance, schedules and compliance in real time"
        right={productHeaderControls}
      />

      <ReferenceMetricGrid
        columns={6}
        loading={data.loading}
        metrics={[
          { label: "Total Employees", value: active, helper: "In selected scope", icon: Users, tone: "blue" },
          { label: "Present Today", value: present, helper: attendanceRate === null ? "Live" : `${attendanceRate}%`, icon: UserCheck, tone: "green" },
          { label: "Late Arrivals", value: late, helper: latePct === null ? "Today" : `${latePct}%`, icon: Clock3, tone: "amber" },
          { label: "Absent Today", value: absent, helper: "Attendance status", icon: UserMinus, tone: "red" },
          { label: "On Leave", value: onLeave, helper: "Approved leave", icon: CalendarClock, tone: "blue" },
          { label: "Working Remotely", value: workingRemotely, helper: "WFH / remote", icon: Network, tone: "violet" },
        ]}
      />

      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.05fr_1fr]">
        <ReferencePanel title="Live Attendance Status">
          <ReferenceDonut
            compact
            centerValue={attendanceRate === null ? null : `${attendanceRate}%`}
            centerLabel="Present"
            data={[
              { name: "Present", value: present ?? 0 },
              { name: "Late", value: late ?? 0 },
              { name: "Absent", value: absent ?? 0 },
              { name: "On Leave", value: onLeave ?? 0 },
              { name: "WFH", value: workingRemotely ?? 0 },
              { name: "Not Marked", value: notMarked ?? 0 },
            ]}
          />
          <p className="mt-2 text-[9px] text-[#71809a]">Last updated from finalized attendance records</p>
        </ReferencePanel>

        <ReferencePanel title="Late Arrivals Trend" action={<span className="text-[10px] text-[#61708a]">Today</span>}>
          <ReferenceLineChart data={trendRows} height={170} />
        </ReferencePanel>

        <ReferencePanel title="Regularization Requests Summary" action={<a className="text-[10px] font-semibold text-[#0b63e5]" href="/attendance-regularization">View All</a>}>
          <div className="grid grid-cols-4 gap-2">
            {[
              ["Pending", asNumber(regularization.pending), "amber"],
              ["Approved", asNumber(regularization.approved), "green"],
              ["Rejected", asNumber(regularization.rejected), "red"],
              ["Cancelled", asNumber(regularization.cancelled), "slate"],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-lg border border-[#e3e9f2] p-3 text-center">
                <p className="text-[19px] font-extrabold text-[#0b1f44]">{formatValue(value)}</p>
                <p className="mt-1 text-[9px] text-[#71809a]">{label}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 space-y-3">
            <ReferenceProgress label="Late In" value={asNumber(regularization.late_in)} max={Math.max(1, asNumber(regularization.pending) ?? 1)} tone="amber" />
            <ReferenceProgress label="Early Out" value={asNumber(regularization.early_out)} max={Math.max(1, asNumber(regularization.pending) ?? 1)} tone="amber" />
            <ReferenceProgress label="Missed Punch" value={asNumber(regularization.missed_punch)} max={Math.max(1, asNumber(regularization.pending) ?? 1)} tone="amber" />
          </div>
        </ReferencePanel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.75fr_1.25fr_1fr]">
        <ReferencePanel title="Biometric Device Status" action={<a className="text-[10px] font-semibold text-[#0b63e5]" href="/wfm/cosec-monitoring">View All</a>} bodyClassName="p-0">
          <div className="divide-y divide-[#edf1f6]">
            {deviceRows.length ? deviceRows.slice(0, 6).map((row, index) => (
              <ReferenceListRow key={String(row.id ?? index)} icon={Fingerprint} title={String(row.name ?? row.device_name ?? `Device ${index + 1}`)} value={String(row.status ?? "Unknown")} tone={["online", "success", "completed"].includes(String(row.status).toLowerCase()) ? "green" : "red"} />
            )) : <div className="px-4 py-10 text-center text-[10px] text-[#94a3b8]">Device status is unavailable</div>}
          </div>
        </ReferencePanel>

        <ReferencePanel title="Shift Summary" action={<a className="text-[10px] font-semibold text-[#0b63e5]" href="/reports">View Full Report</a>} bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-[9px]">
              <thead className="bg-[#f8fafc] text-[#61708a]"><tr><th className="px-4 py-2">Shift</th><th>Total Emp.</th><th>Present</th><th>Absent</th><th>Late</th><th>Coverage</th></tr></thead>
              <tbody className="divide-y divide-[#edf1f6]">
                {shiftRows.length ? shiftRows.slice(0, 6).map((row, index) => (
                  <tr key={String(row.id ?? index)}><td className="px-4 py-2.5 font-medium text-[#1d2b45]">{String(row.shift_name ?? row.shift ?? `Shift ${index + 1}`)}</td><td>{formatValue(row.total)}</td><td>{formatValue(row.present)}</td><td>{formatValue(row.absent)}</td><td>{formatValue(row.late)}</td><td className="font-semibold text-[#16a34a]">{formatValue(row.coverage_pct, "%")}</td></tr>
                )) : <tr><td className="px-4 py-8 text-center text-[#94a3b8]" colSpan={6}>Shift summary is unavailable</td></tr>}
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

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr_0.8fr_0.65fr_0.72fr]">
        <ReferencePanel title="Manual Punch Exceptions" bodyClassName="p-0">
          <div className="grid grid-cols-4 border-b border-[#edf1f6]">
            {[
              ["Missed In", asNumber(data.biometric.missed_in)],
              ["Missed Out", asNumber(data.biometric.missed_out)],
              ["Multiple Punch", asNumber(data.biometric.multiple_punch)],
              ["Invalid Punch", asNumber(data.biometric.invalid_punch)],
            ].map(([label, value]) => <div key={String(label)} className="px-3 py-3 text-center"><p className="text-[18px] font-extrabold text-[#0b1f44]">{formatValue(value)}</p><p className="mt-1 text-[8px] text-[#71809a]">{label}</p></div>)}
          </div>
          <div className="max-h-[128px] divide-y divide-[#edf1f6] overflow-y-auto">
            {exceptionRows.slice(0, 3).map((row, index) => <ReferenceListRow key={String(row.id ?? index)} title={String(row.employee_name ?? row.name ?? "Employee")} subtitle={String(row.exception_type ?? row.type ?? "Punch exception")} value={String(row.status ?? "Pending")} tone="amber" />)}
            {!exceptionRows.length ? <div className="px-4 py-4 text-[10px] text-[#71809a]">Open exceptions: {formatValue(missingPunch)}</div> : null}
          </div>
        </ReferencePanel>

        <ReferencePanel title="Overtime Snapshot">
          <div className="grid grid-cols-2 gap-3"><div><p className="text-[9px] text-[#71809a]">Employees</p><p className="mt-1 text-[22px] font-extrabold text-[#0b1f44]">{formatValue(overtimeEmployees)}</p></div><div><p className="text-[9px] text-[#71809a]">OT Hours</p><p className="mt-1 text-[22px] font-extrabold text-[#0b1f44]">{formatValue(overtimeHours)}</p></div></div>
        </ReferencePanel>

        <ReferencePanel title="Attendance Compliance">
          <div className="space-y-4">
            <ReferenceProgress label="On-time In" value={adherence} max={100} suffix="%" tone="green" />
            <ReferenceProgress label="On-time Out" value={asNumber(data.biometric.on_time_out_pct)} max={100} suffix="%" tone="green" />
            <ReferenceProgress label="Weekly Compliance" value={asNumber(data.biometric.weekly_compliance_pct)} max={100} suffix="%" tone="green" />
            <ReferenceProgress label="Biometric Compliance" value={asNumber(data.biometric.biometric_compliance_pct)} max={100} suffix="%" tone="green" />
          </div>
        </ReferencePanel>

        <ReferencePanel title="Today's Alerts" action={<a className="text-[9px] font-semibold text-[#0b63e5]" href="/work-inbox">View All</a>} bodyClassName="p-0">
          <div className="divide-y divide-[#edf1f6]">
            {alertRows.length ? alertRows.slice(0, 5).map((row, index) => <ReferenceListRow key={String(row.id ?? index)} icon={ShieldAlert} title={String(row.title ?? row.label ?? "Attendance alert")} value={row.count ?? row.value} tone={String(row.severity ?? "").toLowerCase().includes("high") ? "red" : "amber"} href={String(row.action_url ?? "/work-inbox")} />) : (
              <>
                <ReferenceListRow icon={ShieldAlert} title="Missing attendance" value={notMarked} tone="red" href="/attendance" />
                <ReferenceListRow icon={Clock3} title="Missing punches" value={missingPunch} tone="red" href="/wfm/mismatch-queue" />
              </>
            )}
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
