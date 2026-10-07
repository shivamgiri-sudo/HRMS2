/**
 * Pure helpers for retention-intervention calculations (no DB, no Express) so the
 * thresholds and rate maths are unit-testable and shared by the service and its SQL.
 */

export type RiskTier = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export const OWNERS = ["hr_admin", "manager", "wfm", "process_head"] as const;
export type Owner = (typeof OWNERS)[number];

export const BUCKETS = [
  "open",
  "actioned",
  "retained",
  "exited",
  "overdue",
  "all",
] as const;
export type CaseBucket = (typeof BUCKETS)[number];

export const TIERS: readonly RiskTier[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

/** Score thresholds — identical to predictive-attrition / cron MIN_SCORE (55 = HIGH). */
export function tierFromScore(score: number): RiskTier {
  const s = Number.isFinite(score) ? score : 0;
  if (s >= 75) return "CRITICAL";
  if (s >= 55) return "HIGH";
  if (s >= 35) return "MEDIUM";
  return "LOW";
}

/** Hours within which an open case must be actioned, by its most urgent recommendation. */
export const SLA_HOURS = {
  immediate: 24,
  within_48h: 48,
  this_week: 168,
} as const;
export const DEFAULT_SLA_HOURS = SLA_HOURS.this_week;

/**
 * SQL expression (alias `r`) for the SLA hours of a row. Kept next to SLA_HOURS so the
 * two cannot drift; uses JSON_SEARCH on the stored recommendations array.
 */
export const SLA_HOURS_SQL = `CASE
  WHEN JSON_SEARCH(r.recommendations, 'one', 'immediate',   NULL, '$[*].priority') IS NOT NULL THEN ${SLA_HOURS.immediate}
  WHEN JSON_SEARCH(r.recommendations, 'one', 'within_48h',  NULL, '$[*].priority') IS NOT NULL THEN ${SLA_HOURS.within_48h}
  ELSE ${DEFAULT_SLA_HOURS} END`;

export function slaHoursFor(priorities: ReadonlyArray<string>): number {
  if (priorities.includes("immediate")) return SLA_HOURS.immediate;
  if (priorities.includes("within_48h")) return SLA_HOURS.within_48h;
  return DEFAULT_SLA_HOURS;
}

/** Percentage rounded to 1 dp; null (not 0) when the denominator is 0 so "no data" is not "0%". */
export function pctOf(numerator: number, denominator: number): number | null {
  const n = Number(numerator);
  const d = Number(denominator);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0) return null;
  return Math.round((n / d) * 1000) / 10;
}

/** Percent change cur vs prev; null when prev is 0 (undefined change), never Infinity/NaN. */
export function pctDelta(current: number, previous: number): number | null {
  const c = Number(current);
  const p = Number(previous);
  if (!Number.isFinite(c) || !Number.isFinite(p) || p <= 0) return null;
  return Math.round(((c - p) / p) * 1000) / 10;
}

export function normalizeOwner(raw: unknown): Owner | null {
  const v = typeof raw === "string" ? raw.trim() : "";
  return (OWNERS as readonly string[]).includes(v) ? (v as Owner) : null;
}

export function normalizeTier(raw: unknown): RiskTier | null {
  const v = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  return (TIERS as readonly string[]).includes(v) ? (v as RiskTier) : null;
}

export function normalizeBucket(
  raw: unknown,
  fallback: CaseBucket = "open",
): CaseBucket {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return (BUCKETS as readonly string[]).includes(v)
    ? (v as CaseBucket)
    : fallback;
}

export function clampLimit(raw: unknown, def = 50, max = 200): number {
  const n = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(n, max);
}

/** Strict YYYY-MM-DD that is also a real calendar date. */
export function isValidDateOnly(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Attendance % over WORKING days only: week-offs, holidays and approved leave are not absences. */
export const NON_WORKING_STATUSES = [
  "week_off",
  "week_off_worked",
  "holiday",
  "leave_approved",
] as const;
