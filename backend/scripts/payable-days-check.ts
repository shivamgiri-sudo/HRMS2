/**
 * Payable-days override check. READ-ONLY.
 * Lists every payroll_payable_days_override row, looks up named employees, and shows the
 * September payroll run, whether each overridden employee has a line in it, and what that line pays.
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import type { RowDataPacket } from "mysql2";

const q = async (sql: string, p: unknown[] = []) => (await db.execute<RowDataPacket[]>(sql, p))[0];
const NAMES = ["Deepak%Kashyap", "Ashwani%Wadhwa"];

(async () => {
  console.log("== all overrides ==");
  const ov = await q(
    `SELECT e.employee_code code, CONCAT_WS(' ', e.first_name, e.last_name) nm, o.run_month, o.payable_days days,
            o.active_status act, DATE_FORMAT(o.created_at,'%m-%d %H:%i') created, DATE_FORMAT(o.revoked_at,'%m-%d %H:%i') revoked
       FROM payroll_payable_days_override o JOIN employees e ON e.id = o.employee_id ORDER BY o.created_at`);
  console.table(ov);

  console.log("== named employees ==");
  const emps = await q(
    `SELECT e.id, e.employee_code code, CONCAT_WS(' ', e.first_name, e.last_name) nm, e.employment_status st,
            DATE_FORMAT(e.salary_start_date,'%Y-%m-%d') sal_start, DATE_FORMAT(e.date_of_joining,'%Y-%m-%d') doj
       FROM employees e WHERE CONCAT_WS(' ', e.first_name, e.last_name) LIKE ? OR CONCAT_WS(' ', e.first_name, e.last_name) LIKE ?`, NAMES);
  console.table(emps.map(({ id, ...r }: any) => r));
  for (const e of emps as any[]) {
    console.log(`-- ${e.code} overrides (any month)`);
    console.table(await q(`SELECT run_month, payable_days, active_status, DATE_FORMAT(created_at,'%m-%d %H:%i') created FROM payroll_payable_days_override WHERE employee_id = ?`, [e.id]));
  }

  console.log("== recent payroll runs ==");
  console.table(await q(
    `SELECT r.run_month, r.status, DATE_FORMAT(r.created_at,'%m-%d %H:%i') created, DATE_FORMAT(r.updated_at,'%m-%d %H:%i') updated,
            (SELECT COUNT(*) FROM salary_prep_line l WHERE l.run_id = r.id) n_lines
       FROM salary_prep_run r ORDER BY r.created_at DESC LIMIT 8`).catch((x) => [{ error: String(x.message) }]));

  console.log("== lines for overridden / named employees (all runs) ==");
  const ids = [...new Set([...(await q(`SELECT employee_id id FROM payroll_payable_days_override WHERE active_status = 1`)).map((r: any) => r.id), ...(emps as any[]).map((e) => e.id)])];
  if (ids.length) {
    console.table(await q(
      `SELECT e.employee_code code, r.run_month, r.status run_status, l.final_payable_days fin, l.paid_working_days paid,
              l.active_calendar_days act_cal, l.status line_status, DATE_FORMAT(l.updated_at,'%m-%d %H:%i') updated
         FROM salary_prep_line l JOIN salary_prep_run r ON r.id = l.run_id JOIN employees e ON e.id = l.employee_id
        WHERE l.employee_id IN (${ids.map(() => "?").join(",")}) ORDER BY e.employee_code, r.run_month`, ids));
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
