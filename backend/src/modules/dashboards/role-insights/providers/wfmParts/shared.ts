import type { RowDataPacket } from "mysql2";
import {
  HALF_DAY_STATUS, LATEST_COMPLETE_ATTENDANCE_DATE_SQL, LEAVE_STATUSES, NON_WORKING_STATUSES,
  PRESENT_STATUSES, statusList,
} from "../../../../../shared/attendanceStatus.js";
import { buildEmployeeLinkedScopeWhere } from "../../../../../shared/dashboardScope.js";
import { empScope, num, rows } from "../../helpers.js";
import type { InsightContext, InsightTone } from "../../types.js";

/**
 * Shared by the WFM and WFM-Attendance providers: pure calculations (exported for tests) and the
 * few queries both dashboards need, memoised per request context so parallel sections never run
 * the same scan twice.
 *
 * Date anchoring: processed attendance trails real time. "Today" is a partially written day, so every
 * attendance number here describes the latest COMPLETE processed day (shared/attendanceStatus.ts) and says so.
 */

/** WFM roster rows that are real assignments (the 412k synthetic cohort has every provenance column NULL). */
export const REAL_ROSTER =
  "NOT (ra.import_batch_id IS NULL AND ra.cycle_id IS NULL AND ra.assignment_type IS NULL AND ra.shift_template_id IS NULL)";
/**
 * Rostered but not a working shift: week-off, holiday, leave, a planned ABSENT marker, or UNSCHEDULED (no shift
 * times at all). NULL assignment_type is a working day. Counting UNSCHEDULED/ABSENT as working inflates the
 * denominator of every roster-based rate.
 */
export const ROSTER_NOT_WORKING =
  "(UPPER(COALESCE(ra.assignment_type,'')) IN ('WEEK_OFF','HOLIDAY','LEAVE','ABSENT','UNSCHEDULED') OR COALESCE(ra.is_week_off,0) = 1)";

export const PRESENT_IN = statusList([...PRESENT_STATUSES, HALF_DAY_STATUS]);
export const FULL_PRESENT_IN = statusList(PRESENT_STATUSES);
export const LEAVE_IN = statusList(LEAVE_STATUSES);
export const OFF_IN = statusList(NON_WORKING_STATUSES);

/**
 * Scope predicate for attendance_daily_record, which carries its own branch_id / process_id. Joining
 * `employees` just to scope a per-day rollup cost ~6s for 21k rows on the live DB (wide table, per-row PK
 * lookups) against ~0.5s without it, so rollups scope on the record's own columns exactly as the
 * ATTENDANCE metric does. Returns " AND ..." (leading space) or "".
 */
export function adrScope(ctx: InsightContext, alias = "a"): { sql: string; params: string[] } {
  const built = buildEmployeeLinkedScopeWhere(ctx.scope, `${alias}.employee_id`, `${alias}.branch_id`, `${alias}.process_id`);
  const clean = built.sql.replace(/^\s*(AND|WHERE)\s+/i, "");
  return { sql: clean && clean !== "1=1" ? ` AND ${clean}` : "", params: built.params };
}

/**
 * Employee-id scope filter for tables keyed by employee that carry no branch/process of their own
 * (roster, sessions, regularisations, leave...). Joining `employees` for scope costs ~0.5ms per row
 * on the live DB (5.5k roster rows = 2.8s), so scope is resolved ONCE to the in-scope active id list and
 * applied as `col IN (...)`.
 *  - "active": always filter to active, already-joined employees (live/future rosters, open queues).
 *  - "scoped": filter only when the caller is not org-wide, so historical rows of leavers stay in
 *    org-wide totals.
 */
const scopeIds = (ctx: InsightContext) =>
  once(ctx, "scope-ids", async () => {
    const s = empScope(ctx);
    const r = await rows(`SELECT e.id, e.employee_code FROM employees e WHERE e.active_status = 1 AND e.date_of_joining <= CURDATE()${s.sql}`, s.params);
    return r.map((x) => ({ id: String(x.id), code: x.employee_code === null ? null : String(x.employee_code) }));
  });
/** `key: "code"` filters on employee_code (integration_biometric_daily is keyed by code, not id). */
export async function idFilter(ctx: InsightContext, column: string, mode: "active" | "scoped", key: "id" | "code" = "id"): Promise<{ sql: string; params: string[] }> {
  if (mode === "scoped" && ctx.scope.level === "ORG_ALL") return { sql: "", params: [] };
  const ids = (await scopeIds(ctx)).map((x) => (key === "code" ? x.code : x.id)).filter((v): v is string => Boolean(v));
  if (!ids.length) return { sql: " AND 1 = 0", params: [] };
  return { sql: ` AND ${column} IN (${ids.map(() => "?").join(",")})`, params: ids };
}

// ── pure calculations ──────────────────────────────────────────────────────────────────────────────

export const round1 = (n: number) => Math.round(n * 10) / 10;
export function ratio(part: number | null, whole: number | null, digits = 1): number | null {
  if (part === null || whole === null || whole <= 0) return null;
  const f = 10 ** digits;
  return Math.round((part / whole) * 100 * f) / f;
}

export interface DayCounts { total: number; present: number; half: number; absent: number; leave: number; missing: number; late: number; off: number }

/** Days someone was expected to work: everything except week-off/holiday rows and approved leave. */
export const expectedToWork = (c: DayCounts) => c.total - c.off - c.leave;

/** Present + half a day per half day, over days expected to work (the canonical attendance rate). */
export function attendanceRate(c: DayCounts): number | null {
  return ratio(c.present + c.half * 0.5, expectedToWork(c));
}

/**
 * Shrinkage split. Both parts share one denominator (every day that is not week-off / holiday), so
 * planned + unplanned = total shrinkage and the three can be shown side by side without contradicting.
 */
export function shrinkage(c: DayCounts): { unplanned: number | null; planned: number | null; total: number | null } {
  const base = c.total - c.off;
  return { unplanned: ratio(c.absent, base), planned: ratio(c.leave, base), total: ratio(c.absent + c.leave, base) };
}

/** Days a record stayed in the unreconciled / missing-punch state as a share of the day's rows. */
export const unreconciledPct = (c: DayCounts) => ratio(c.missing, c.total);

/** Rows with at least this share of the busiest day count as a complete processed day. */
export function completeDays<T extends { total: number }>(days: T[], share = 0.5): T[] {
  const max = Math.max(0, ...days.map((d) => d.total));
  return days.filter((d) => max > 0 && d.total >= max * share);
}

export function ageBucket(days: number | null): "0-1d" | "2-3d" | "4-7d" | "8d+" | null {
  if (days === null || days < 0) return null;
  return days <= 1 ? "0-1d" : days <= 3 ? "2-3d" : days <= 7 ? "4-7d" : "8d+";
}

/** Consecutive-absent streak ending on `anchor`, from the dates (YYYY-MM-DD) the person was absent. */
export function absentStreak(absentDates: string[], anchor: string): number {
  const set = new Set(absentDates);
  let streak = 0;
  for (let t = new Date(`${anchor}T00:00:00Z`).getTime(); set.has(new Date(t).toISOString().slice(0, 10)); t -= 86_400_000) streak += 1;
  return streak;
}
export const abscondRisk = (streak: number): "abscond" | "watch" | null => (streak >= 5 ? "abscond" : streak >= 3 ? "watch" : null);

/**
 * Tomorrow's unplanned-absence forecast: mean unplanned-absence rate on the same weekday over recent
 * complete days, applied to the people expected to work, plus approved leave already booked for tomorrow.
 * Returns null when there is no same-weekday history (never a guessed 0).
 */
export function forecastAbsence(history: number[], expectedHeadcount: number | null, leaveTomorrow: number | null) {
  const clean = history.filter((v) => Number.isFinite(v));
  if (!clean.length || expectedHeadcount === null || expectedHeadcount <= 0) return null;
  const meanPct = clean.reduce((s, v) => s + v, 0) / clean.length;
  const unplanned = Math.round((meanPct / 100) * expectedHeadcount);
  const planned = leaveTomorrow ?? 0;
  return { meanPct: round1(meanPct), unplanned, planned, total: unplanned + planned, shrinkagePct: ratio(unplanned + planned, expectedHeadcount), samples: clean.length };
}

/** Composite 0-100 from whichever components are measurable; null when none are. */
export function composite(parts: Array<number | null | undefined>): number | null {
  const ok = parts.filter((p): p is number => typeof p === "number" && Number.isFinite(p));
  return ok.length ? Math.round(ok.reduce((s, p) => s + Math.max(0, Math.min(100, p)), 0) / ok.length) : null;
}

export const lagTone = (hours: number | null): InsightTone => (hours === null ? "slate" : hours <= 6 ? "green" : hours <= 24 ? "amber" : "red");
export const daysSince = (ymd: string | null, today: string): number | null =>
  ymd ? Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${ymd.slice(0, 10)}T00:00:00Z`)) / 86_400_000)) : null;
export const shortDate = (ymd: string) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
export const weekdayShort = (ymd: string) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });

// ── memoised per-request data ──────────────────────────────────────────────────────────────────────

const memo = new WeakMap<InsightContext, Map<string, Promise<unknown>>>();
export function once<T>(ctx: InsightContext, key: string, load: () => Promise<T>): Promise<T> {
  let m = memo.get(ctx);
  if (!m) { m = new Map(); memo.set(ctx, m); }
  if (!m.has(key)) m.set(key, load());
  return m.get(key) as Promise<T>;
}

/** Latest complete processed attendance day (YYYY-MM-DD), or null when attendance has no usable day. */
export const anchorDate = (ctx: InsightContext) =>
  once(ctx, "anchor", async () => {
    const r = await rows(`SELECT DATE_FORMAT(${LATEST_COMPLETE_ATTENDANCE_DATE_SQL}, '%Y-%m-%d') AS d`);
    return (r[0]?.d as string | null) ?? null;
  });

export interface DailyAttendance extends DayCounts { date: string; otHours: number; otPeople: number }

/** Per-day status counts for the 21 days before today (excluding today), complete days only. */
export const dailyAttendance = (ctx: InsightContext) =>
  once(ctx, "daily", async (): Promise<DailyAttendance[]> => {
    const s = adrScope(ctx);
    const from = new Date(Date.parse(`${ctx.today}T00:00:00Z`) - 21 * 86_400_000).toISOString().slice(0, 10);
    const r = await rows<RowDataPacket>(
      `SELECT DATE_FORMAT(a.record_date,'%Y-%m-%d') AS d, COUNT(*) AS total,
              SUM(a.attendance_status IN (${FULL_PRESENT_IN})) AS present,
              SUM(a.attendance_status = '${HALF_DAY_STATUS}') AS half,
              SUM(a.attendance_status = 'absent') AS absent,
              SUM(a.attendance_status IN (${LEAVE_IN})) AS leave_n,
              SUM(a.attendance_status = 'missing_punch') AS missing,
              SUM(a.late_mark = 1) AS late,
              SUM(a.attendance_status IN (${OFF_IN})) AS off_n,
              ROUND(SUM(GREATEST(COALESCE(a.raw_minutes,0) - 480, 0)) / 60, 1) AS ot_h,
              COUNT(DISTINCT CASE WHEN a.raw_minutes > 480 THEN a.employee_id END) AS ot_people
         FROM attendance_daily_record a
        WHERE a.record_date >= ? AND a.record_date < ?${s.sql}
        GROUP BY a.record_date ORDER BY a.record_date`,
      [from, ctx.today, ...s.params],
    );
    const n = (v: unknown) => num(v) ?? 0;
    const days = r.map((x) => ({
      date: String(x.d), total: n(x.total), present: n(x.present), half: n(x.half), absent: n(x.absent), leave: n(x.leave_n),
      missing: n(x.missing), late: n(x.late), off: n(x.off_n), otHours: n(x.ot_h), otPeople: n(x.ot_people),
    }));
    // Scope-relative completeness: a branch with 12 people still has "complete" days.
    return completeDays(days);
  });

/** Active, already-joined headcount in scope (denominator for "no record" and roster coverage). */
export const activeHeadcount = (ctx: InsightContext) =>
  once(ctx, "active", async () => {
    const s = empScope(ctx);
    const r = await rows(`SELECT COUNT(*) AS n FROM employees e WHERE e.active_status = 1 AND e.date_of_joining <= CURDATE()${s.sql}`, s.params);
    return num(r[0]?.n);
  });

export interface BiometricFreshness {
  dailyFeedAt: string | null; dailyFeedLagH: number | null; dailyFeedLatestDate: string | null;
  rawPunchAt: string | null; rawPunchLagH: number | null; watermarkAt: string | null;
}
/**
 * COSEC pipeline freshness. Two feeds exist and they have diverged: the daily biometric integration
 * (integration_biometric_daily, what attendance reads) and the raw punch table (cosec_punch_sync).
 * Lag is measured against the DB clock so timezone cannot skew it.
 */
export const biometricFreshness = (ctx: InsightContext) =>
  once(ctx, "freshness", async (): Promise<BiometricFreshness> => {
    const [daily, raw, wm] = await Promise.all([
      rows(`SELECT DATE_FORMAT(MAX(updated_at),'%Y-%m-%d %H:%i') AS at, TIMESTAMPDIFF(MINUTE, MAX(updated_at), NOW()) AS lag_min,
                   DATE_FORMAT(MAX(activity_date),'%Y-%m-%d') AS latest FROM integration_biometric_daily WHERE activity_date >= DATE_SUB(CURDATE(), INTERVAL 3 DAY)`),
      // The newest 20k rows by primary key: MAX(punch_time) over 3M rows is a full scan.
      rows(`SELECT DATE_FORMAT(MAX(punch_time),'%Y-%m-%d %H:%i') AS at, TIMESTAMPDIFF(MINUTE, MAX(punch_time), NOW()) AS lag_min
              FROM cosec_punch_sync WHERE id > (SELECT MAX(id) - 20000 FROM cosec_punch_sync)`),
      rows(`SELECT DATE_FORMAT(MAX(updated_at),'%Y-%m-%d %H:%i') AS at FROM cosec_sync_watermark`),
    ]);
    const h = (m: unknown) => { const v = num(m); return v === null ? null : round1(v / 60); };
    return {
      dailyFeedAt: (daily[0]?.at as string) ?? null, dailyFeedLagH: h(daily[0]?.lag_min), dailyFeedLatestDate: (daily[0]?.latest as string) ?? null,
      rawPunchAt: (raw[0]?.at as string) ?? null, rawPunchLagH: h(raw[0]?.lag_min), watermarkAt: (wm[0]?.at as string) ?? null,
    };
  });

/** Share of working roster rows that are published (null when there are none). */
export function publishPct(days: Array<{ total: number; published: number }>): number | null {
  const total = days.reduce((s, d) => s + d.total, 0);
  return ratio(days.reduce((s, d) => s + d.published, 0), total);
}

// ── slow-source cache ──────────────────────────────────────────────────────────────────────────────

const heavyStore = new Map<string, { at: number; value: unknown }>();
const heavyInflight = new Map<string, Promise<unknown>>();
const scopeKey = (ctx: InsightContext) =>
  `${ctx.scope.level}|${[...ctx.scope.branchIds].sort().join(",")}|${[...ctx.scope.processIds].sort().join(",")}|${[...ctx.scope.employeeIds].sort().join(",")}`;

/**
 * For a section whose source is slow on a cold buffer pool (the roster table is wide: ~2ms per row, 5.5k rows for a
 * week). The insights endpoint waits for its slowest section, so one 12s query would hold every tile hostage.
 * Fresh value: returned at once. Stale: returned at once and refreshed in the background. Nothing cached yet: wait up
 * to `waitMs`, then answer `warming` and let the load finish into the cache for the next request.
 */
export async function heavy<T>(ctx: InsightContext, key: string, ttlMs: number, waitMs: number, load: () => Promise<T>): Promise<{ value: T | null; warming: boolean }> {
  const k = `${key}|${ctx.today}|${scopeKey(ctx)}`;
  const hit = heavyStore.get(k);
  const start = () => {
    if (!heavyInflight.has(k)) {
      const p = load().then((v) => { heavyStore.set(k, { at: Date.now(), value: v }); return v; }).finally(() => heavyInflight.delete(k));
      p.catch(() => undefined);
      heavyInflight.set(k, p);
    }
    return heavyInflight.get(k) as Promise<T>;
  };
  if (hit) {
    if (Date.now() - hit.at > ttlMs) void start().catch(() => undefined);
    return { value: hit.value as T, warming: false };
  }
  const pending = start();
  const timer = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), waitMs));
  const first = await Promise.race([pending, timer]);
  return first === "timeout" ? { value: null, warming: true } : { value: first as T, warming: false };
}
