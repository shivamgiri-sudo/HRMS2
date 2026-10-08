/**
 * Pure calculations behind the CEO dashboard insights. No DB, no clock — every function takes what
 * it needs, so each formula can be pinned by a unit test.
 */

/** Last `n` calendar months as YYYY-MM, oldest first, ending with the month of `today`. */
export function monthKeys(today: string, n: number): string[] {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (n - 1 - i), 1));
    return d.toISOString().slice(0, 7);
  });
}

export interface FlowPoint {
  month: string;
  joins: number;
  exits: number;
  /** Exits whose tenure at exit was 90 days or less. */
  earlyExits: number;
  /** Headcount at the END of the month, reconstructed backwards from today's headcount. */
  headcountEnd: number;
  /** exits / average(headcount at start, headcount at end) x 100. null when no headcount. */
  attritionPct: number | null;
}

/**
 * Month-by-month people flow, rebuilt backwards from today's active headcount:
 *   headcount(end of M-1) = headcount(end of M) - joins(M) + exits(M)
 * (the same walk management.service.ts uses for its movement chart). Employees who left without a
 * recorded exit date are not in `exits`, so history is a floor, not a promise.
 */
export function buildFlow(
  months: string[],
  joinsByMonth: Map<string, number>,
  exitsByMonth: Map<string, number>,
  earlyByMonth: Map<string, number>,
  headcountNow: number,
): FlowPoint[] {
  let end = headcountNow;
  const out: FlowPoint[] = [];
  for (let i = months.length - 1; i >= 0; i -= 1) {
    const month = months[i]!;
    const joins = joinsByMonth.get(month) ?? 0;
    const exits = exitsByMonth.get(month) ?? 0;
    const start = end - joins + exits;
    const avg = (start + end) / 2;
    out.unshift({
      month, joins, exits,
      earlyExits: earlyByMonth.get(month) ?? 0,
      headcountEnd: end,
      attritionPct: avg > 0 ? Math.round((exits / avg) * 1000) / 10 : null,
    });
    end = start;
  }
  return out;
}

/**
 * Rolling-12-month attrition = exits in the 12 months / average headcount over those months x 100.
 * `flow` must be the 12 most recent months (the current, partial month included, because its exits
 * are real exits). The denominator is the mean of the month-end headcounts, so a shrinking or
 * growing floor does not flatter the figure. null when there is no headcount to divide by.
 */
export function rollingAttrition(flow: FlowPoint[]): { pct: number | null; exits: number; avgHeadcount: number | null } {
  const last = flow.slice(-12);
  const exits = last.reduce((s, p) => s + p.exits, 0);
  const avg = last.length ? last.reduce((s, p) => s + p.headcountEnd, 0) / last.length : 0;
  return { pct: avg > 0 ? Math.round((exits / avg) * 1000) / 10 : null, exits, avgHeadcount: avg > 0 ? Math.round(avg) : null };
}

/** Share of exits that happened inside the first 90 days, over the last `window` months. */
export function earlyExitShare(flow: FlowPoint[], window = 3): number | null {
  const last = flow.slice(-window);
  const exits = last.reduce((s, p) => s + p.exits, 0);
  const early = last.reduce((s, p) => s + p.earlyExits, 0);
  return exits > 0 ? Math.round((early / exits) * 1000) / 10 : null;
}

export interface MandateRow {
  branch: string;
  process: string;
  mandate: number;
  /** mandate + buffer% — the seat target HIRING_ALERT / its drilldown use, so tile and list agree. */
  seatTarget: number;
  /** mandate grossed up for shrinkage + every buffer (what must be rostered to DELIVER the mandate). */
  required: number;
  active: number;
}

/**
 * Required headcount for one mandate row: ceil(mandate x (1 + (buffer + shrinkage + attrition buffer +
 * training buffer) / 100)). Identical to management.service.ts `required_hc`.
 */
export function requiredHeadcount(mandate: number, bufferPcts: number[]): number {
  const total = bufferPcts.reduce((s, p) => s + (Number.isFinite(p) ? p : 0), 0);
  return Math.ceil(mandate * (1 + total / 100));
}

export function hiringGap(rows: MandateRow[]): {
  mandate: number; seatTarget: number; required: number; active: number;
  shortToMandate: number; shortToTarget: number; shortToRequired: number; fillPct: number | null; understaffed: number;
} {
  const mandate = rows.reduce((s, r) => s + r.mandate, 0);
  const required = rows.reduce((s, r) => s + r.required, 0);
  const active = rows.reduce((s, r) => s + r.active, 0);
  const seatTarget = rows.reduce((s, r) => s + r.seatTarget, 0);
  const shortToMandate = rows.reduce((s, r) => s + Math.max(0, r.mandate - r.active), 0);
  const shortToTarget = rows.reduce((s, r) => s + Math.max(0, r.seatTarget - r.active), 0);
  const shortToRequired = rows.reduce((s, r) => s + Math.max(0, r.required - r.active), 0);
  // Fill is capped per row so a surplus in one process cannot hide a shortage in another.
  const covered = rows.reduce((s, r) => s + Math.min(r.active, r.seatTarget), 0);
  return {
    mandate, seatTarget, required, active, shortToMandate, shortToTarget, shortToRequired,
    fillPct: seatTarget > 0 ? Math.round((covered / seatTarget) * 1000) / 10 : null,
    understaffed: rows.filter((r) => r.seatTarget > r.active).length,
  };
}

export interface DayAttendance {
  date: string;
  present: number;
  halfDay: number;
  absent: number;
  expected: number;
  rows: number;
}

/** attendance rate = (present + week_off_worked + 0.5 x half_day) / expected-to-work x 100. */
export function attendancePct(d: Pick<DayAttendance, "present" | "halfDay" | "expected">): number | null {
  return d.expected > 0 ? Math.round(((d.present + d.halfDay * 0.5) / d.expected) * 1000) / 10 : null;
}

/** shrinkage = (absent + unreconciled + 0.5 x half_day) / expected-to-work x 100 (management.service.ts). */
export function shrinkagePct(d: Pick<DayAttendance, "absent" | "halfDay" | "expected">): number | null {
  return d.expected > 0 ? Math.round(((d.absent + d.halfDay * 0.5) / d.expected) * 1000) / 10 : null;
}

/**
 * Keeps only days that are done being written: strictly before today, and with at least 90% of the busiest day's
 * records. Processed attendance lags (records for a day keep arriving for ~2 days), so a day at 50-60% of the usual
 * volume reads as a collapse in attendance - the CEO page once alarmed "Attendance is low 0.5%" off a morning-of day.
 */
export function completeDays(days: DayAttendance[], today?: string): DayAttendance[] {
  const settled = today ? days.filter((d) => d.date < today) : days;
  const max = settled.reduce((m, d) => Math.max(m, d.rows), 0);
  return settled.filter((d) => d.rows >= max * 0.9 && d.expected > 0);
}

export type FilingStatus = "overdue" | "due_soon" | "upcoming" | "filed";

export function filingStatus(row: { status: string; dueDate: string | null }, today: string): FilingStatus {
  if (/^(filed|paid|completed)$/i.test(row.status)) return "filed";
  if (!row.dueDate) return "upcoming";
  const days = Math.round((Date.parse(`${row.dueDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (days < 0) return "overdue";
  return days <= 7 ? "due_soon" : "upcoming";
}

/** The payroll month that should already have a run: the previous calendar month once the 1st has passed. */
export function expectedPayrollMonth(today: string): string {
  return monthKeys(today, 2)[0]!;
}

export interface HealthPart { key: string; label: string; score: number | null; weight: number }

/**
 * Composite 0-100 health. Parts that cannot be measured (score null) are dropped and the remaining
 * weights re-normalised, so a dead source never drags the ring toward 0 or props it up with a
 * made-up value. Returns null when fewer than two parts are measurable — one number is not a composite.
 */
export function compositeHealth(parts: HealthPart[]): { score: number | null; basis: string } {
  const live = parts.filter((p) => p.score !== null && Number.isFinite(p.score));
  if (live.length < 2) return { score: null, basis: "Not enough measurable sources for a composite score." };
  const w = live.reduce((s, p) => s + p.weight, 0);
  const score = live.reduce((s, p) => s + (p.score as number) * p.weight, 0) / w;
  const basis = live.map((p) => `${p.label} ${Math.round(p.score as number)} (w${Math.round((p.weight / w) * 100)}%)`).join(" · ");
  const skipped = parts.filter((p) => p.score === null).map((p) => p.label);
  return { score: Math.round(Math.max(0, Math.min(100, score))), basis: skipped.length ? `${basis}. Not measurable: ${skipped.join(", ")}.` : basis };
}

/** Map a rate to a 0-100 health score: `full` or better = 100, `zero` or worse = 0, linear between. */
export function scaleScore(value: number | null, zero: number, full: number): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  if (full === zero) return null;
  const t = (value - zero) / (full - zero);
  return Math.max(0, Math.min(100, t * 100));
}

/** Whole days from an ISO timestamp/date to `today` (YYYY-MM-DD), floor at 0; null when unparseable. */
export function ageDays(from: string | Date | null | undefined, today: string): number | null {
  if (!from) return null;
  const t = from instanceof Date ? from.getTime() : Date.parse(String(from));
  if (!Number.isFinite(t)) return null;
  // Timestamps are IST wall-clock stored as UTC-parsed by mysql2 depending on config; whole-day precision absorbs the offset.
  const d = Math.floor((Date.parse(`${today}T12:00:00Z`) - t) / 86_400_000);
  return Math.max(0, d);
}

const PRESENT = new Set(["present", "week_off_worked"]);
const NOT_EXPECTED = new Set(["holiday", "week_off", "leave_approved", "on_leave", "leave"]);

/** Collapse (date, status, count) rows into one DayAttendance per date, using the shared status vocabulary. */
export function pivotAttendance(rowsIn: Array<{ date: string; status: string; n: number }>): DayAttendance[] {
  const by = new Map<string, DayAttendance>();
  for (const r of rowsIn) {
    const d = by.get(r.date) ?? { date: r.date, present: 0, halfDay: 0, absent: 0, expected: 0, rows: 0 };
    d.rows += r.n;
    if (PRESENT.has(r.status)) d.present += r.n;
    if (r.status === "half_day") d.halfDay += r.n;
    if (r.status === "absent" || r.status === "unreconciled") d.absent += r.n;
    if (!NOT_EXPECTED.has(r.status) && r.status !== "") d.expected += r.n;
    by.set(r.date, d);
  }
  return [...by.values()].sort((a, b) => a.date.localeCompare(b.date));
}
