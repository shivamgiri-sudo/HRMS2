import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * The month a payroll report should show when the caller does not name one.
 *
 * Every payroll and statutory report defaulted to `new Date()`. Payroll is closed monthly and
 * always in arrears, so for most of any given month there is no run for "this month" yet —
 * opening one of these from the report library on 2026-08-08 filtered on 2026-08, matched no
 * run, and drew an empty grid. Measured on live: twelve reachable reports returned 0 rows with
 * no parameters and full data for `month=2026-07`, one shared cause.
 *
 * An empty grid is indistinguishable from "payroll ran and produced nothing", which is why
 * this sat unnoticed. The fix is to default to the latest month that actually has payroll.
 *
 * Deliberately NOT applied to `monthParam` itself. Attendance, leave and roster reports
 * resolve a month too and for them today is the right answer — attendance_daily_record has
 * rows through today. Rewinding those would be a silent regression in the opposite direction.
 * Only blocks that filter salary_prep_run.run_month use this.
 */

/**
 * Two payroll sources with different latest months, so the default has to follow the source
 * the report actually reads. `salary_prep_run` is current through 2026-07;
 * `legacy_payslip_snapshot` stops at 2026-06. Defaulting the arrears register — which reads
 * the legacy table — to 2026-07 would leave it as empty as it started.
 */
export type PayrollMonthSource = "run" | "legacy";

const SOURCE_SQL: Record<PayrollMonthSource, string> = {
  // Matches the status filter the payroll reports themselves apply, so the default cannot
  // land on a month they would then exclude.
  run: `
    SELECT MAX(r.run_month) AS month
      FROM salary_prep_run r
     WHERE LOWER(COALESCE(r.status,'')) NOT IN ('draft','cancelled')
       AND EXISTS (SELECT 1 FROM salary_prep_line l WHERE l.run_id = r.id)`,
  legacy: `SELECT MAX(pay_month) AS month FROM legacy_payslip_snapshot`,
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<PayrollMonthSource, { month: string; at: number }>();

/** Test seam — clears the memoised months. */
export function __resetPayrollMonthCache(): void {
  cache.clear();
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * The latest month with a usable payroll run, memoised for five minutes.
 *
 * A run is added once a month, so a five-minute window cannot show a stale month for long,
 * and it keeps this off the hot path of every payroll request.
 */
export async function latestPayrollMonth(source: PayrollMonthSource = "run"): Promise<string> {
  const hit = cache.get(source);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.month;
  try {
    const [rows] = await db.execute<RowDataPacket[]>(SOURCE_SQL[source]);
    const month = rows[0]?.month as string | null | undefined;
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      cache.set(source, { month, at: Date.now() });
      return month;
    }
    // No usable run anywhere. Falling back to today is honest here: there is no payroll month
    // to prefer, and the report will be empty whichever month it picks.
    return currentMonth();
  } catch (err) {
    // Degrade to the previous behaviour rather than failing the report, but say so — a silent
    // fallback is how the original defect stayed invisible.
    console.warn("[payroll-month] could not resolve the latest payroll month, falling back to the current month:", err);
    return currentMonth();
  }
}

/**
 * Resolve an explicit `month=YYYY-MM` if the caller gave one, otherwise the latest month with
 * payroll. An explicit month is always honoured exactly, including a month with no run — asking
 * for 2026-08 and being shown 2026-07 would be worse than an empty result.
 */
export async function resolvePayrollMonth(
  value: unknown,
  source: PayrollMonthSource = "run"
): Promise<string> {
  const text = String(value ?? "").trim();
  if (/^\d{4}-\d{2}$/.test(text)) return text;
  return latestPayrollMonth(source);
}
