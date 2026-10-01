/**
 * Shift adherence — pure classification and roll-up, kept free of I/O so it can be unit-tested.
 *
 * Same planning rules as the Branch Health report's shrinkage block (roster-intelligence.service /
 * branch-health-report/query.ts), so the two never disagree about who was "planned":
 *  - plan = today's roster row; WEEK_OFF / LEAVE / HOLIDAY rows are not planned;
 *  - presence = a real punch-in (clock_in_time), never attendance_status;
 *  - a shift that has not reached start + grace and has no punch is "yet to start", left out.
 * On top of that it measures punctuality: minutes from rostered start to first punch, bucketed,
 * and (for shifts that have already ended) whether the person logged out on time.
 */

export const NON_WORKING_ASSIGNMENTS = new Set(["WEEK_OFF", "LEAVE", "HOLIDAY"]);
export const LEAVE_STATUSES = new Set(["leave_approved", "approved_leave", "half_day_leave", "leave"]);

/** Leaving up to this many minutes before shift end is not counted as an early logout. */
export const EARLY_OUT_TOLERANCE_MIN = 5;

export type AdherenceStatus =
  | "on_time" | "late" | "absent" | "yet_to_start" | "leave" | "week_off_worked" | "non_working";

export interface AdherenceRow {
  assignmentType: string | null;
  isWeekOff: boolean;
  attendanceStatus: string | null;
  /** HH:MM[:SS] of the rostered start; null when the roster carries no timing. */
  shiftStart: string | null;
  punched: boolean;
  /** Minutes from rostered start to the first punch (negative = early). Null without a punch or timing. */
  loginDeltaMin: number | null;
  /** Minutes the shift ended ago (negative = still running). Null when end time unknown. */
  minutesSinceEnd: number | null;
  /** Minutes before shift end that the person logged out (negative = after end). Null without a punch-out. */
  earlyOutMin: number | null;
  hasPunchOut: boolean;
  /** Whether the shift start + grace has been reached (true for any past date). */
  dueYet: boolean;
}

export interface ClassifiedRow {
  status: AdherenceStatus;
  /** Minutes late when status === 'late'. */
  lateMin: number;
  /** Shift unmeasured for punctuality: punched, but the roster has no start time. */
  noShiftTime: boolean;
  shiftEnded: boolean;
  leftEarly: boolean;
  earlyOutMin: number;
  missedLogout: boolean;
}

export function classifyRow(r: AdherenceRow, graceMin: number): ClassifiedRow {
  const base: ClassifiedRow = { status: "non_working", lateMin: 0, noShiftTime: false, shiftEnded: false, leftEarly: false, earlyOutMin: 0, missedLogout: false };
  const type = String(r.assignmentType ?? "").toUpperCase();

  if (NON_WORKING_ASSIGNMENTS.has(type) || r.isWeekOff) {
    if (type === "LEAVE") return { ...base, status: "leave" };
    return { ...base, status: r.punched ? "week_off_worked" : "non_working" };
  }
  if (LEAVE_STATUSES.has(String(r.attendanceStatus ?? ""))) return { ...base, status: "leave" };
  if (!r.punched) return { ...base, status: r.dueYet ? "absent" : "yet_to_start" };

  const noShiftTime = r.loginDeltaMin === null;
  const delta = r.loginDeltaMin ?? 0;
  const late = !noShiftTime && delta > graceMin;

  const shiftEnded = r.minutesSinceEnd !== null && r.minutesSinceEnd >= 0;
  const earlyOutMin = r.earlyOutMin !== null && r.earlyOutMin > EARLY_OUT_TOLERANCE_MIN ? r.earlyOutMin : 0;
  return {
    status: late ? "late" : "on_time",
    lateMin: late ? delta : 0,
    noShiftTime,
    shiftEnded,
    leftEarly: shiftEnded && r.hasPunchOut && earlyOutMin > 0,
    earlyOutMin: shiftEnded && r.hasPunchOut ? earlyOutMin : 0,
    missedLogout: shiftEnded && !r.hasPunchOut,
  };
}

export const LATE_BUCKETS = [
  { key: "b1_5", label: "1–5 min", min: 1, max: 5 },
  { key: "b6_15", label: "6–15 min", min: 6, max: 15 },
  { key: "b16_30", label: "16–30 min", min: 16, max: 30 },
  { key: "b31_60", label: "31–60 min", min: 31, max: 60 },
  { key: "b60p", label: "60+ min", min: 61, max: Infinity },
] as const;
export type LateBucketKey = (typeof LATE_BUCKETS)[number]["key"];

export function lateBucketKey(lateMin: number): LateBucketKey {
  const b = LATE_BUCKETS.find((x) => lateMin >= x.min && lateMin <= x.max);
  return (b ?? LATE_BUCKETS[LATE_BUCKETS.length - 1]).key;
}

export interface Tally {
  planned: number; present: number; onTime: number; late: number; absent: number;
  yetToStart: number; onLeave: number; weekOffWorked: number; noShiftTime: number;
  lateMinTotal: number; lateMaxMin: number;
  leftEarly: number; missedLogout: number; shiftsEnded: number;
  buckets: Record<LateBucketKey, number>;
}

export const emptyTally = (): Tally => ({
  planned: 0, present: 0, onTime: 0, late: 0, absent: 0, yetToStart: 0, onLeave: 0, weekOffWorked: 0,
  noShiftTime: 0, lateMinTotal: 0, lateMaxMin: 0, leftEarly: 0, missedLogout: 0, shiftsEnded: 0,
  buckets: { b1_5: 0, b6_15: 0, b16_30: 0, b31_60: 0, b60p: 0 },
});

export function addToTally(t: Tally, c: ClassifiedRow): void {
  switch (c.status) {
    case "leave": t.onLeave += 1; return;
    case "week_off_worked": t.weekOffWorked += 1; return;
    case "non_working": return;
    case "yet_to_start": t.yetToStart += 1; return;
    case "absent": t.planned += 1; t.absent += 1; return;
    case "on_time":
    case "late":
      t.planned += 1; t.present += 1;
      if (c.noShiftTime) t.noShiftTime += 1;
      if (c.status === "on_time") t.onTime += 1;
      else {
        t.late += 1; t.lateMinTotal += c.lateMin; t.lateMaxMin = Math.max(t.lateMaxMin, c.lateMin);
        t.buckets[lateBucketKey(c.lateMin)] += 1;
      }
      if (c.shiftEnded) t.shiftsEnded += 1;
      if (c.leftEarly) t.leftEarly += 1;
      if (c.missedLogout) t.missedLogout += 1;
  }
}

const pct = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 100) : null);

/** Percentages and averages derived from a tally. Null (never 0) when there is nothing to divide by. */
export function deriveMetrics(t: Tally) {
  return {
    // Of everyone due, how many were at their desk on time.
    adherencePct: pct(t.onTime, t.planned),
    // Of those who showed up, how many were on time.
    punctualityPct: pct(t.onTime, t.present - t.noShiftTime),
    attendancePct: pct(t.present, t.planned),
    avgLateMin: t.late > 0 ? Math.round(t.lateMinTotal / t.late) : null,
    logoutAdherencePct: t.shiftsEnded > 0 ? pct(t.shiftsEnded - t.leftEarly - t.missedLogout, t.shiftsEnded) : null,
  };
}
