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

  const active = (bucket as any[]).filter((b) => Number(b.act) === 1);
  const ids = active.map((b) => b.employee_id);
  const ph = ids.map(() => "?").join(",");

  console.log("\n== PER-EMPLOYEE summary since 2026-09-01 (every active bucketed employee) ==");
  console.table(await q(
    `SELECT e.employee_code code, b.full_day_threshold_minutes thr, b.single_punch_counts_as_present anyp,
            COUNT(*) days, SUM(a.attendance_status='present') pres, SUM(a.attendance_status='half_day') half,
            SUM(a.attendance_status='absent') abs_, SUM(a.attendance_status='missing_punch') miss,
            SUM(a.attendance_status IN ('week_off','holiday','leave')) off,
            SUM(a.source_system LIKE 'cosec%exception') exc_rows,
            SUM(a.attendance_source='dialler') dial, SUM(a.attendance_source='biometric') bio,
            SUM(a.is_locked=1) lk, SUM(a.override_by IS NOT NULL) ovr,
            SUM(a.raw_minutes>=480 AND a.raw_minutes<540 AND a.attendance_status<>'present') missed_480,
            DATE_FORMAT(MAX(a.record_date),'%m-%d') last_day
       FROM employee_attendance_exception_bucket b
       JOIN employees e ON e.id=b.employee_id
       LEFT JOIN attendance_daily_record a ON a.employee_id=b.employee_id AND a.record_date>='2026-09-01'
      WHERE b.active_status=1 GROUP BY e.employee_code, b.full_day_threshold_minutes, b.single_punch_counts_as_present
      ORDER BY e.employee_code`));

  console.log("\n== per-day mix for active bucketed employees ==");
  console.table(await q(
    `SELECT DATE_FORMAT(record_date,'%m-%d') d, COUNT(*) n, SUM(attendance_status='present') pres,
            SUM(attendance_status='half_day') half, SUM(attendance_status='absent') abs_,
            SUM(attendance_status='missing_punch') miss, SUM(source_system LIKE 'cosec%exception') exc,
            SUM(attendance_source='dialler') dial, SUM(is_locked=1) lk
       FROM attendance_daily_record WHERE employee_id IN (${ph}) AND record_date >= '2026-09-01'
      GROUP BY record_date ORDER BY record_date`, ids));

  console.log("\n== source_system / created_by mix (which writer produced the rows) ==");
  console.table(await q(
    `SELECT attendance_source src, source_system, created_by, attendance_status st, COUNT(*) n,
            DATE_FORMAT(MIN(record_date),'%m-%d') mn, DATE_FORMAT(MAX(record_date),'%m-%d') mx
       FROM attendance_daily_record WHERE employee_id IN (${ph}) AND record_date >= '2026-09-01'
      GROUP BY src, source_system, created_by, st ORDER BY n DESC LIMIT 80`, ids));

  console.log("\n== full detail, head-office (MAS) bucketed employees ==");
  for (const b of active.filter((x) => String(x.employee_code).startsWith("MAS"))) {
    console.log(`\n-- ${b.employee_code} thr=${b.thr} anyp=${b.any_punch} (${b.reason})`);
    console.table(await q(
      `SELECT DATE_FORMAT(record_date,'%m-%d') d, attendance_status st, attendance_source src, source_system,
              raw_minutes raw, biometric_minutes bio, dialler_minutes dial, lwp_value lwp, is_locked lk,
              override_by IS NOT NULL ovr, created_by, DATE_FORMAT(processed_at,'%m-%d %H:%i') processed
         FROM attendance_daily_record WHERE employee_id = ? AND record_date >= '2026-09-01' ORDER BY record_date`, [b.employee_id]));
  }

  console.log("\n== full detail, 3 GPI samples ==");
  for (const b of active.filter((x) => !String(x.employee_code).startsWith("MAS")).slice(0, 3)) {
    console.log(`\n-- ${b.employee_code}`);
    console.table(await q(
      `SELECT DATE_FORMAT(record_date,'%m-%d') d, attendance_status st, attendance_source src, source_system,
              raw_minutes raw, biometric_minutes bio, dialler_minutes dial, lwp_value lwp, is_locked lk,
              created_by, DATE_FORMAT(processed_at,'%m-%d %H:%i') processed
         FROM attendance_daily_record WHERE employee_id = ? AND record_date >= '2026-09-01' ORDER BY record_date`, [b.employee_id]));
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
