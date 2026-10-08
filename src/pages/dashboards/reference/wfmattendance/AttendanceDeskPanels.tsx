import { CalendarClock, Clock3, Fingerprint, ListChecks, ShieldAlert, UserCheck } from "lucide-react";
import { ReferenceLineChart, ReferenceListRow, ReferencePanel, ReferenceProgress, ReferenceQuickLink } from "../../ReferenceDashboardUI";
import type { ReferenceDashboardData } from "../../reference-dashboard-model";
import { arrayAt, asNumber, formatValue, metricDetail, read } from "../../reference-dashboard-model";
import { kpiOf } from "../wfm/insightBits";

/** The pre-redesign attendance panels, kept and corrected. Windows are labelled; copied/placeholder values are gone. */

export function LateArrivalsPanel({ data }: { data: ReferenceDashboardData }) {
  const rows = arrayAt(data.biometric, "late_arrival_trend").map((r) => ({ label: String(r.label ?? r.hour ?? r.time ?? ""), value: Number(r.value ?? r.count ?? 0) }));
  return (
    <ReferencePanel title="Late Arrivals Trend" action={<span className="text-xs text-[#61708a]">today, by arrival hour</span>}>
      {rows.length ? <ReferenceLineChart data={rows} height={170} /> : <p className="py-10 text-center text-xs text-[#94a3b8]">No late arrivals recorded yet today (attendance for today is still being written)</p>}
    </ReferencePanel>
  );
}

export function RegularizationSummaryPanel({ data }: { data: ReferenceDashboardData }) {
  const r = (read(data.biometric, "regularization_summary") ?? {}) as Record<string, unknown>;
  const kinds = (asNumber(r.late_in) ?? 0) + (asNumber(r.early_out) ?? 0) + (asNumber(r.missed_punch) ?? 0);
  const cells: Array<[string, number | null]> = [["Pending", asNumber(r.pending)], ["Approved", asNumber(r.approved)], ["Rejected", asNumber(r.rejected)], ["Withdrawn", asNumber(r.cancelled)]];
  return (
    <ReferencePanel title="Regularization Requests Summary" action={<a className="text-xs font-semibold text-[#0b63e5]" href="/attendance-regularization">View All</a>}>
      <p className="mb-2 text-xs text-[#71809a]">Pending is everything open; the rest are the last 30 days.</p>
      <div className="grid grid-cols-4 gap-2">
        {cells.map(([label, value]) => (
          <div key={label} className="rounded-lg border border-[#e3e9f2] p-3 text-center"><p className="text-[19px] font-extrabold text-[#0b1f44]">{formatValue(value)}</p><p className="mt-1 text-xs text-[#71809a]">{label}</p></div>
        ))}
      </div>
      <div className="mt-4 space-y-3">
        <ReferenceProgress label="Late in" value={asNumber(r.late_in)} max={Math.max(1, kinds)} tone="amber" />
        <ReferenceProgress label="Early out" value={asNumber(r.early_out)} max={Math.max(1, kinds)} tone="amber" />
        <ReferenceProgress label="Missed punch" value={asNumber(r.missed_punch)} max={Math.max(1, kinds)} tone="amber" />
      </div>
    </ReferencePanel>
  );
}

/** COSEC pipeline status. There is no reader registry (biometric_device_master is empty), so this reports the feed, not devices. */
export function DeviceStatusPanel({ data }: { data: ReferenceDashboardData }) {
  const status = (data.devices as Record<string, unknown>)?.integrationStatus as Record<string, unknown> | undefined;
  const state = status?.status ? String(status.status) : null;
  const lag = kpiOf(data.insights, "cosec_sync_lag");
  const raw = kpiOf(data.insights, "cosec_raw_lag");
  const kiosks = kpiOf(data.insights, "kiosks_silent");
  const rowsList = [
    { title: "COSEC integration", value: state ?? "Unavailable", tone: state && /ok|health|success|online/i.test(state) ? "green" as const : "red" as const },
    { title: "Daily feed lag", value: lag?.value == null ? "—" : `${lag.value}h`, tone: lag?.tone === "green" ? "green" as const : "amber" as const },
    { title: "Raw punch sync", value: raw?.value == null ? "—" : `${raw.value}d stale`, tone: raw?.tone === "green" ? "green" as const : "red" as const },
    { title: "Break kiosks silent 24h", value: kiosks?.value == null ? "—" : String(kiosks.value), tone: kiosks?.value ? "amber" as const : "green" as const },
  ];
  return (
    <ReferencePanel title="Biometric Device Status" action={<a className="text-xs font-semibold text-[#0b63e5]" href="/wfm/attendance-integrity?tab=biometric">View All</a>} bodyClassName="p-0">
      <div className="divide-y divide-[#edf1f6]">
        {rowsList.map((r) => <ReferenceListRow key={r.title} icon={Fingerprint} title={r.title} value={r.value} tone={r.tone} />)}
      </div>
      <p className="border-t border-[#edf1f6] px-4 py-3 text-xs text-[#71809a]">Per-reader online/offline is not available: no device registry exists and punches carry no device id.</p>
    </ReferencePanel>
  );
}

export function ShiftSummaryPanel({ data }: { data: ReferenceDashboardData }) {
  const rows = arrayAt(data.biometric, "shift_summary");
  return (
    <ReferencePanel title="Shift Summary" action={<a className="text-xs font-semibold text-[#0b63e5]" href="/reports">View Full Report</a>} bodyClassName="p-0">
      <p className="px-4 pt-3 text-xs text-[#71809a]">Month to date, employees with a roster row only.</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-xs">
          <thead className="bg-[#f8fafc] text-[#61708a]"><tr><th className="px-4 py-2">Shift</th><th>Employees</th><th>Present</th><th>Absent</th><th>Late</th><th>Coverage</th></tr></thead>
          <tbody className="divide-y divide-[#edf1f6]">
            {rows.length ? rows.slice(0, 6).map((row, i) => (
              <tr key={String(row.shift_name ?? i)}><td className="px-4 py-2.5 font-medium text-[#1d2b45]">{String(row.shift_name ?? row.shift ?? `Shift ${i + 1}`)}</td><td>{formatValue(row.total)}</td><td>{formatValue(row.present)}</td><td>{formatValue(row.absent)}</td><td>{formatValue(row.late)}</td><td className="font-semibold text-[#16a34a]">{formatValue(row.coverage_pct, "%")}</td></tr>
            )) : <tr><td className="px-4 py-8 text-center text-[#94a3b8]" colSpan={6}>Shift summary is unavailable</td></tr>}
          </tbody>
        </table>
      </div>
    </ReferencePanel>
  );
}

export function ManualPunchPanel({ data }: { data: ReferenceDashboardData }) {
  const b = data.biometric;
  const exceptions = arrayAt(b, "manual_punch_exceptions");
  const missing = metricDetail(data.metrics, "att", "missedPunch");
  return (
    <ReferencePanel title="Manual Punch Exceptions (month to date)" bodyClassName="p-0">
      <div className="grid grid-cols-4 border-b border-[#edf1f6]">
        {([["Missed In", b.missed_in], ["Missed Out", b.missed_out], ["Multiple Punch", b.multiple_punch], ["Invalid Punch", b.invalid_punch]] as Array<[string, unknown]>).map(([label, value]) => (
          <div key={label} className="px-3 py-3 text-center"><p className="text-[18px] font-extrabold text-[#0b1f44]">{formatValue(asNumber(value))}</p><p className="mt-1 text-xs text-[#71809a]">{label}</p></div>
        ))}
      </div>
      <div className="max-h-[140px] divide-y divide-[#edf1f6] overflow-y-auto">
        {exceptions.slice(0, 3).map((row, i) => <ReferenceListRow key={String(row.id ?? i)} title={String(row.employee_name ?? row.name ?? "Employee")} subtitle={String(row.exception_type ?? row.type ?? "Punch exception")} value={String(row.status ?? "Pending")} tone="amber" />)}
        {!exceptions.length ? <div className="px-4 py-4 text-xs text-[#71809a]">Open exceptions on the processed day: {formatValue(missing)}. Multiple/invalid punches are not measured by any source.</div> : null}
      </div>
    </ReferencePanel>
  );
}

export function OvertimeAndCompliancePanels({ data }: { data: ReferenceDashboardData }) {
  const b = data.biometric;
  const otH = asNumber(b.overtime_hours ?? b.ot_hours), otE = asNumber(b.overtime_employees ?? b.ot_employees);
  return (
    <>
      <ReferencePanel title="Overtime Snapshot (month to date)">
        <div className="grid grid-cols-2 gap-3">
          <div><p className="text-xs text-[#71809a]">Employees</p><p className="mt-1 text-[22px] font-extrabold text-[#0b1f44]">{formatValue(otE)}</p></div>
          <div><p className="text-xs text-[#71809a]">OT Hours</p><p className="mt-1 text-[22px] font-extrabold text-[#0b1f44]">{formatValue(otH)}</p></div>
        </div>
      </ReferencePanel>
      <ReferencePanel title="Attendance Compliance (month to date)">
        <div className="space-y-4">
          <ReferenceProgress label="On-time In" value={asNumber(b.on_time_in_pct)} max={100} suffix="%" tone="green" />
          <ReferenceProgress label="Biometric-backed days" value={asNumber(b.biometric_compliance_pct)} max={100} suffix="%" tone="green" />
          <p className="text-xs text-[#71809a]">On-time out and weekly compliance have no source: they were copies of the attendance rate and are no longer shown.</p>
        </div>
      </ReferencePanel>
    </>
  );
}

export function AlertsAndActions({ data }: { data: ReferenceDashboardData }) {
  const alerts = arrayAt(data.opsPulse, "intervention_flags");
  const notMarked = kpiOf(data.insights, "no_record")?.value ?? null;
  const missing = metricDetail(data.metrics, "att", "missedPunch");
  return (
    <>
      <ReferencePanel title="Today's Alerts" action={<a className="text-xs font-semibold text-[#0b63e5]" href="/work-inbox">View All</a>} bodyClassName="p-0">
        <div className="divide-y divide-[#edf1f6]">
          {alerts.length ? alerts.slice(0, 5).map((row, i) => <ReferenceListRow key={String(row.id ?? i)} icon={ShieldAlert} title={String(row.title ?? row.label ?? "Attendance alert")} value={row.count ?? row.value} tone={String(row.severity ?? "").toLowerCase().includes("high") ? "red" : "amber"} href={String(row.action_url ?? "/work-inbox")} />) : (
            <>
              <ReferenceListRow icon={ShieldAlert} title="No attendance record" value={notMarked} tone="red" href="/wfm/attendance-integrity?tab=mismatches" />
              <ReferenceListRow icon={Clock3} title="Missing punches" value={missing} tone="red" href="/wfm/attendance-integrity?tab=mismatches" />
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
    </>
  );
}
