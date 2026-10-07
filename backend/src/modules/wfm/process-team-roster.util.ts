/**
 * Pure classification helpers for the Process Team Roster (no DB) so the status rules
 * are unit-testable. Used by process-team-roster.service.ts.
 */
import { isShiftDueYet } from "./shift-due.util.js";

export const DEFAULT_GRACE_MINUTES = 5;

export type RosterStatus =
  "ON_TIME" | "LATE" | "ABSENT" | "ON_LEAVE" | "WEEK_OFF_HOLIDAY" | "UPCOMING";

export function timeToMinutes(t: string): number {
  const parts = t.split(":").map(Number);
  return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
}

/**
 * Minutes a punch is after shift start, wrap-safe across midnight: a 23:55 punch for a
 * 00:00 shift is 5 min EARLY (-5), not 1435 min late. Result within (-720, 720].
 */
export function signedMinutesFromShiftStart(
  firstIn: string,
  shiftStart: string,
): number {
  let diff = timeToMinutes(firstIn) - timeToMinutes(shiftStart);
  if (diff > 720) diff -= 1440;
  else if (diff <= -720) diff += 1440;
  return diff;
}

export interface ClassifyInput {
  assignmentType: string | null | undefined;
  shiftStart: string | null | undefined;
  firstIn: string | null | undefined;
  /** attendance_daily_record.attendance_status (engine result) if a record exists. */
  attStatus?: string | null;
  attLateMark?: number | null;
  attLateByMinutes?: number | null;
  /** An approved leave_request covers this date. */
  hasApprovedLeave?: boolean;
  graceMinutes?: number | null;
}

export interface ClassifyResult {
  status: RosterStatus;
  minutesLate: number | null;
}

export function classifyMember(
  input: ClassifyInput,
  date: string,
  now: Date = new Date(),
): ClassifyResult {
  const type = String(input.assignmentType ?? "").toUpperCase();
  const grace =
    input.graceMinutes != null && input.graceMinutes >= 0
      ? input.graceMinutes
      : DEFAULT_GRACE_MINUTES;
  const att = String(input.attStatus ?? "");
  const shiftStart = input.shiftStart ? String(input.shiftStart) : null;
  const firstIn = input.firstIn ? String(input.firstIn) : null;

  if (type === "WEEK_OFF" || type === "HOLIDAY")
    return { status: "WEEK_OFF_HOLIDAY", minutesLate: null };
  if (type === "LEAVE") return { status: "ON_LEAVE", minutesLate: null };

  if (firstIn) {
    if (shiftStart) {
      const diff = signedMinutesFromShiftStart(firstIn, shiftStart.slice(0, 8));
      if (diff > grace) return { status: "LATE", minutesLate: diff };
    }
    return { status: "ON_TIME", minutesLate: null };
  }

  // No punch evidence. An approved leave (or an engine-resolved leave day) is not an absence.
  if (input.hasApprovedLeave || att === "leave_approved")
    return { status: "ON_LEAVE", minutesLate: null };
  if (att === "week_off" || att === "holiday")
    return { status: "WEEK_OFF_HOLIDAY", minutesLate: null };
  // Engine marked present (e.g. regularised / dialler-sourced) but there is no punch time.
  if (att === "present" || att === "half_day") {
    if ((input.attLateMark ?? 0) > 0) {
      const by = input.attLateByMinutes ?? 0;
      return { status: "LATE", minutesLate: by > 0 ? by : null };
    }
    return { status: "ON_TIME", minutesLate: null };
  }
  if (!isShiftDueYet(shiftStart, date, grace, now))
    return { status: "UPCOMING", minutesLate: null };
  return { status: "ABSENT", minutesLate: null };
}

/** Keep the first row per employee_id (guards against join fan-out, e.g. overlapping leave requests). */
export function dedupeByEmployee<T extends Record<string, any>>(
  rows: T[],
): T[] {
  const seen = new Map<string, T>();
  for (const r of rows) {
    const k = String(r.employee_id);
    const prev = seen.get(k);
    if (!prev) seen.set(k, r);
    else if (!prev.leave_name && r.leave_name) seen.set(k, r);
  }
  return [...seen.values()];
}
