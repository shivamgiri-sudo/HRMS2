// Shared types and pure helpers for the Mismatches tab (MismatchesPanel + its dialogs/drawer).

export type EscalationInfo = {
  id: string;
  level: number;
  status: "pending" | "recommended" | "resolved" | "superseded";
  due_at: string;
  escalation_note: string | null;
  recommended_status: string | null;
  recommendation_note: string | null;
  responded_at: string | null;
  created_at: string;
  escalated_to_name: string | null;
  escalated_to_code: string | null;
  is_overdue: boolean;
  can_respond: boolean;
};

export type MismatchRecord = {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_code: string;
  record_date: string;
  attendance_status: string;
  biometric_status: string | null;
  apr_status: string | null;
  mismatch_flag: number;
  biometric_minutes: number | null;
  dialler_minutes: number | null;
  raw_minutes: number | null;
  lwp_value: number;
  branch_name: string | null;
  process_name: string | null;
  designation: string | null;
  manager_name: string | null;
  manager_employee_id: string | null;
  mismatch_resolved_at: string | null;
  mismatch_resolution_reason: string | null;
  is_locked: number;
  escalation: EscalationInfo | null;
};

export type Summary = {
  unresolved_mismatches: number;
  week_off_worked: number;
  total_open: number;
};

export const FINAL_STATUSES = [
  { value: "present", label: "Present (Full Day)" },
  { value: "half_day", label: "Half Day" },
  { value: "absent", label: "Absent" },
  { value: "leave_approved", label: "Leave Approved" },
  { value: "holiday", label: "Holiday" },
  { value: "week_off", label: "Week Off" },
  { value: "week_off_worked", label: "Week Off – Worked" },
] as const;

export const LWP_BY_STATUS: Record<string, number> = {
  present: 0, half_day: 0.5, absent: 1,
  leave_approved: 0, holiday: 0, week_off: 0, week_off_worked: 0,
};

export const STATUS_LABEL: Record<string, string> = {
  present: "Present", half_day: "Half Day", absent: "Absent", missing_punch: "Missing Punch",
  week_off_worked: "Worked on Week-off", week_off: "Week Off", leave_approved: "On Leave", holiday: "Holiday",
};

export function statusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return STATUS_LABEL[status] ?? status;
}

export function fmtMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "no data";
  const m = Math.round(Number(minutes));
  if (!Number.isFinite(m) || m <= 0) return "no data";
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/** DD/MM/YYYY from an ISO date or datetime string (date part only — no timezone shift). */
export function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : value;
}

/** DD/MM/YYYY HH:mm for a full timestamp. */
export function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** The two competing readings of a day, as offered in the one-click resolve cards. */
export function sourceChoices(rec: MismatchRecord): { key: string; label: string; status: string; minutes: number | null }[] {
  if (rec.attendance_status === "week_off_worked") {
    return [
      { key: "wow", label: "Count as worked on week-off", status: "week_off_worked", minutes: rec.raw_minutes },
      { key: "wo", label: "Treat as plain week-off", status: "week_off", minutes: rec.raw_minutes },
    ];
  }
  return [
    { key: "bio", label: "Biometric says", status: rec.biometric_status ?? "", minutes: rec.biometric_minutes },
    { key: "apr", label: "APR says", status: rec.apr_status ?? "", minutes: rec.dialler_minutes },
  ].filter((c) => c.status);
}
