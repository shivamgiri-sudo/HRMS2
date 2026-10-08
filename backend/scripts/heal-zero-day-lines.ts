/**
 * Heal salary_prep_line rows written by an older engine that carry a gross with 0 payable days.
 *
 *   npx tsx scripts/heal-zero-day-lines.ts [YYYY-MM]            # dry run (default): prints the plan, writes nothing
 *   npx tsx scripts/heal-zero-day-lines.ts [YYYY-MM] --apply    # write
 *
 * Targets: lines of the month's run with final_payable_days = 0 and a gross (gross_salary, gross_before_lwp or
 * basic > 0), on a run that is not closed.
 *   - Joined AFTER the run month ends, net 0, no acknowledged payslip: the employee does not belong in the
 *     run. The line is removed, exactly what a full recalculation's stale-line purge does.
 *   - Everyone else: recalculated with the current engine, scoped to those employees only.
 * Nothing outside the target list is touched. Re-running is a no-op once healed.
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db, closePool } from "../src/db/mysql.js";
import { closeBillPool } from "../src/db/billDb.js";
import { calculatePayrollRunScoped } from "../src/modules/payroll/payrollCalculate.service.js";
import { isRunClosed } from "../src/modules/payroll/run-status.js";

const APPLY = process.argv.includes("--apply");
const MONTH = process.argv.find((a) => /^\d{4}-\d{2}$/.test(a)) ?? "2026-08";

async function main() {
  const [runs] = await db.execute<RowDataPacket[]>(`SELECT id, status FROM salary_prep_run WHERE run_month = ?`, [MONTH]);
  if ((runs as any[]).length !== 1) throw new Error(`expected exactly one run for ${MONTH}, found ${(runs as any[]).length}`);
  const run = (runs as any[])[0];
  if (isRunClosed(run.status)) throw new Error(`run ${run.id} is ${run.status}; closed runs are not touched`);

  const [monthEnd] = await db.execute<RowDataPacket[]>(`SELECT LAST_DAY(?) AS d`, [`${MONTH}-01`]);
  const lastDay = String((monthEnd as any[])[0].d.toISOString?.().slice(0, 10) ?? (monthEnd as any[])[0].d);

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT spl.id AS line_id, e.id AS employee_id, e.employee_code, e.date_of_joining,
            spl.gross_salary, spl.net_salary, sp.acknowledged_at
       FROM salary_prep_line spl
       JOIN employees e ON e.id = spl.employee_id
       LEFT JOIN salary_payslip sp ON sp.prep_line_id = spl.id
      WHERE spl.run_id = ?
        AND COALESCE(spl.final_payable_days, 0) = 0
        AND (spl.gross_salary > 0 OR spl.gross_before_lwp > 0 OR spl.basic > 0)`,
    [run.id],
  );
  const toRemove: any[] = [];
  const toRecalc: any[] = [];
  for (const r of rows as any[]) {
    const doj = r.date_of_joining ? new Date(r.date_of_joining).toISOString().slice(0, 10) : null;
    const notYetJoined = doj !== null && doj > lastDay;
    if (notYetJoined && Number(r.net_salary) === 0 && !r.acknowledged_at) toRemove.push(r);
    else toRecalc.push(r);
  }
  console.log(`${APPLY ? "APPLY" : "DRY RUN"} run ${run.id} (${MONTH}, ${run.status}): ${toRemove.length} to remove, ${toRecalc.length} to recalculate`);
  console.log("remove    :", toRemove.map((r) => r.employee_code).join(", ") || "-");
  console.log("recalc    :", toRecalc.map((r) => r.employee_code).join(", ") || "-");
  if (!APPLY) { console.log("Dry run complete. Re-run with --apply to write."); return; }

  if (toRemove.length) {
    await db.execute(`DELETE FROM salary_prep_line WHERE id IN (${toRemove.map(() => "?").join(",")})`, toRemove.map((r) => r.line_id));
    console.log(`removed ${toRemove.length} lines`);
  }
  if (toRecalc.length) {
    const res = await calculatePayrollRunScoped(run.id, "heal_zero_day_lines", { employeeIds: toRecalc.map((r) => r.employee_id) });
    console.log(`recalculated ${toRecalc.length} lines, run total_net ${res.total_net}`);
  }
  const [left] = await db.execute<RowDataPacket[]>(
    `SELECT e.employee_code, spl.gross_salary, spl.net_salary, spl.final_payable_days
       FROM salary_prep_line spl JOIN employees e ON e.id = spl.employee_id
      WHERE spl.run_id = ? AND COALESCE(spl.final_payable_days,0) = 0 AND spl.gross_salary > 0`, [run.id]);
  console.log(`remaining zero-day lines with a gross: ${(left as any[]).length}`);
  console.table(left);
}

main().then(async () => { await closeBillPool(); await closePool(); }).catch(async (e) => { console.error("ERR", e?.message ?? e); try { await closeBillPool(); await closePool(); } catch { } process.exit(1); });
