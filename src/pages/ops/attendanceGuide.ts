// Plain-language help for the attendance-mismatch drill-down, and the small pure helpers its actions use.
// The wording says what the problem MEANS for the person and what HR can do about it; the raw type is kept as a
// tooltip only. Roles mirror the server (ops-control-tower.routes.ts): the server is what enforces them.

export interface IssueGuide { label: string; plain: string; action: string }

export const ATTENDANCE_ISSUE_GUIDE: Record<string, IssueGuide> = {
  missing_adr: {
    label: "No attendance record",
    plain: "HRMS never created an attendance record for this person on this day. The nightly job missed it.",
    action: "Recent days fill in by themselves. For older days an admin or payroll head can back-fill the records, or HR can close the item as reviewed if payroll for that month is already done.",
  },
  zero_minute_attendance: {
    label: "Swiped, but HRMS shows 0 minutes",
    plain: "The biometric machine shows this person worked, but HRMS recorded no working minutes, so payroll would treat them as absent.",
    action: "The nightly re-sync normally fixes this. If it stays open, correct the attendance record for that day.",
  },
  missing_punch_with_usable_source: {
    label: "Marked missing punch, but punches exist",
    plain: "HRMS says a punch is missing, yet the machine has usable punches for that day.",
    action: "Re-sync the day or correct the attendance record using the punches shown on the machine.",
  },
  missing_ibd: {
    label: "Biometric summary not received",
    plain: "The machine recorded swipes, but HRMS has not received the daily biometric summary for this person.",
    action: "Usually clears at the next sync. If it persists, check that the biometric ID is mapped to the right employee.",
  },
  unmapped_cosec_user: {
    label: "Swipes not linked to an employee",
    plain: "Someone swipes on the machine but their biometric ID is not linked to any employee in HRMS.",
    action: "Link the biometric ID to the employee, or exclude the ID if it does not belong to staff.",
  },
  inactive_cosec_user_activity: {
    label: "Swipes from an inactive person",
    plain: "The machine shows activity for someone HRMS has marked inactive or left.",
    action: "Check whether the person has really left; if not, reactivate them, otherwise ask the branch to remove their biometric access.",
  },
  dialler_source_without_evidence: {
    label: "Dialler attendance with no evidence",
    plain: "Attendance was taken from the dialler, but there is no dialler, report or approved request behind it.",
    action: "Ask the branch for evidence, or correct the attendance record.",
  },
  salary_payable_days_mismatch: {
    label: "Payable days differ from attendance",
    plain: "The days to be paid do not match the attendance record for this person.",
    action: "Payroll should compare the payable days with the attendance and correct whichever is wrong.",
  },
};

export function guideFor(type: string): IssueGuide {
  return ATTENDANCE_ISSUE_GUIDE[type] ?? {
    label: type.replace(/_/g, " "),
    plain: "The attendance records do not agree for this day.",
    action: "Open the employee's attendance for that day and correct it.",
  };
}

/** Items newer than this heal automatically and are re-opened by the nightly audit if closed by hand. */
export const AUTO_HEAL_DAYS = 7;

/** Roles that may close old items / back-fill records. The server decides; this only hides buttons. */
export const CLOSE_ROLES = ["super_admin", "admin", "hr", "hr_admin", "payroll_head"];
export const BACKFILL_ROLES = ["super_admin", "admin", "payroll_head"];

interface MismatchRow { issueDate?: string; issueType?: string; daysOpen?: number }

export function summariseTypes(rows: MismatchRow[]): Array<{ type: string; label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(String(r.issueType ?? "other"), (counts.get(String(r.issueType ?? "other")) ?? 0) + 1);
  return [...counts.entries()].map(([type, count]) => ({ type, label: guideFor(type).label, count })).sort((a, b) => b.count - a.count);
}

/** Open items old enough to be closed by hand (older than the automatic window). */
export function countClosable(rows: MismatchRow[]): number {
  return rows.filter((r) => Number(r.daysOpen ?? 0) > AUTO_HEAL_DAYS).length;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * A sensible back-fill range for the "no attendance record" items on screen: from the oldest to the newest such
 * day, never more than 31 days, ending before today. Null when there is nothing to back-fill.
 */
export function suggestBackfillRange(rows: MismatchRow[], today: string): { from: string; to: string } | null {
  const days = rows.filter((r) => r.issueType === "missing_adr" && ISO.test(String(r.issueDate).slice(0, 10))).map((r) => String(r.issueDate).slice(0, 10)).sort();
  if (days.length === 0) return null;
  const yesterday = addDays(today, -1);
  const from = days[0]!;
  let to = days[days.length - 1]! > yesterday ? yesterday : days[days.length - 1]!;
  if (to < from) return null;
  const limit = addDays(from, 30);
  if (to > limit) to = limit;
  return { from, to };
}

export function timeAgo(iso: string | null, nowMs = Date.now()): string {
  if (!iso) return "never";
  const mins = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}
