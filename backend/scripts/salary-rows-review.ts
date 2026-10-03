/**
 * Read-only review of (a) employees with 2+ active employee_salary_assignment rows and
 * (b) approved incentive lines repeated within one employee+month. SELECTs only.
 *
 *   npx tsx scripts/salary-rows-review.ts
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import type { RowDataPacket } from "mysql2";

const q = async (sql: string, p: unknown[] = []) => (await db.execute<RowDataPacket[]>(sql, p))[0];

(async () => {
  console.log("== (a) employees with 2+ ACTIVE employee_salary_assignment rows ==");
  console.table(await q(
    `SELECT e.employee_code, esa.id, esa.ctc_annual, esa.structure_id, esa.effective_from, esa.created_at,
            (SELECT s.gross FROM salary_component_assignments s WHERE s.employee_id = esa.employee_id
               AND s.status='active' ORDER BY s.effective_date DESC LIMIT 1) sca_gross
       FROM employee_salary_assignment esa JOIN employees e ON e.id = esa.employee_id
      WHERE esa.active_status = 1 AND esa.employee_id IN (
            SELECT employee_id FROM employee_salary_assignment WHERE active_status = 1
             GROUP BY employee_id HAVING COUNT(*) > 1)
      ORDER BY e.employee_code, esa.created_at`));

  console.log("== (b) repeated approved incentive lines (Aug 2026) ==");
  console.table(await q(
    `SELECT e.employee_code, ibu.pay_month, iul.amount, ibu.id batch_id, ibu.status, ibu.created_at batch_created, iul.id line_id
       FROM incentive_upload_line iul
       JOIN incentive_upload_batch ibu ON ibu.id = iul.batch_id
       JOIN employees e ON e.id = iul.employee_id
      WHERE ibu.status = 'approved' AND (iul.employee_id, ibu.pay_month, iul.amount) IN (
            SELECT iul2.employee_id, ibu2.pay_month, iul2.amount
              FROM incentive_upload_line iul2 JOIN incentive_upload_batch ibu2 ON ibu2.id = iul2.batch_id
             WHERE ibu2.status = 'approved'
             GROUP BY iul2.employee_id, ibu2.pay_month, iul2.amount HAVING COUNT(*) > 1)
      ORDER BY e.employee_code, ibu.created_at`));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
