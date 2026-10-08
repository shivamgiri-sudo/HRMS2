/**
 * Running-salary diagnosis for one employee. READ-ONLY (SELECTs plus the pure
 * computeRunningSalary calculation, which writes nothing).
 *
 *   npx tsx scripts/running-salary-diagnose.ts [employee_code]
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { computeRunningSalary } from "../src/modules/payroll/running-salary.service.js";
import type { RowDataPacket } from "mysql2";

const CODE = process.argv[2] ?? "MAS47814";
const q = async (sql: string, p: unknown[] = []) => (await db.execute<RowDataPacket[]>(sql, p))[0];

(async () => {
  const [emp] = await q(
    `SELECT id, employee_code, DATE_FORMAT(date_of_joining,'%Y-%m-%d') doj, active_status, branch_id, process_id
       FROM employees WHERE employee_code = ?`, [CODE]);
  if (!emp) { console.log("employee not found"); process.exit(0); }
  console.log("== employee =="); console.log(JSON.stringify(emp));
  const id = String(emp.id);

  const ist = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const runMonth = `${ist.slice(0, 7)}-01`;
  console.log(`\n== as of ${ist}, run month ${runMonth} ==`);

  console.log("\n== salary_component_assignments ==");
  console.table(await q(
    `SELECT basic, hra, conveyance, special_allowance, gross, status, effective_date
       FROM salary_component_assignments WHERE employee_id = ? ORDER BY effective_date DESC LIMIT 5`, [id]));
  console.log("== employee_salary_assignment ==");
  console.table(await q(
    `SELECT ctc_annual, structure_id, active_status FROM employee_salary_assignment WHERE employee_id = ?`, [id]));

  console.log("== attendance this month (counts by status/source) ==");
  console.table(await q(
    `SELECT attendance_status, attendance_source, source_system, COUNT(*) n, SUM(lwp_value) lwp
       FROM attendance_daily_record
      WHERE employee_id = ? AND DATE(CONVERT_TZ(record_date,'+00:00','+05:30')) BETWEEN ? AND ?
      GROUP BY attendance_status, attendance_source, source_system`, [id, runMonth, ist]));
  console.log("== attendance per day ==");
  console.table(await q(
    `SELECT DATE(CONVERT_TZ(record_date,'+00:00','+05:30')) d, attendance_status, lwp_value, source_system
       FROM attendance_daily_record
      WHERE employee_id = ? AND DATE(CONVERT_TZ(record_date,'+00:00','+05:30')) BETWEEN ? AND ?
      ORDER BY d`, [id, runMonth, ist]));

  console.log("== computeRunningSalary ==");
  console.log(JSON.stringify(await computeRunningSalary(id, runMonth), null, 2));

  console.log("\n== recurring deductions that reduce net ==");
  console.table(await q(`SELECT 'advance' k, COALESCE(SUM(ROUND(amount/recovery_months,2)),0) v FROM salary_advance_log WHERE employee_id=? AND status='active'`, [id]));
  console.table(await q(`SELECT 'loan_emi' k, COALESCE(SUM(deduction_per_month),0) v FROM employee_loans WHERE employee_id=? AND status='active'`, [id]));
  console.log("== every employee_loans row for this employee ==");
  console.table(await q(`SELECT * FROM employee_loans WHERE employee_id = ? ORDER BY start_date`, [id]));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
