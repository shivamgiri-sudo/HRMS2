/**
 * Zero-payable-day lines that still carry a gross. STRICTLY READ-ONLY (SELECT only).
 *
 * Aug 2026 had 11 salary_prep_line rows (future joiners, DOJ in September) showing a full gross
 * (e.g. 16,300) with 0 days and net 0. This lists, per such line, which gross columns hold the
 * amount, the days columns, the joining date and the line status, so the writer can be found.
 * Output is employee_code only. Takes no write flags.
 *
 *   npx tsx scripts/zero-day-gross-audit.ts [YYYY-MM]
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";

const MONTH = process.argv.find((a) => /^\d{4}-\d{2}$/.test(a)) ?? "2026-08";

async function main() {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.employee_code, e.date_of_joining, spl.status,
            spl.gross_salary, spl.gross_before_lwp, spl.net_salary, spl.total_deductions,
            spl.final_payable_days, spl.paid_working_days, spl.present_days, spl.eligible_holiday_days,
            spl.eligible_weekoff_days, spl.basic, spl.hra, spl.special_allowance, spl.calculation_version
       FROM salary_prep_line spl
       JOIN salary_prep_run spr ON spr.id = spl.run_id
       JOIN employees e ON e.id = spl.employee_id
      WHERE spr.run_month = ?
        AND COALESCE(spl.final_payable_days, 0) = 0
        AND (spl.gross_salary > 0 OR spl.gross_before_lwp > 0 OR spl.basic > 0)
      ORDER BY e.employee_code
      LIMIT 100`,
    [MONTH],
  );
  console.log(`zero-payable-day lines with a gross, run ${MONTH}: ${(rows as any[]).length}`);
  console.table(rows);

  const [comp] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT c.line_id) AS lines_with_components, COALESCE(SUM(c.amount),0) AS total
       FROM salary_prep_line_component c
       JOIN salary_prep_line spl ON spl.id = c.line_id
       JOIN salary_prep_run spr ON spr.id = spl.run_id
      WHERE spr.run_month = ? AND COALESCE(spl.final_payable_days, 0) = 0`,
    [MONTH],
  ).catch((e) => [[{ note: `component query skipped: ${e.message}` }]] as any);
  console.table(comp);
}

main().then(() => db.end?.()).catch(async (e) => { console.error("ERR", e?.message ?? e); try { await db.end?.(); } catch { } process.exit(1); });
