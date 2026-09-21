import { randomUUID } from "crypto";
import { db } from "../../db/mysql.js";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

/**
 * Reusable monthly-target read/write over the existing `dashboard_metric_target`
 * table (backend/sql/341_dashboard_targets.sql -- additive, already applied,
 * no migration needed here). Same shape as the Planned Capacity feature already
 * built for Bellavita Chat (bellavita-chat-overview.service.ts's loadCapacity/
 * setPlannedCapacity) -- this module is that same logic, generalised over any
 * (dashboardCode, metricCode) pair so Bellavita Cart and Bellavita Sale (and
 * anything else) can reuse it instead of re-implementing the same SQL.
 *
 * A target is "monthly": one row per calendar month, keyed by
 * (dashboard_code, metric_code, effective_from = 1st of that month). Setting
 * it again for the same month updates that row; a different month gets its
 * own row. branch_id/process_id are always NULL here (org-wide, not scoped).
 */

export interface MonthlyTargetChange {
  metricCode: string;
  month: string;
  oldValue: number | null;
  newValue: number;
}

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const p2 = (n: number): string => String(n).padStart(2, "0");
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function daysInMonth(ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** The single target in force for one metric in one month (the row whose
 * effective range covers the 1st of that month), or null if none is set. */
export async function loadMonthlyTarget(dashboardCode: string, metricCode: string, month: string): Promise<number | null> {
  const map = await loadMonthlyTargets(dashboardCode, [metricCode], [month]);
  return map.get(month)?.get(metricCode) ?? null;
}

/** Batch loader for several metric codes across several months in one query --
 * mirrors bellavita-chat-overview.service.ts's loadCapacity(). */
export async function loadMonthlyTargets(
  dashboardCode: string, metricCodes: string[], months: string[],
): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  for (const month of months) out.set(month, new Map());
  if (metricCodes.length === 0 || months.length === 0) return out;

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT metric_code, target_value,
            DATE_FORMAT(effective_from, '%Y-%m-%d') AS ef, DATE_FORMAT(effective_to, '%Y-%m-%d') AS et
       FROM dashboard_metric_target
      WHERE dashboard_code = ? AND target_period = 'monthly' AND branch_id IS NULL AND process_id IS NULL
        AND metric_code IN (${metricCodes.map(() => "?").join(",")})
      ORDER BY effective_from DESC`,
    [dashboardCode, ...metricCodes],
  );

  for (const month of months) {
    const first = `${month}-01`;
    const entry = out.get(month)!;
    for (const code of metricCodes) {
      const hit = rows.find((r) => r.metric_code === code && String(r.ef) <= first && (!r.et || String(r.et) >= first));
      if (hit) entry.set(code, num(hit.target_value));
    }
  }
  return out;
}

/** Sets one month's target for one metric. Updates the existing row for that
 * exact month if present, otherwise inserts a new one; the old value is
 * returned so the caller can audit it. */
export async function setMonthlyTarget(
  dashboardCode: string, metricCode: string, month: string, value: number, actorId: string,
): Promise<MonthlyTargetChange> {
  if (!MONTH_RE.test(month)) throw new Error("month must be YYYY-MM");
  if (!Number.isFinite(value) || value <= 0 || value > 1_000_000_000) throw new Error("target must be a positive number");
  const first = `${month}-01`;
  const last = `${month}-${p2(daysInMonth(month))}`;

  const [existing] = await db.execute<RowDataPacket[]>(
    `SELECT id, target_value FROM dashboard_metric_target
      WHERE dashboard_code = ? AND metric_code = ? AND target_period = 'monthly'
        AND branch_id IS NULL AND process_id IS NULL AND effective_from = ? LIMIT 1`,
    [dashboardCode, metricCode, first],
  );
  if (existing.length) {
    await db.execute<ResultSetHeader>(
      `UPDATE dashboard_metric_target SET target_value = ?, effective_to = ?, updated_at = NOW() WHERE id = ?`,
      [value, last, existing[0].id],
    );
    return { metricCode, month, oldValue: num(existing[0].target_value), newValue: value };
  }
  await db.execute<ResultSetHeader>(
    `INSERT INTO dashboard_metric_target
       (id, metric_code, dashboard_code, branch_id, process_id, target_value, target_period,
        effective_from, effective_to, created_by, created_at, updated_at)
     VALUES (?, ?, ?, NULL, NULL, ?, 'monthly', ?, ?, ?, NOW(), NOW())`,
    [randomUUID(), metricCode, dashboardCode, value, first, last, actorId],
  );
  return { metricCode, month, oldValue: null, newValue: value };
}

/** Roles allowed to set a monthly target -- a business commitment, same
 * narrow set the Bellavita Chat planned-capacity feature already uses. */
export const TARGET_ADMIN_ROLES = ["super_admin", "admin", "ceo", "coo", "management"] as const;

/* ------------------------------- daily targets ------------------------------ */
/** Same table, `target_period = 'daily'` instead of 'monthly' -- one row per
 * calendar DATE (effective_from = effective_to = that date), for a target
 * that genuinely varies day to day rather than one figure spread evenly
 * across a month. */

export interface DailyTargetChange {
  metricCode: string;
  date: string;
  oldValue: number | null;
  newValue: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Batch loader for several dates in one query. */
export async function loadDailyTargets(dashboardCode: string, metricCode: string, dates: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (dates.length === 0) return out;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(effective_from, '%Y-%m-%d') AS d, target_value
       FROM dashboard_metric_target
      WHERE dashboard_code = ? AND metric_code = ? AND target_period = 'daily'
        AND branch_id IS NULL AND process_id IS NULL
        AND effective_from IN (${dates.map(() => "?").join(",")})`,
    [dashboardCode, metricCode, ...dates],
  );
  for (const r of rows) out.set(String(r.d), num(r.target_value));
  return out;
}

/** Sets one date's target for one metric. Updates the existing row for that
 * exact date if present, otherwise inserts a new one. */
export async function setDailyTarget(
  dashboardCode: string, metricCode: string, date: string, value: number, actorId: string,
): Promise<DailyTargetChange> {
  if (!DATE_RE.test(date)) throw new Error("date must be YYYY-MM-DD");
  if (!Number.isFinite(value) || value < 0 || value > 1_000_000_000) throw new Error("target must be a non-negative number");

  const [existing] = await db.execute<RowDataPacket[]>(
    `SELECT id, target_value FROM dashboard_metric_target
      WHERE dashboard_code = ? AND metric_code = ? AND target_period = 'daily'
        AND branch_id IS NULL AND process_id IS NULL AND effective_from = ? LIMIT 1`,
    [dashboardCode, metricCode, date],
  );
  if (existing.length) {
    await db.execute<ResultSetHeader>(
      `UPDATE dashboard_metric_target SET target_value = ?, updated_at = NOW() WHERE id = ?`,
      [value, existing[0].id],
    );
    return { metricCode, date, oldValue: num(existing[0].target_value), newValue: value };
  }
  await db.execute<ResultSetHeader>(
    `INSERT INTO dashboard_metric_target
       (id, metric_code, dashboard_code, branch_id, process_id, target_value, target_period,
        effective_from, effective_to, created_by, created_at, updated_at)
     VALUES (?, ?, ?, NULL, NULL, ?, 'daily', ?, ?, ?, NOW(), NOW())`,
    [randomUUID(), metricCode, dashboardCode, value, date, date, actorId],
  );
  return { metricCode, date, oldValue: null, newValue: value };
}

/** Sets several dates' targets in one call (the "upload" path) -- sequential
 * upserts via setDailyTarget, each individually valid/auditable. Small row
 * counts (a month's worth of dates at most), so no batching optimisation. */
export async function setDailyTargetsBulk(
  dashboardCode: string, metricCode: string, rows: Array<{ date: string; value: number }>, actorId: string,
): Promise<DailyTargetChange[]> {
  const changes: DailyTargetChange[] = [];
  for (const r of rows) changes.push(await setDailyTarget(dashboardCode, metricCode, r.date, r.value, actorId));
  return changes;
}

/* --------------------------- span targets (mixed) --------------------------- */
/** A target over an arbitrary date range, preferring a real per-day value
 * where one has been set (e.g. uploaded from a Date/Conv Tgt%/Allocation
 * sheet) and falling back to that day's monthly target spread evenly across
 * the days in its month where no daily value exists -- the same "a month's
 * figure covers the whole month; a narrower period gets its days' share"
 * convention already used for Bellavita Chat's planned capacity, just now
 * overridable per day. */

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${p2(t.getUTCMonth() + 1)}-${p2(t.getUTCDate())}`;
}
export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export interface SpanTargetContext {
  dailyByDate: Map<string, number>;
  monthlyByMonth: Map<string, number>;
}

/** Loads every daily and monthly target row this set of dates could possibly
 * need, in 2 queries total -- callers then derive as many spans/columns as
 * they like from the same context with no further DB round-trips (used by
 * the Snapshot tab's MTD/week/day columns). */
export async function loadSpanTargetContext(dashboardCode: string, metricCode: string, dates: string[]): Promise<SpanTargetContext> {
  const uniqueDates = [...new Set(dates)];
  const months = [...new Set(uniqueDates.map((d) => d.slice(0, 7)))];
  const [dailyByDate, monthlyMap] = await Promise.all([
    loadDailyTargets(dashboardCode, metricCode, uniqueDates),
    loadMonthlyTargets(dashboardCode, [metricCode], months),
  ]);
  const monthlyByMonth = new Map<string, number>();
  for (const m of months) {
    const v = monthlyMap.get(m)?.get(metricCode);
    if (v !== undefined) monthlyByMonth.set(m, v);
  }
  return { dailyByDate, monthlyByMonth };
}

/** One day's target: the real daily value if set, else that day's month's
 * monthly target / days in that month, else null (nothing set either way). */
export function dayTargetFrom(ctx: SpanTargetContext, date: string): number | null {
  const daily = ctx.dailyByDate.get(date);
  if (daily !== undefined) return daily;
  const month = date.slice(0, 7);
  const monthly = ctx.monthlyByMonth.get(month);
  return monthly === undefined ? null : monthly / daysInMonth(month);
}

/** A span's target: the sum of every day's target in it. null only when NOT
 * ONE day in the span has a target set (daily or monthly) -- a span that's
 * partially covered still returns the real partial sum, not null, so an
 * uploaded daily sheet that doesn't yet cover the whole range is reflected
 * honestly rather than hidden. */
export function spanTarget(ctx: SpanTargetContext, dates: string[]): number | null {
  let sum = 0;
  let any = false;
  for (const d of dates) {
    const t = dayTargetFrom(ctx, d);
    if (t !== null) { sum += t; any = true; }
  }
  return any ? Math.round(sum) : null;
}
