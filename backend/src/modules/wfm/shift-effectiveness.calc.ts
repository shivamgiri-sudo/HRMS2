/**
 * Pure calculation helpers for the Shift Effectiveness panel (no db, no express) so the
 * arithmetic that used to live inline in roster-analytics.routes.ts is unit-testable.
 *
 * Definitions (single source of truth, mirrored by the SQL in shift-effectiveness.service.ts):
 *  - a "counted" roster day is a working day: not a week-off, and its attendance status is decided
 *    (not leave_approved / holiday / week_off / unreconciled). Only counted days enter any denominator.
 *  - adherence  = present|half_day counted days / counted days
 *  - on-time    = present|half_day days with late_mark = 0 / present|half_day counted days
 *  - break compliance = kiosk-tracked employee-days with total break <= budget / employee-days tracked
 *  - Every ratio is `null` (never 0 / 100) when its denominator is 0, so "no data" is never shown as a score.
 */

/** Kiosk hard cap on the daily break allowance (break-management.service.ts HARD_MAX_DAILY_BREAK_MINUTES). */
export const BREAK_DAILY_HARD_MAX = 60;
/** A shift needs at least this many counted days in the window before it can be crowned "optimal". */
export const MIN_OPTIMAL_SCHEDULED_DAYS = 20;
/** Cohort size a target shift needs before it can be recommended to anyone. */
export const MIN_COHORT_EMPLOYEES = 5;
export const WINDOW_DAYS = 30;

const round1 = (n: number) => Math.round(n * 10) / 10;

export function pct(numerator: number, denominator: number): number | null {
  const n = Number(numerator);
  const d = Number(denominator);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0) return null;
  return round1((n / d) * 100);
}

/** Percentage-point change (cur - prev); null unless both periods have data. */
export function deltaPts(
  cur: number | null | undefined,
  prev: number | null | undefined,
): number | null {
  if (cur == null || prev == null) return null;
  return round1(cur - prev);
}

/** 0.4 adherence + 0.4 quality + 0.2 on-time. When quality is unknown the other two are re-weighted (not zero-filled). */
export function productivityScore(
  adherence: number | null,
  quality: number | null,
  onTime: number | null,
): number | null {
  if (adherence == null) return null;
  const ot = onTime ?? 0;
  if (quality == null) return Math.round((adherence * 0.4 + ot * 0.2) / 0.6);
  return Math.round(adherence * 0.4 + quality * 0.4 + ot * 0.2);
}

export function shiftTypeFromStartHour(
  hour: number,
): "MORNING" | "AFTERNOON" | "EVENING" | "NIGHT" {
  if (hour >= 20 || hour < 6) return "NIGHT";
  if (hour >= 17) return "EVENING";
  if (hour >= 12) return "AFTERNOON";
  return "MORNING";
}

export function dailyBreakBudget(setting: number | null | undefined): number {
  const n = Number(setting);
  if (!Number.isFinite(n) || n < 1) return BREAK_DAILY_HARD_MAX;
  return Math.min(BREAK_DAILY_HARD_MAX, n);
}

export function confidenceFromDays(days: number): "HIGH" | "MEDIUM" | "LOW" {
  return days >= 15 ? "HIGH" : days >= 8 ? "MEDIUM" : "LOW";
}

// ── Date windows (local calendar dates, YYYY-MM-DD) ──────────────────────────

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return ymd(new Date(y, m - 1, d + n));
}

export interface DateWindow {
  from: string;
  to: string;
}

/**
 * Current = the 30 completed days ending yesterday; previous = the 30 days before that.
 * Today and the future are excluded on purpose: a published roster for tomorrow has no attendance
 * yet and used to be counted as 100% absent (roster_date >= today-30 had no upper bound).
 */
export function analysisWindows(
  now: Date = new Date(),
  days = WINDOW_DAYS,
): { cur: DateWindow; prev: DateWindow } {
  const today = ymd(now);
  const curTo = addDays(today, -1);
  const curFrom = addDays(curTo, -(days - 1));
  const prevTo = addDays(curFrom, -1);
  const prevFrom = addDays(prevTo, -(days - 1));
  return {
    cur: { from: curFrom, to: curTo },
    prev: { from: prevFrom, to: prevTo },
  };
}

// ── Shift rows ───────────────────────────────────────────────────────────────

export interface ShiftAggRow {
  shiftId: string;
  scheduledDays: number;
  presentDays: number;
  onTimeDays: number;
  qualityAvg: number | null;
  qualityDays: number;
  breakDays: number;
  compliantBreakDays: number;
  avgBreakMinutes: number | null;
  avgBudget: number | null;
}

export interface ShiftMetrics {
  adherencePct: number | null;
  onTimePct: number | null;
  qualityAvg: number | null;
  breakCompliancePct: number | null;
  avgBreakMinutes: number | null;
  breakBudget: number;
  productivityScore: number | null;
}

export function shiftMetrics(r: ShiftAggRow): ShiftMetrics {
  const adherencePct = pct(r.presentDays, r.scheduledDays);
  const onTimePct = pct(r.onTimeDays, r.presentDays);
  const qualityAvg =
    r.qualityDays > 0 && r.qualityAvg != null
      ? Math.round(Number(r.qualityAvg) * 10) / 10
      : null;
  return {
    adherencePct,
    onTimePct,
    qualityAvg,
    breakCompliancePct: pct(r.compliantBreakDays, r.breakDays),
    avgBreakMinutes:
      r.breakDays > 0 && r.avgBreakMinutes != null
        ? Math.round(Number(r.avgBreakMinutes))
        : null,
    breakBudget: Math.round(Number(r.avgBudget ?? BREAK_DAILY_HARD_MAX)),
    productivityScore: productivityScore(adherencePct, qualityAvg, onTimePct),
  };
}

/** Sort by adherence (nulls last) and flag one optimal shift — only if its sample is big enough. */
export function rankShifts<
  T extends { metrics: { adherencePct: number | null }; scheduledDays: number },
>(shifts: T[]): Array<T & { rank: number; isOptimal: boolean }> {
  const sorted = [...shifts].sort((a, b) => {
    const x = a.metrics.adherencePct ?? -1;
    const y = b.metrics.adherencePct ?? -1;
    return y - x || b.scheduledDays - a.scheduledDays;
  });
  let optimalGiven = false;
  return sorted.map((s, i) => {
    const eligible =
      !optimalGiven &&
      s.metrics.adherencePct != null &&
      s.scheduledDays >= MIN_OPTIMAL_SCHEDULED_DAYS;
    if (eligible) optimalGiven = true;
    return { ...s, rank: i + 1, isOptimal: eligible };
  });
}

// ── Recommendations ─────────────────────────────────────────────────────────

export interface CohortShift {
  shiftId: string;
  shiftName: string;
  shiftTime: string;
  templateProcessId: string | null;
  templateBranchId: string | null;
  totalEmployees: number;
  scheduledDays: number;
  presentDays: number;
}

export interface EmployeeShiftRow {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  processId: string | null;
  branchId: string | null;
  shiftId: string;
  scheduledDays: number;
  presentDays: number;
}

export interface Recommendation {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  currentShift: string;
  currentShiftId: string;
  recommendedShift: string;
  recommendedShiftId: string;
  reason: string;
  expectedImprovement: number;
  personalAdherence: number;
  targetAdherence: number;
  scheduledDays: number;
  presentDays: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
}

const sameScope = (tpl: string | null, actual: string | null) =>
  tpl == null || (actual != null && tpl === actual);

/**
 * Rules-based (owner chose rules, not ML): an employee is flagged when their own adherence over the window is
 * < 70% AND >= 15pp below the best *eligible* cohort. Fixes vs the old inline version:
 *  - one row per employee (was one per employee x shift => duplicate React keys), current shift = the one worked most;
 *  - the target must be a shift the employee may actually work (template process/branch null or equal to theirs);
 *  - the target cohort needs >= MIN_COHORT_EMPLOYEES employees and must beat the employee's current shift cohort;
 *    the employee is never moved to their own shift.
 */
export function buildRecommendations(
  shifts: CohortShift[],
  empRows: EmployeeShiftRow[],
  limit = 25,
): Recommendation[] {
  const byId = new Map(shifts.map((s) => [s.shiftId, s]));
  const cohort = shifts
    .filter(
      (s) => s.totalEmployees >= MIN_COHORT_EMPLOYEES && s.scheduledDays > 0,
    )
    .map((s) => ({ s, adherence: (s.presentDays / s.scheduledDays) * 100 }));
  if (cohort.length < 2) return [];

  const perEmp = new Map<string, EmployeeShiftRow[]>();
  for (const r of empRows) {
    const list = perEmp.get(r.employeeId);
    if (list) list.push(r);
    else perEmp.set(r.employeeId, [r]);
  }

  const out: Recommendation[] = [];
  for (const rows of perEmp.values()) {
    const scheduled = rows.reduce((a, r) => a + Number(r.scheduledDays), 0);
    const present = rows.reduce((a, r) => a + Number(r.presentDays), 0);
    if (scheduled < 5) continue;
    const personal = (present / scheduled) * 100;
    if (personal >= 70) continue;
    const current = rows.reduce((a, r) =>
      Number(r.scheduledDays) > Number(a.scheduledDays) ? r : a,
    );
    const currentCohort =
      cohort.find(({ s }) => s.shiftId === current.shiftId)?.adherence ?? -1;
    const eligible = cohort.filter(
      ({ s, adherence }) =>
        s.shiftId !== current.shiftId &&
        adherence > currentCohort &&
        sameScope(s.templateProcessId, current.processId) &&
        sameScope(s.templateBranchId, current.branchId),
    );
    if (eligible.length === 0) continue;
    const best = eligible.reduce((a, b) => (b.adherence > a.adherence ? b : a));
    const gap = best.adherence - personal;
    if (gap < 15) continue;
    const cur = byId.get(current.shiftId);
    out.push({
      employeeId: current.employeeId,
      employeeCode: current.employeeCode,
      employeeName: current.employeeName,
      currentShift: cur
        ? `${cur.shiftName} (${cur.shiftTime})`
        : "Unknown shift",
      currentShiftId: current.shiftId,
      recommendedShift: `${best.s.shiftName} (${best.s.shiftTime})`,
      recommendedShiftId: best.s.shiftId,
      reason: `Present ${present}/${scheduled} working days (${Math.round(personal)}%) in the last ${WINDOW_DAYS} days vs ${Math.round(best.adherence)}% average on ${best.s.shiftName}. Indicative only: correlation, not proof the shift is the cause.`,
      expectedImprovement: Math.round(gap),
      personalAdherence: round1(personal),
      targetAdherence: round1(best.adherence),
      scheduledDays: scheduled,
      presentDays: present,
      confidence: confidenceFromDays(scheduled),
    });
  }
  return out
    .sort((a, b) => b.expectedImprovement - a.expectedImprovement)
    .slice(0, limit);
}
