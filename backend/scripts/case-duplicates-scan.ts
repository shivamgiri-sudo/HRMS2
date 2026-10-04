/**
 * Read-only scan for records that are the SAME value written in a different letter case
 * (62516C / 62516c) and so are treated as different by a case-sensitive comparison. SELECTs only.
 *
 *   npx tsx scripts/case-duplicates-scan.ts
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import type { RowDataPacket } from "mysql2";

const q = async (sql: string, p: unknown[] = []) => (await db.execute<RowDataPacket[]>(sql, p))[0];
const section = async (title: string, sql: string) => {
  console.log(`\n== ${title} ==`);
  try { const r = await q(sql); console.log(`rows: ${r.length}`); if (r.length) console.table(r.slice(0, 50)); }
  catch (e) { console.log("query failed:", (e as Error).message); }
};

(async () => {
  await section("employees: two rows whose code differs only by case / whitespace",
    `SELECT UPPER(TRIM(employee_code)) code, COUNT(*) n, GROUP_CONCAT(employee_code) spellings, GROUP_CONCAT(active_status) active
       FROM employees GROUP BY UPPER(TRIM(employee_code)) HAVING COUNT(*) > 1`);

  await section("employees: stored code is not already trimmed UPPER-case",
    `SELECT employee_code, active_status FROM employees
      WHERE BINARY employee_code <> BINARY UPPER(TRIM(employee_code)) LIMIT 50`);

  await section("incentive lines: code spelled differently from the employee's own code",
    `SELECT l.employee_code line_code, e.employee_code emp_code, COUNT(*) n, SUM(l.amount) amt
       FROM incentive_upload_line l JOIN employees e ON e.id = l.employee_id
      WHERE BINARY l.employee_code <> BINARY e.employee_code GROUP BY l.employee_code, e.employee_code LIMIT 50`);

  await section("incentive lines: same code (any case) + month + TYPE + amount in more than one approved batch",
    `SELECT UPPER(TRIM(l.employee_code)) code, b.pay_month, l.incentive_code, l.amount, COUNT(*) n,
            GROUP_CONCAT(b.batch_ref SEPARATOR ' | ') batches
       FROM incentive_upload_line l JOIN incentive_upload_batch b ON b.id = l.batch_id
      WHERE b.status IN ('approved','applied')
      GROUP BY UPPER(TRIM(l.employee_code)), b.pay_month, l.incentive_code, l.amount HAVING COUNT(*) > 1 LIMIT 50`);

  await section("incentive lines: one code (any case) split across two employee_ids",
    `SELECT UPPER(TRIM(employee_code)) code, COUNT(DISTINCT employee_id) ids FROM incentive_upload_line
      GROUP BY UPPER(TRIM(employee_code)) HAVING COUNT(DISTINCT employee_id) > 1 LIMIT 50`);

  await section("active loans: same code (any case) + amount + start + EMI more than once",
    `SELECT UPPER(TRIM(employee_code)) code, amount, start_date, deduction_per_month, COUNT(*) n, GROUP_CONCAT(id) ids
       FROM employee_loans WHERE status = 'active'
      GROUP BY UPPER(TRIM(employee_code)), amount, start_date, deduction_per_month HAVING COUNT(*) > 1`);

  await section("loans: one code (any case) split across two employee_ids",
    `SELECT UPPER(TRIM(employee_code)) code, COUNT(DISTINCT employee_id) ids FROM employee_loans
      GROUP BY UPPER(TRIM(employee_code)) HAVING COUNT(DISTINCT employee_id) > 1 LIMIT 50`);

  await section("salary prep lines: same code (any case) twice in one run",
    `SELECT run_id, UPPER(TRIM(employee_code)) code, COUNT(*) n FROM salary_prep_line
      GROUP BY run_id, UPPER(TRIM(employee_code)) HAVING COUNT(*) > 1 LIMIT 50`);

  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
