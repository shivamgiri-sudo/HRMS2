/**
 * Pure rules for healing missing attendance records. No database, no clock: `today` is always passed in.
 *
 * Background (found on production, 2026-10-03): the nightly engine writes one attendance_daily_record per
 * active employee per day, but it ran once, for yesterday only, on an in-process timer. A restart or deploy
 * at that moment cut the run short and nothing ever went back, which left permanent holes (26 Jul: 235
 * records instead of ~420 in one branch). These rules decide which days may be filled automatically and
 * which need a person to confirm.
 */

/** Days the system fills on its own, every night and after every restart. Matches the reconciliation window. */
export const AUTO_HEAL_DAYS = 7;
/** Longest range a manual backfill may cover in one request (the gap query's calendar is 31 days). */
export const MAX_BACKFILL_DAYS = 31;
/** Cap on person-days written by one request, so one click cannot run for hours or flood the database. */
export const MAX_PERSON_DAYS_PER_RUN = 5000;
/** The phrase an approver must send to commit a backfill that reaches beyond the automatic window. */
export const BACKFILL_CONFIRM_PHRASE = "BACKFILL";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !ISO.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

export interface RangeCheck {
  ok: boolean;
  message?: string;
  /** True when any part of the range is older than the automatic window, i.e. a person must confirm it. */
  needsConfirmation: boolean;
}

/**
 * A backfill range must be real dates, in order, at most 31 days, and entirely in the past: today is still
 * being worked, so its record would be written mid-day and be wrong by evening.
 */
export function validateBackfillRange(from: unknown, to: unknown, today: string): RangeCheck {
  if (!isIsoDate(from) || !isIsoDate(to)) return { ok: false, message: "from and to must be dates like 2026-07-26", needsConfirmation: false };
  if (from > to) return { ok: false, message: "from must not be after to", needsConfirmation: false };
  if (to >= today) return { ok: false, message: "to must be before today (today is still being worked)", needsConfirmation: false };
  if (daysBetween(from, to) + 1 > MAX_BACKFILL_DAYS) {
    return { ok: false, message: `a single backfill covers at most ${MAX_BACKFILL_DAYS} days; split it into smaller ranges`, needsConfirmation: false };
  }
  return { ok: true, needsConfirmation: from < addDays(today, -AUTO_HEAL_DAYS) };
}

/** The window the automatic heal covers: the last AUTO_HEAL_DAYS complete days, ending yesterday. */
export function autoHealWindow(today: string): { from: string; to: string } {
  return { from: addDays(today, -AUTO_HEAL_DAYS), to: addDays(today, -1) };
}

export interface MissingDay { employeeId: string; employeeCode: string; branchId: string | null; date: string }

export function summariseMissing(rows: MissingDay[]): {
  total: number; byBranch: Record<string, number>; byDate: Record<string, number>;
} {
  const byBranch: Record<string, number> = {};
  const byDate: Record<string, number> = {};
  for (const r of rows) {
    const b = r.branchId ?? "unassigned";
    byBranch[b] = (byBranch[b] ?? 0) + 1;
    byDate[r.date] = (byDate[r.date] ?? 0) + 1;
  }
  return { total: rows.length, byBranch, byDate };
}

/** Share of active staff with a record that day, 0-100. A day with nobody expected reads as complete. */
export function coveragePct(records: number, activeStaff: number): number {
  if (activeStaff <= 0) return 100;
  return Math.min(100, Math.round((records / activeStaff) * 1000) / 10);
}

/** Coverage below this is flagged: a normal day sits at 98-100%, a cut-off run leaves a large visible dip. */
export const LOW_COVERAGE_PCT = 90;

export function isLowCoverage(pct: number): boolean {
  return pct < LOW_COVERAGE_PCT;
}

export type HealthTone = "ok" | "warn" | "bad" | "unknown";

/** How stale a background job is, as a tone: nightly jobs get a day plus slack, frequent ones get less. */
export function jobTone(lastRunAt: Date | null, status: string | null, nowMs: number, expectedEveryHours: number): HealthTone {
  if (!lastRunAt) return "unknown";
  if (status === "failed") return "bad";
  const ageH = (nowMs - lastRunAt.getTime()) / 3_600_000;
  if (ageH <= expectedEveryHours * 1.5) return "ok";
  if (ageH <= expectedEveryHours * 3) return "warn";
  return "bad";
}

/** Every date from `from` to `to` inclusive, oldest first. */
export function enumerateDates(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Longest range one repair run may cover: each day takes minutes, and a run should finish within its job. */
export const MAX_REPAIR_DAYS = 14;

/** Range rules for the on-server repair script: real dates, ordered, entirely in the past, at most MAX_REPAIR_DAYS. */
export function validateRepairRange(from: unknown, to: unknown, today: string): { ok: boolean; message?: string } {
  const base = validateBackfillRange(from, to, today);
  if (!base.ok) return { ok: false, message: base.message };
  if (daysBetween(from as string, to as string) + 1 > MAX_REPAIR_DAYS) {
    return { ok: false, message: `a repair run covers at most ${MAX_REPAIR_DAYS} days; run it in smaller ranges` };
  }
  return { ok: true };
}
