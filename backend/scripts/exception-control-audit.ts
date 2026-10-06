/**
 * Exception Control audit. READ-ONLY.
 *
 * 1. employee_attendance_exception_bucket: every row, plus the employee's attendance logic
 *    (APR vs COSEC) and the last 10 attendance_daily_records, so a login-hours exception that
 *    never fires (APR employee, wrong threshold, inactive row) is visible.
 * 2. payroll_payable_days_override: every row, with the payroll line(s) for the same month so
 *    "override set, line ignored it" is visible (final_payable_days vs payable_days).
 *
 *   npx tsx scripts/exception-control-audit.ts
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import type { RowDataPacket } from "mysql2";

const q = async (sql: string, p: unknown[] = []) => (await db.execute<RowDataPacket[]>(sql, p))[0];

(async () => {
  console.log("\n== attendance exception bucket (all rows) ==");
  const bucket = await q(
    `SELECT b.employee_id, e.employee_code, e.employment_status, b.single_punch_counts_as_present any_punch,
            b.full_day_threshold_minutes thr, b.active_status act,
            DATE_FORMAT(b.created_at,'%Y-%m-%d %H:%i') created, DATE_FORMAT(b.updated_at,'%Y-%m-%d %H:%i') updated,
            DATE_FORMAT(b.deactivated_at,'%Y-%m-%d %H:%i') deactivated, LEFT(b.reason,60) reason
       FROM employee_attendance_exception_bucket b
       LEFT JOIN employees e ON e.id = b.employee_id
      ORDER BY b.created_at`);
  console.table(bucket);

  for (const b of bucket as any[]) {
    console.log(`\n-- last attendance rows for ${b.employee_code} (bucket act=${b.act} thr=${b.thr} any_punch=${b.any_punch})`);
    console.table(await q(
      `SELECT DATE_FORMAT(attendance_date,'%Y-%m-%d') d, attendance_status st, attendance_source src, source_system,
              raw_minutes, biometric_minutes, dialler_minutes, lwp_value, is_locked, override_by IS NOT NULL ovr,
              DATE_FORMAT(processed_at,'%m-%d %H:%i') processed
         FROM attendance_daily_records WHERE employee_id = ? ORDER BY attendance_date DESC LIMIT 10`, [b.employee_id]));
  }

  console.log("\n== payable days overrides (all rows) ==");
  const ov = await q(
    `SELECT o.employee_id, e.employee_code, o.run_month, o.payable_days, o.computed_days, o.active_status act,
            DATE_FORMAT(o.created_at,'%Y-%m-%d %H:%i') created, DATE_FORMAT(o.revoked_at,'%Y-%m-%d %H:%i') revoked,
            LEFT(o.reason,50) reason
       FROM payroll_payable_days_override o LEFT JOIN employees e ON e.id = o.employee_id
      ORDER BY o.created_at DESC`);
  console.table(ov);

  console.log("\n== payroll lines for overridden employee-months ==");
  for (const o of ov as any[]) {
    const lines = await q(
      `SELECT l.run_id, r.run_month, r.status run_status, l.final_payable_days, l.paid_working_days,
              l.eligible_weekoff_days, l.eligible_holiday_days, l.active_calendar_days, l.status,
              l.manual_override_locked locked, DATE_FORMAT(l.updated_at,'%m-%d %H:%i') updated
         FROM salary_prep_line l JOIN salary_prep_run r ON r.id = l.run_id
        WHERE l.employee_id = ? AND r.run_month = ?`, [o.employee_id, o.run_month]).catch(async () =>
      q(`SELECT l.run_id, r.run_month, r.status run_status, l.final_payable_days, l.paid_working_days,
                l.active_calendar_days, l.status
           FROM salary_prep_line l JOIN salary_prep_run r ON r.id = l.run_id
          WHERE l.employee_id = ? AND r.run_month = ?`, [o.employee_id, o.run_month]));
    console.log(`${o.employee_code} ${o.run_month} override=${o.payable_days} act=${o.act}`);
    console.table(lines);
  }

  console.log("\n== audit log for exception actions (last 60) ==");
  console.table(await q(
    `SELECT DATE_FORMAT(created_at,'%Y-%m-%d %H:%i') at, action_type, entity_type, LEFT(entity_id,8) ent, LEFT(COALESCE(reason,''),50) reason
       FROM sensitive_action_log
      WHERE action_type LIKE 'PAYABLE_DAYS_OVERRIDE%' OR action_type LIKE '%EXCEPTION_BUCKET%' OR entity_type LIKE '%exception_bucket%'
      ORDER BY created_at DESC LIMIT 60`).catch((e) => [{ error: String(e.message) }]));

  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
