/**
 * Pure calculation helpers for Roster Analytics (no DB, no clock reads unless `now` is passed).
 * Kept separate from roster-analytics.service.ts so the maths is unit-testable.
 *
 * Definitions (single source for shrinkage, cost and drill-downs):
 *  - Working row      : assignment_type not LEAVE / TRAINING / WEEK_OFF / HOLIDAY (NULL type = working).
 *  - Present          : a clock-in exists OR worked minutes > 0 (dialler-source rows carry minutes, no punch).
 *  - Absent           : working row, not present, and the shift is already due (today rows not yet due are skipped).
 *  - Shrinkage %      : (planned leave + training + unplanned absence) / (working rows counted + leave + training).
 *  - Hours lost       : per row, mutually exclusive: absent = expected; present = max(0, expected - worked).
 *                       Late / early / incomplete are labels on that same shortfall, never added on top.
 */
import { isShiftDueYet } from "./shift-due.util.js";

export const GRACE_MINUTES = 5;
/** Worked < 80% of the shift = early departure / short shift (weekly count and cost use the same cut). */
export const SHORT_SHIFT_PCT = 80;
/** Worked < 50% of the shift = incomplete shift (sub-class of short shift, cost only). */
export const INCOMPLETE_SHIFT_PCT = 50;
export const LATE_CAP_HOURS = 2;
export const DEFAULT_EXPECTED_HOURS = 8;
/** Average BPO agent cost per hour — a placeholder assumption until a cost-rate config exists (payroll data must not be read here). */
export const DEFAULT_HOURLY_COST_INR = 150;
export const INDUSTRY_AVG_SHRINKAGE = 12; // BPO industry benchmark

const NON_WORKING = new Set(["WEEK_OFF", "HOLIDAY"]);

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Minutes since midnight from "HH:MM[:SS]" OR "YYYY-MM-DD HH:MM:SS" (attendance_daily_record.clock_in_time is a
 * DATETIME and the pool uses dateStrings:true — splitting that on ':' gave NaN and silently disabled late detection).
 * Returns null when unparseable.
 */
export function clockToMinutes(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v);
  const m = s.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function shiftHours(start: unknown, end: unknown): number {
  const s = clockToMinutes(start);
  const e = clockToMinutes(end);
  if (s === null || e === null) return DEFAULT_EXPECTED_HOURS;
  const mins = e >= s ? e - s : 24 * 60 - s + e;
  return mins > 0 ? mins / 60 : DEFAULT_EXPECTED_HOURS;
}

/** Valid YYYY-MM with month 1..12. */
export function isValidPeriod(p: unknown): p is string {
  return typeof p === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(p);
}

/** Valid YYYY-MM-DD calendar date. */
export function isValidDate(d: unknown): d is string {
  if (typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
}

export function addDays(dateStr: string, n: number): string {
  const t = new Date(`${dateStr}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

export function dayNameOf(dateStr: string): string {
  const days = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  return days[new Date(`${dateStr}T00:00:00Z`).getUTCDay()];
}

export function localDateStr(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** First/last day of a YYYY-MM period, last day clamped to `yesterday` so unfinished days never count as absent. */
export function periodBounds(
  period: string,
  now: Date = new Date(),
): { first: string; last: string; empty: boolean } {
  const [y, m] = period.split("-").map(Number);
  const first = `${period}-01`;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const monthLast = `${period}-${String(dim).padStart(2, "0")}`;
  const yesterday = addDays(localDateStr(now), -1);
  const last = monthLast < yesterday ? monthLast : yesterday;
  return { first, last, empty: last < first };
}

/** Previous calendar month as YYYY-MM without the setMonth(-1) overflow (31 Oct -> "31 Sep" -> 1 Oct). */
export function previousPeriod(now: Date = new Date()): string {
  const y = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const m = now.getMonth() === 0 ? 12 : now.getMonth();
  return `${y}-${String(m).padStart(2, "0")}`;
}

/** Monday (YYYY-MM-DD, local) of the week containing `now`. */
export function mondayOf(now: Date = new Date()): string {
  const d = localDateStr(now);
  const dow = (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(d, -dow);
}

/** SQL guard excluding the synthetic 2026-06-11 roster cohort (see roster-analytics.routes.ts header). */
export const realRosterSql = (alias: string): string =>
  `NOT (${alias}.import_batch_id IS NULL AND ${alias}.cycle_id IS NULL ` +
  `AND ${alias}.assignment_type IS NULL AND ${alias}.shift_template_id IS NULL)`;

// ── Per-row classification ───────────────────────────────────────────────────

export interface RosterRow {
  roster_date: string;
  assignment_type?: string | null;
  shift_start_time?: string | null;
  shift_end_time?: string | null;
  template_start?: string | null;
  template_end?: string | null;
  first_in?: string | null;
  total_hours?: number | string | null;
}

export type RowStatus =
  "LEAVE" | "TRAINING" | "OFF" | "NOT_DUE" | "ABSENT" | "PRESENT";

export interface RowOutcome {
  status: RowStatus;
  /** Counts toward the shrinkage denominator (working-and-due, leave, training). */
  inBase: boolean;
  /** Counts toward the shrinkage numerator (leave, training, absent). */
  isShrinkage: boolean;
  /** Working-and-due (counted in totalPlanned). */
  isPlanned: boolean;
  expectedHours: number;
  workedHours: number;
  late: boolean;
  lateMinutes: number;
  short: boolean;
  incomplete: boolean;
  hoursLost: number;
  lostAbsent: number;
  lostLate: number;
  lostEarly: number;
  lostIncomplete: number;
  /** Capped at expected so planned = worked + lost holds. */
  workedCapped: number;
}

const ZERO = {
  expectedHours: 0,
  workedHours: 0,
  late: false,
  lateMinutes: 0,
  short: false,
  incomplete: false,
  hoursLost: 0,
  lostAbsent: 0,
  lostLate: 0,
  lostEarly: 0,
  lostIncomplete: 0,
  workedCapped: 0,
};

export function classifyRow(r: RosterRow, now: Date = new Date()): RowOutcome {
  const type = String(r.assignment_type ?? "").toUpperCase();
  if (type === "LEAVE")
    return {
      ...ZERO,
      status: "LEAVE",
      inBase: true,
      isShrinkage: true,
      isPlanned: false,
    };
  if (type === "TRAINING")
    return {
      ...ZERO,
      status: "TRAINING",
      inBase: true,
      isShrinkage: true,
      isPlanned: false,
    };
  if (NON_WORKING.has(type))
    return {
      ...ZERO,
      status: "OFF",
      inBase: false,
      isShrinkage: false,
      isPlanned: false,
    };

  const shiftStart = r.template_start || r.shift_start_time || null;
  const shiftEnd = r.template_end || r.shift_end_time || null;
  const worked = Number(r.total_hours);
  const workedHours = Number.isFinite(worked) && worked > 0 ? worked : 0;
  const present = Boolean(r.first_in) || workedHours > 0;

  if (
    !present &&
    !isShiftDueYet(
      shiftStart ? String(shiftStart) : null,
      r.roster_date,
      GRACE_MINUTES,
      now,
    )
  ) {
    return {
      ...ZERO,
      status: "NOT_DUE",
      inBase: false,
      isShrinkage: false,
      isPlanned: false,
    };
  }

  const expectedHours = shiftHours(shiftStart, shiftEnd);
  if (!present) {
    return {
      ...ZERO,
      status: "ABSENT",
      inBase: true,
      isShrinkage: true,
      isPlanned: true,
      expectedHours,
      hoursLost: expectedHours,
      lostAbsent: expectedHours,
    };
  }

  const loginMin = clockToMinutes(r.first_in);
  const startMin = clockToMinutes(shiftStart);
  const lateMinutes =
    loginMin !== null &&
    startMin !== null &&
    loginMin > startMin + GRACE_MINUTES
      ? loginMin - startMin
      : 0;
  const late = lateMinutes > 0;
  const short = workedHours < expectedHours * (SHORT_SHIFT_PCT / 100);
  const incomplete = workedHours < expectedHours * (INCOMPLETE_SHIFT_PCT / 100);
  const shortfall = Math.max(0, expectedHours - workedHours);

  let lostLate = 0,
    lostEarly = 0,
    lostIncomplete = 0;
  if (incomplete) lostIncomplete = shortfall;
  else if (short) lostEarly = shortfall;
  else if (late)
    lostLate = Math.min(shortfall, Math.min(lateMinutes / 60, LATE_CAP_HOURS));
  const hoursLost = lostLate + lostEarly + lostIncomplete;

  return {
    status: "PRESENT",
    inBase: true,
    isShrinkage: false,
    isPlanned: true,
    expectedHours,
    workedHours,
    late,
    lateMinutes,
    short,
    incomplete,
    hoursLost,
    lostAbsent: 0,
    lostLate,
    lostEarly,
    lostIncomplete,
    workedCapped: Math.min(workedHours, expectedHours),
  };
}

// ── Correlation ──────────────────────────────────────────────────────────────

/** Pearson r; null when fewer than `minN` points or zero variance. */
export function pearson(xs: number[], ys: number[], minN = 5): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < minN) return null;
  let sx = 0,
    sy = 0,
    sxy = 0,
    sx2 = 0,
    sy2 = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
    sxy += xs[i] * ys[i];
    sx2 += xs[i] ** 2;
    sy2 += ys[i] ** 2;
  }
  const den = Math.sqrt((n * sx2 - sx ** 2) * (n * sy2 - sy ** 2));
  return den > 0 ? round2((n * sxy - sx * sy) / den) : null;
}

// ── Forecast ─────────────────────────────────────────────────────────────────

export interface RateBucket {
  planned: number;
  absent: number;
}

export function rate(b: RateBucket | undefined): number | null {
  return b && b.planned > 0 ? (b.absent / b.planned) * 100 : null;
}

export interface ForecastInputs {
  dow: Map<number, RateBucket>; // JS weekday 0..6
  dom: Map<number, RateBucket>; // day of month
}

export interface ForecastDay {
  date: string;
  day: string;
  predictedPct: number;
  reasons: string[];
}

export interface ForecastResult {
  baseRate: number;
  mondayEffect: number;
  fridayEffect: number;
  monthEndEffect: number;
  days: ForecastDay[];
  avgPredicted: number;
}

/**
 * Baseline = overall absence rate over the window. Monday / Friday / month-end (day-of-month >= 27) effects are
 * their rate minus baseline, and a bucket with no data has effect 0 (was `-baseRate`, a fabricated "improvement").
 * Only positive effects raise a prediction. The headline is the mean of the 7 daily predictions.
 */
export function buildForecast(
  input: ForecastInputs,
  weekStart: string,
): ForecastResult {
  let planned = 0,
    absent = 0;
  for (const b of input.dow.values()) {
    planned += b.planned;
    absent += b.absent;
  }
  const baseRate = planned > 0 ? (absent / planned) * 100 : 0;

  const effect = (r: number | null) => (r === null ? 0 : round1(r - baseRate));
  const mondayEffect = effect(rate(input.dow.get(1)));
  const fridayEffect = effect(rate(input.dow.get(5)));
  const me = { planned: 0, absent: 0 };
  for (let d = 27; d <= 31; d++) {
    const b = input.dom.get(d);
    if (b) {
      me.planned += b.planned;
      me.absent += b.absent;
    }
  }
  const monthEndEffect = effect(rate(me));

  const days: ForecastDay[] = [];
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    const date = addDays(weekStart, i);
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    const dom = Number(date.slice(8, 10));
    let predicted = baseRate;
    const reasons: string[] = [];
    if (dow === 1) {
      predicted += Math.max(mondayEffect, 0);
      if (mondayEffect > 2) reasons.push("Monday effect");
    }
    if (dow === 5) {
      predicted += Math.max(fridayEffect, 0);
      if (fridayEffect > 2) reasons.push("Friday effect");
    }
    if (dom >= 27) {
      predicted += Math.max(monthEndEffect, 0);
      if (monthEndEffect > 2) reasons.push("Month-end");
    }
    predicted = round1(predicted);
    sum += predicted;
    days.push({ date, day: dayNameOf(date), predictedPct: predicted, reasons });
  }
  return {
    baseRate,
    mondayEffect,
    fridayEffect,
    monthEndEffect,
    days,
    avgPredicted: round1(sum / 7),
  };
}
