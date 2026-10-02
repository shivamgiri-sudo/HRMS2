import { EXPECTED_TO_WORK_EXCLUSIONS, HALF_DAY_STATUS, PRESENT_STATUSES } from "../../../../shared/attendanceStatus.js";

/**
 * Pure calculations behind the employee self dashboard. Kept free of I/O so the audit
 * rules (denominator, settled-day anchor, leave pooling) are unit-tested rather than read.
 */

export interface DayRow {
  /** YYYY-MM-DD */
  d: string;
  s: string;
  late: number;
  lateBy: number;
  lwp: number;
  mins: number;
}

export interface MonthSummary {
  present: number;
  half: number;
  absent: number;
  late: number;
  leave: number;
  holiday: number;
  weekOff: number;
  missing: number;
  unreconciled: number;
  /** Loss-of-pay days booked on the settled days (sum of lwp_value). */
  lop: number;
  /** Days someone was expected to work: settled days minus holiday / week-off / approved leave. */
  expected: number;
  attended: number;
  pct: number | null;
  /** Last settled (completed) day that has a row, or null. */
  settledThrough: string | null;
  settledRows: number;
  /** Earliest settled day that still needs regularising (missing_punch / absent / unreconciled). */
  oldestOpenDay: string | null;
  openDays: number;
}

const EXCLUDED = new Set<string>(EXPECTED_TO_WORK_EXCLUSIONS);
const PRESENT = new Set<string>(PRESENT_STATUSES);

/**
 * Summarise one calendar month for one person.
 *
 * Only SETTLED days (strictly before `today`) count. Rows for the current day are created at
 * start-of-day, before any punch is reconciled — at 01:14 on 2 Oct production held 26 rows for
 * the day, 19 of them already `absent` and none `present`. Counting them would charge an
 * employee an absence for a shift that has not happened yet (same rule as
 * LATEST_COMPLETE_ATTENDANCE_DATE_SQL, which also excludes today).
 *
 * Denominator = settled days minus holiday / week_off / leave_approved (shared vocabulary);
 * numerator = full days + 0.5 x half days. No settled rows -> pct null (never a fake 0%).
 */
export function summariseMonth(rows: DayRow[], monthPrefix: string, today: string): MonthSummary {
  const settled = rows.filter((r) => r.d.startsWith(monthPrefix) && r.d < today);
  const count = (pred: (r: DayRow) => boolean) => settled.filter(pred).length;
  const present = count((r) => PRESENT.has(r.s));
  const half = count((r) => r.s === HALF_DAY_STATUS);
  const expected = count((r) => !EXCLUDED.has(r.s));
  const attended = present + half * 0.5;
  const open = settled.filter((r) => r.s === "missing_punch" || r.s === "absent" || r.s === "unreconciled");
  const pct = expected > 0 ? Math.round((attended / expected) * 1000) / 10 : null;
  return {
    present,
    half,
    absent: count((r) => r.s === "absent"),
    late: count((r) => r.late === 1),
    leave: count((r) => r.s === "leave_approved"),
    holiday: count((r) => r.s === "holiday"),
    weekOff: count((r) => r.s === "week_off"),
    missing: count((r) => r.s === "missing_punch"),
    unreconciled: count((r) => r.s === "unreconciled"),
    lop: Math.round(settled.reduce((sum, r) => sum + r.lwp, 0) * 100) / 100,
    expected,
    attended,
    pct,
    settledThrough: settled.length ? settled.reduce((m, r) => (r.d > m ? r.d : m), settled[0].d) : null,
    settledRows: settled.length,
    oldestOpenDay: open.length ? open.reduce((m, r) => (r.d < m ? r.d : m), open[0].d) : null,
    openDays: open.length,
  };
}

/** Cumulative attendance % after each settled day (for the sparkline). */
export function cumulativePct(rows: DayRow[], monthPrefix: string, today: string): number[] {
  const settled = rows.filter((r) => r.d.startsWith(monthPrefix) && r.d < today).sort((a, b) => a.d.localeCompare(b.d));
  const out: number[] = [];
  let attended = 0;
  let expected = 0;
  for (const r of settled) {
    if (EXCLUDED.has(r.s)) continue;
    expected += 1;
    attended += PRESENT.has(r.s) ? 1 : r.s === HALF_DAY_STATUS ? 0.5 : 0;
    out.push(Math.round((attended / expected) * 1000) / 10);
  }
  return out;
}

export function daysBetween(from: string, to: string): number {
  return Math.max(0, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000));
}

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

export function prevMonthPrefix(today: string): string {
  const [y, m] = today.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** First day of the previous month, for the single query that serves both months. */
export function prevMonthStart(today: string): string {
  return `${prevMonthPrefix(today)}-01`;
}

export type CalendarCell = "present" | "half_day" | "absent" | "leave" | "holiday" | "week_off" | "missing" | "unreconciled" | "today" | "future" | "norecord";

/** Map a raw status to the calendar vocabulary the frontend colours. */
export function calendarCell(row: DayRow | undefined, date: string, today: string, holiday: boolean): CalendarCell {
  if (date > today) return "future";
  if (!row) return date === today ? "today" : holiday ? "holiday" : "norecord";
  if (date === today) return "today";
  switch (row.s) {
    case "present": case "week_off_worked": return "present";
    case "half_day": return "half_day";
    case "absent": return "absent";
    case "leave_approved": return "leave";
    case "holiday": return "holiday";
    case "week_off": return "week_off";
    case "missing_punch": return "missing";
    default: return "unreconciled";
  }
}

export interface LeaveBalanceRow {
  code: string;
  name: string;
  carryForward: boolean;
  allocated: number;
  used: number;
  adjusted: number;
}

export interface LeaveBalance extends LeaveBalanceRow {
  remaining: number;
  /** Event-driven entitlements (maternity / paternity) — listed, but never pooled into "available". */
  eventBased: boolean;
}

/** Maternity / paternity are entitlements for an event, not a leave pool the person can plan with. */
const EVENT_CODES = new Set(["MTRL", "ML_MAT", "PTRL", "PL", "PML"]);
/** Unpaid leave has no balance to run down. */
const LEGACY_CODES = new Set(["PTRL", "MTRL"]);
const NO_BALANCE_CODES = new Set(["LWP"]);

/**
 * Per-type balance, mirroring leaveService.getBalance (available = allocated + adjusted - used,
 * floored at 0) and its legacy-twin merge ("Paternity Leave (Legacy)" folds into "Paternity Leave").
 * Types with nothing allocated and nothing used are dropped, so a person is not shown a
 * 180-day maternity row they were never granted.
 */
export function buildLeaveBalances(rows: LeaveBalanceRow[]): LeaveBalance[] {
  const key = (name: string) => name.toLowerCase().replace(/\s*\(legacy\)\s*$/, "").trim();
  const merged = new Map<string, LeaveBalanceRow>();
  for (const row of rows) {
    if (NO_BALANCE_CODES.has(row.code.toUpperCase())) continue;
    const k = key(row.name);
    const prev = merged.get(k);
    // The canonical (non-legacy) row keeps the display identity, as in leaveService.getBalance.
    const isLegacy = (r: LeaveBalanceRow) => /\(legacy\)\s*$/i.test(r.name) || LEGACY_CODES.has(r.code.toUpperCase());
    const base = prev && isLegacy(row) ? prev : row;
    merged.set(k, prev
      ? { ...base, allocated: prev.allocated + row.allocated, used: prev.used + row.used, adjusted: prev.adjusted + row.adjusted }
      : { ...row });
  }
  return [...merged.values()]
    .filter((r) => r.allocated + r.adjusted > 0 || r.used > 0)
    .map((r) => ({
      ...r,
      remaining: Math.max(0, Math.round((r.allocated + r.adjusted - r.used) * 100) / 100),
      eventBased: EVENT_CODES.has(r.code.toUpperCase()),
    }))
    .sort((a, b) => Number(a.eventBased) - Number(b.eventBased) || b.remaining - a.remaining);
}

export function summariseLeave(balances: LeaveBalance[], today: string): {
  available: number | null;
  lapsing: number;
  lapsesOn: string;
  lapsesInDays: number;
} {
  const pool = balances.filter((b) => !b.eventBased);
  const year = Number(today.slice(0, 4));
  const lapsesOn = `${year}-12-31`;
  return {
    available: pool.length ? Math.round(pool.reduce((s, b) => s + b.remaining, 0) * 100) / 100 : null,
    // carry_forward = 0 means the unused balance does not roll into next year's ledger.
    lapsing: Math.round(pool.filter((b) => !b.carryForward).reduce((s, b) => s + b.remaining, 0) * 100) / 100,
    lapsesOn,
    lapsesInDays: daysBetween(today, lapsesOn),
  };
}

export interface PayLine {
  runMonth: string;
  /** Higher = more final. */
  rank: number;
  gross: number | null;
  net: number | null;
  deductions: number | null;
  tds: number | null;
}

const RUN_RANK: Record<string, number> = { disbursed: 5, finalized: 4, locked: 3, approved: 2, completed: 1 };
export const VISIBLE_RUN_STATUSES = ["locked", "finalized", "approved", "disbursed", "completed"] as const;
export function runRank(status: string): number {
  return RUN_RANK[status.toLowerCase()] ?? 0;
}

/** One line per run_month (a re-run month must not be double counted), newest first. */
export function canonicalPayLines<T extends PayLine>(lines: T[]): T[] {
  const best = new Map<string, T>();
  for (const l of lines) {
    const cur = best.get(l.runMonth);
    if (!cur || l.rank > cur.rank) best.set(l.runMonth, l);
  }
  return [...best.values()].sort((a, b) => b.runMonth.localeCompare(a.runMonth));
}

/** Indian financial-year start month (YYYY-04) for a run month. */
export function fyStartMonth(runMonth: string): string {
  const [y, m] = runMonth.split("-").map(Number);
  return `${m >= 4 ? y : y - 1}-04`;
}

export function ytdTotals(lines: PayLine[], upToMonth: string): { gross: number | null; net: number | null; tds: number | null; months: number } {
  const from = fyStartMonth(upToMonth);
  const inFy = canonicalPayLines(lines).filter((l) => l.runMonth >= from && l.runMonth <= upToMonth);
  const sum = (pick: (l: PayLine) => number | null) => {
    const vals = inFy.map(pick).filter((v): v is number => v !== null);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) * 100) / 100 : null;
  };
  return { gross: sum((l) => l.gross), net: sum((l) => l.net), tds: sum((l) => l.tds), months: inFy.length };
}

export type TodayState = "week_off" | "holiday" | "leave" | "not_started" | "working" | "completed" | "no_punch";

/**
 * Where the person is in today's shift. `nowMinutes` is IST minutes-of-day. A shift is
 * "no_punch" only once it has been running for over an hour with nothing recorded, so
 * the hero does not shout at someone whose shift simply has not begun.
 */
export function todayState(input: {
  weekOff: boolean;
  holiday: boolean;
  onLeave: boolean;
  punchIn: string | null;
  punchOut: string | null;
  shiftStart: string | null;
  nowMinutes: number;
}): TodayState {
  if (input.onLeave) return "leave";
  if (input.holiday) return "holiday";
  if (input.weekOff) return "week_off";
  if (input.punchIn && input.punchOut) return "completed";
  if (input.punchIn) return "working";
  const start = toMinutes(input.shiftStart);
  if (start !== null && input.nowMinutes > start + 60) return "no_punch";
  return "not_started";
}

export function toMinutes(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Days from `today` until the next occurrence of an MM-DD (recurring birthday / anniversary). */
export function daysUntilAnnual(monthDay: string, today: string): number {
  const [y] = today.split("-").map(Number);
  const isLeap = (yr: number) => (yr % 4 === 0 && yr % 100 !== 0) || yr % 400 === 0;
  // A 29 Feb birthday is celebrated on 28 Feb in non-leap years.
  const dayIn = (yr: number) => (monthDay === "02-29" && !isLeap(yr) ? "02-28" : monthDay);
  let target = `${y}-${dayIn(y)}`;
  if (target < today) target = `${y + 1}-${dayIn(y + 1)}`;
  return daysBetween(today, target);
}
