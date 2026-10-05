/**
 * Attendance records dated AFTER an employee's resolved employment end date. READ-ONLY (SELECTs only).
 * Prints COUNTS ONLY grouped by writer / source / status - no employee codes or names.
 *
 *   npx tsx scripts/post-exit-attendance-audit.ts 2026-06-01
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { EMPLOYMENT_END_DATE_SELECT } from "../src/modules/payroll/employment-end-date.js";
import type { RowDataPacket } from "mysql2";

const FROM = process.argv[2] ?? "2026-06-01";

async function table(title: string, sql: string, params: unknown[] = []) {
  console.log(`== ${title} ==`);
  const [rows] = await db.query<RowDataPacket[]>(sql, params);
  for (const r of rows as any[]) console.log("  " + Object.entries(r).map(([k, v]) => `${k}=${v}`).join("  "));
}

(async () => {
  // One row per post-exit record, with the end date and where it came from.
  const base = `
    SELECT adr.record_date, adr.attendance_status, COALESCE(adr.source_system,'(null)') src,
           CASE WHEN adr.created_by IS NULL THEN '(null)' WHEN adr.created_by REGEXP '^[0-9a-f-]{36}$' THEN 'a user id' ELSE adr.created_by END writer,
           adr.is_locked, adr.override_by IS NOT NULL has_override, adr.regularization_id IS NOT NULL has_reg,
           adr.created_at, adr.updated_at, x.end_date, x.end_src, LOWER(COALESCE(x.employment_status,'')) emp_status,
           x.date_of_exit, x.lwd
      FROM attendance_daily_record adr
      JOIN (SELECT e.id, e.employment_status, DATE_FORMAT(e.date_of_exit,'%Y-%m-%d') date_of_exit,
                   ${EMPLOYMENT_END_DATE_SELECT} end_date,
                   (SELECT DATE_FORMAT(COALESCE(q.last_working_day_confirmed, q.last_working_day_proposed),'%Y-%m-%d') FROM exit_request q
                     WHERE q.employee_id = e.id AND LOWER(q.status) IN ('accepted','notice_serving','exited')
                     ORDER BY COALESCE(q.last_working_day_confirmed, q.last_working_day_proposed) DESC LIMIT 1) lwd,
                   CASE WHEN EXISTS(SELECT 1 FROM exit_request q WHERE q.employee_id = e.id AND LOWER(q.status) IN ('accepted','notice_serving','exited')) THEN 'exit_request'
                        WHEN e.date_of_exit IS NOT NULL THEN 'date_of_exit' ELSE 'date_of_leaving' END end_src
              FROM employees e) x ON x.id = adr.employee_id
     WHERE x.end_date IS NOT NULL AND adr.record_date > x.end_date AND adr.record_date >= ?`;

  await table("1. post-exit records by month and current employee status",
    `SELECT DATE_FORMAT(record_date,'%Y-%m') month, emp_status, COUNT(*) records, COUNT(DISTINCT CONCAT(end_date,'|',date_of_exit)) approx_people
       FROM (${base}) t GROUP BY month, emp_status ORDER BY month, emp_status`, [FROM]);
  await table("2. by writer (created_by) and source_system",
    `SELECT writer, src, COUNT(*) n FROM (${base}) t GROUP BY writer, src ORDER BY n DESC LIMIT 40`, [FROM]);
  await table("3. by attendance_status",
    `SELECT attendance_status, COUNT(*) n, SUM(is_locked) locked, SUM(has_override) overrides, SUM(has_reg) regularized FROM (${base}) t GROUP BY attendance_status ORDER BY n DESC`, [FROM]);
  await table("4. where the end date comes from, and whether employees.date_of_exit is set",
    `SELECT end_src, date_of_exit IS NULL AS date_of_exit_missing, COUNT(*) n FROM (${base}) t GROUP BY end_src, date_of_exit_missing`, [FROM]);
  await table("5. record written before or after the day it describes + how long after exit",
    `SELECT CASE WHEN DATE(created_at) <= end_date THEN 'created on/before end date (future-dated?)'
                 WHEN DATEDIFF(created_at, record_date) <= 2 THEN 'created within 2 days of the date (nightly/live)'
                 ELSE 'created later (backfill/heal/upload)' END how,
            CASE WHEN DATEDIFF(record_date, end_date) <= 7 THEN '1-7 days after exit'
                 WHEN DATEDIFF(record_date, end_date) <= 31 THEN '8-31 days' ELSE '>31 days' END gap,
            COUNT(*) n
       FROM (${base}) t GROUP BY how, gap ORDER BY how, gap`, [FROM]);
  await table("6. date_of_exit vs exit_request LWD disagree (both set)",
    `SELECT CASE WHEN lwd IS NULL OR date_of_exit IS NULL THEN 'one missing' WHEN lwd = date_of_exit THEN 'same' WHEN lwd < date_of_exit THEN 'LWD earlier' ELSE 'LWD later' END cmp, COUNT(*) n
       FROM (${base}) t GROUP BY cmp`, [FROM]);
  await table("7. employees with an end date who are still employment_status=active (all, not only with records)",
    `SELECT COUNT(*) n, SUM(end_date < CURDATE()) end_in_past FROM (
       SELECT LOWER(COALESCE(e.employment_status,'')) st, ${EMPLOYMENT_END_DATE_SELECT} end_date FROM employees e) z
      WHERE st = 'active' AND end_date IS NOT NULL`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
