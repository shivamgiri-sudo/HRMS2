/**
 * Pure (no I/O) resolution of the roster off-day policy (table roster_offday_policy, migration 1850).
 *
 * A policy row is scoped process [+ LOB] [+ branch] and effective-dated. For one employee on one
 * date the most specific applicable row wins:
 *   3  process + LOB + branch
 *   2  process + LOB
 *   1  process + branch
 *   0  process
 * (NULL lob_id / branch_id on the row means "all"). Ties inside a rank go to the latest effective_from.
 *
 * FIXED_DAY  -> the resolver knows the exact off weekdays, so it can list the expected off dates.
 * FLOATING   -> N offs per week, allocated by the existing preference/fairness engine. The resolver
 *               forces NO dates for it; it only exposes offs-per-week so a roster can be validated.
 *
 * Weekday numbering is 0=Sunday..6=Saturday, the same as week_off_policy_default. All date maths is
 * done on YYYY-MM-DD strings in UTC so the host timezone can never shift a day.
 */

export type OffType = "FIXED_DAY" | "FLOATING";
export const OFF_TYPES: readonly OffType[] = ["FIXED_DAY", "FLOATING"];
export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export const MAX_FIXED_WEEKDAYS = 2;
export const MAX_FLOATING_OFFS_PER_WEEK = 6;

export interface OffdayPolicy {
  id: string;
  process_id: string;
  lob_id: string | null;
  branch_id: string | null;
  off_type: OffType;
  /** Sorted, de-duplicated weekday numbers; empty for FLOATING. */
  fixed_weekdays: number[];
  floating_offs_per_week: number | null;
  effective_from: string;
  effective_to: string | null;
}

export interface EmployeeOffScope {
  processId: string | null;
  lobId: string | null;
  branchId: string | null;
}

const DAY_MS = 86_400_000;

/** Coerce a Date or 'YYYY-MM-DD[...]' value to 'YYYY-MM-DD' (no timezone conversion for strings). */
export function toYmd(value: unknown): string {
  if (value instanceof Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  return String(value ?? "").slice(0, 10);
}

function utcMs(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function isValidYmd(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const dt = new Date(utcMs(value));
  return dt.toISOString().slice(0, 10) === value;
}

export function weekdayOf(ymd: string): number {
  return new Date(utcMs(ymd)).getUTCDay();
}

export function addDays(ymd: string, days: number): string {
  return new Date(utcMs(ymd) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Monday of the Monday-to-Sunday week containing ymd; used as the week's key. */
export function weekKey(ymd: string): string {
  const dow = weekdayOf(ymd);
  return addDays(ymd, dow === 0 ? -6 : 1 - dow);
}

export function dateRangeInclusive(from: string, to: string): string[] {
  const out: string[] = [];
  for (let ms = utcMs(from); ms <= utcMs(to); ms += DAY_MS) out.push(new Date(ms).toISOString().slice(0, 10));
  return out;
}

/** '0,6' -> [0,6]. Ignores anything that is not 0-6; sorted and de-duplicated. */
export function parseWeekdays(csv: unknown): number[] {
  const set = new Set<number>();
  for (const part of String(csv ?? "").split(",")) {
    const t = part.trim();
    if (!/^[0-6]$/.test(t)) continue;
    set.add(Number(t));
  }
  return [...set].sort((a, b) => a - b);
}

export function formatWeekdays(days: readonly number[]): string {
  return [...new Set(days)].sort((a, b) => a - b).join(",");
}

export function weekdayLabel(days: readonly number[]): string {
  return days.map((d) => WEEKDAY_NAMES[d]).join(" + ");
}

/** Specificity rank of a policy for a scope, or null when the policy does not apply to it. */
export function specificityFor(policy: OffdayPolicy, scope: EmployeeOffScope): number | null {
  if (!scope.processId || policy.process_id !== scope.processId) return null;
  if (policy.lob_id && policy.lob_id !== scope.lobId) return null;
  if (policy.branch_id && policy.branch_id !== scope.branchId) return null;
  if (policy.lob_id && policy.branch_id) return 3;
  if (policy.lob_id) return 2;
  if (policy.branch_id) return 1;
  return 0;
}

export function isEffectiveOn(policy: Pick<OffdayPolicy, "effective_from" | "effective_to">, date: string): boolean {
  return policy.effective_from <= date && (policy.effective_to === null || policy.effective_to >= date);
}

/** The winning policy for this scope on this date, or null when none is configured. */
export function pickPolicy(policies: readonly OffdayPolicy[], scope: EmployeeOffScope, date: string): OffdayPolicy | null {
  let best: OffdayPolicy | null = null;
  let bestRank = -1;
  for (const p of policies) {
    if (!isEffectiveOn(p, date)) continue;
    const rank = specificityFor(p, scope);
    if (rank === null) continue;
    if (rank > bestRank || (rank === bestRank && best !== null && p.effective_from > best.effective_from)) {
      best = p;
      bestRank = rank;
    }
  }
  return best;
}

/** True when this date is a policy-mandated fixed off for the scope. */
export function isFixedOffDate(policies: readonly OffdayPolicy[], scope: EmployeeOffScope, date: string): boolean {
  const p = pickPolicy(policies, scope, date);
  return p !== null && p.off_type === "FIXED_DAY" && p.fixed_weekdays.includes(weekdayOf(date));
}

/** True when a FIXED_DAY policy governs this scope on this date (whether or not the date is an off). */
export function hasFixedPolicy(policies: readonly OffdayPolicy[], scope: EmployeeOffScope, date: string): boolean {
  return pickPolicy(policies, scope, date)?.off_type === "FIXED_DAY";
}

/** Every date in [from, to] on which the scope must be off under a FIXED_DAY policy. FLOATING adds none. */
export function expectedFixedOffDates(
  policies: readonly OffdayPolicy[], scope: EmployeeOffScope, from: string, to: string,
): string[] {
  return dateRangeInclusive(from, to).filter((d) => isFixedOffDate(policies, scope, d));
}

/** Offs per week allowed by a FLOATING policy on this date, or null when none applies. */
export function floatingOffsPerWeek(policies: readonly OffdayPolicy[], scope: EmployeeOffScope, date: string): number | null {
  const p = pickPolicy(policies, scope, date);
  return p && p.off_type === "FLOATING" ? p.floating_offs_per_week : null;
}

/**
 * Week keys (Monday) in which the given off dates exceed `limit` offs. Dates need not be sorted or
 * unique.
 */
export function weeksOverFloatingLimit(offDates: readonly string[], limit: number): string[] {
  const counts = new Map<string, Set<string>>();
  for (const d of offDates) {
    const k = weekKey(d);
    const set = counts.get(k) ?? new Set<string>();
    set.add(d);
    counts.set(k, set);
  }
  return [...counts.entries()].filter(([, set]) => set.size > limit).map(([k]) => k).sort();
}

/** True when the two inclusive date ranges share a day (null end = open-ended). */
export function rangesOverlap(aFrom: string, aTo: string | null, bFrom: string, bTo: string | null): boolean {
  return aFrom <= (bTo ?? "9999-12-31") && bFrom <= (aTo ?? "9999-12-31");
}

/**
 * The single place that decides how a week-off row is written, so the two flags that mean the
 * same thing (is_week_off and assignment_type='WEEK_OFF') can never diverge. Any writer that marks
 * a roster row as a week-off spreads this into its INSERT/UPDATE columns.
 */
export function weekOffColumns(isWeekOff: boolean): { is_week_off: 0 | 1; assignment_type: "WEEK_OFF" | null } {
  return isWeekOff ? { is_week_off: 1, assignment_type: "WEEK_OFF" } : { is_week_off: 0, assignment_type: null };
}
