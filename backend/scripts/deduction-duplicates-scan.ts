/**
 * Read-only scan for double-counted payroll inputs. SELECTs only.
 *
 *   npx tsx scripts/deduction-duplicates-scan.ts
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import type { RowDataPacket } from "mysql2";

const q = async (sql: string, p: unknown[] = []) => (await db.execute<RowDataPacket[]>(sql, p))[0];
const section = async (title: string, sql: string) => {
  console.log(`\n== ${title} ==`);
  try { const r = await q(sql); console.log(`rows: ${r.length}`); if (r.length) console.table(r.slice(0, 40)); }
  catch (e) { console.log("query failed:", (e as Error).message); }
};

(async () => {
  await section("active loans: same employee + amount + start_date + EMI more than once (any origin)",
    `SELECT employee_code, amount, start_date, deduction_per_month, COUNT(*) n,
            GROUP_CONCAT(id) ids, GROUP_CONCAT(COALESCE(legacy_loan_id,'-')) legacy_ids
       FROM employee_loans WHERE status = 'active'
      GROUP BY employee_id, employee_code, amount, start_date, deduction_per_month HAVING COUNT(*) > 1`);

  await section("active loans with deductions that exceed the loan, or pending below zero",
    `SELECT employee_code, id, amount, deducted_amount, pending_amount, deduction_per_month
       FROM employee_loans WHERE status = 'active' AND (deducted_amount > amount OR pending_amount < 0)`);

  await section("employees whose total active loan EMI is above 40% of their active gross",
    `SELECT l.employee_code, SUM(l.deduction_per_month) emi, MAX(s.gross) gross
       FROM employee_loans l
       JOIN salary_component_assignments s ON s.employee_id = l.employee_id AND s.status = 'active'
      WHERE l.status = 'active'
      GROUP BY l.employee_id, l.employee_code
     HAVING SUM(l.deduction_per_month) > 0.4 * MAX(s.gross)`);

  await section("active salary advances: same employee + amount + recovery_months more than once",
    `SELECT employee_id, amount, recovery_months, COUNT(*) n, GROUP_CONCAT(id) ids
       FROM salary_advance_log WHERE status = 'active'
      GROUP BY employee_id, amount, recovery_months HAVING COUNT(*) > 1`);

  await section("employees with more than one ACTIVE salary_component_assignments row",
    `SELECT employee_id, COUNT(*) n FROM salary_component_assignments WHERE status = 'active'
      GROUP BY employee_id HAVING COUNT(*) > 1`);

  await section("employees with more than one ACTIVE employee_salary_assignment row",
    `SELECT employee_id, COUNT(*) n FROM employee_salary_assignment WHERE active_status = 1
      GROUP BY employee_id HAVING COUNT(*) > 1`);

  await section("approved incentive lines: same employee + month + amount more than once",
    `SELECT iul.employee_id, ibu.pay_month, iul.amount, COUNT(*) n
       FROM incentive_upload_line iul JOIN incentive_upload_batch ibu ON ibu.id = iul.batch_id
      WHERE ibu.status = 'approved'
      GROUP BY iul.employee_id, ibu.pay_month, iul.amount HAVING COUNT(*) > 1 LIMIT 40`);

  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
