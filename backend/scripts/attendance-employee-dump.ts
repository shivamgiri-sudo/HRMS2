// READ-ONLY. Dumps every layer of one employee's attendance for a date window so a
// night-shift / week-off / absent grading can be traced end to end:
//   raw punch sources -> biometric_attendance_log -> wfm_attendance_session
//   -> attendance_daily_record -> roster -> payroll line.
// Usage: npx tsx scripts/attendance-employee-dump.ts <EMPLOYEE_CODE> [from] [to]
import "dotenv/config";
import { db } from "../src/db/mysql.js";

const CODE = (process.argv[2] ?? "").trim();
const FROM = process.argv[3] ?? "2026-09-01";
const TO = process.argv[4] ?? "2026-10-12";
if (!CODE) { console.error("employee code required"); process.exit(1); }

async function q(label: string, sql: string, params: unknown[]) {
  try {
    const [rows] = await db.execute<any[]>(sql, params as any);
    console.log(`\n=== ${label} (${(rows as any[]).length} rows) ===`);
    if ((rows as any[]).length) console.table(rows);
  } catch (e: any) {
    console.log(`\n=== ${label} === SKIPPED: ${e?.code ?? ""} ${e?.message ?? e}`);
  }
}

(async () => {
  const [emps] = await db.execute<any[]>(
    `SELECT id, employee_code, biometric_code, first_name, last_name, branch_id, process_id,
            date_of_joining, date_of_exit, employment_status, active_status
       FROM employees WHERE employee_code = ? OR biometric_code = ? LIMIT 5`,
    [CODE, CODE],
  );
  console.log("=== EMPLOYEE ==="); console.table(emps);
  const emp = (emps as any[])[0];
  if (!emp) { await db.end(); return; }
  const id = emp.id;
  const codes = [...new Set([emp.employee_code, emp.biometric_code, CODE].filter(Boolean))] as string[];
  const inCodes = codes.map(() => "?").join(",");

  await q("BIOMETRIC ENROLLMENT", `SELECT cosec_user_id, is_active, last_sync_at FROM employee_biometric_enrollment WHERE employee_id = ?`, [id]);
  await q("integration_biometric_daily",
    `SELECT employee_code, activity_date, first_punch, last_punch, total_punches, biometric_minutes, integration_key, updated_at
       FROM integration_biometric_daily WHERE employee_code IN (${inCodes}) AND activity_date BETWEEN ? AND ? ORDER BY activity_date`,
    [...codes, FROM, TO]);
  await q("wfm_external_punch_staging (raw punches)",
    `SELECT employee_code, punch_time FROM wfm_external_punch_staging
      WHERE employee_code IN (${inCodes}) AND punch_time >= ? AND punch_time < DATE_ADD(?, INTERVAL 2 DAY) ORDER BY punch_time`,
    [...codes, FROM, TO]);
  await q("biometric_attendance_log",
    `SELECT punch_date, first_punch_in, last_punch_out, total_punches, raw_minutes, source_system, migrated_at
       FROM biometric_attendance_log WHERE employee_id = ? AND punch_date BETWEEN ? AND ? ORDER BY punch_date`,
    [id, FROM, TO]);
  await q("wfm_attendance_session",
    `SELECT session_date, login_time, logout_time, total_login_minutes, current_status, punch_source
       FROM wfm_attendance_session WHERE employee_id = ? AND session_date BETWEEN ? AND ? ORDER BY session_date`,
    [id, FROM, TO]);
  await q("attendance_daily_record",
    `SELECT record_date, clock_in_time, clock_out_time, raw_minutes, biometric_minutes, attendance_status, lwp_value,
            mismatch_flag, is_locked, source_system, status_change_reason, updated_at
       FROM attendance_daily_record WHERE employee_id = ? AND record_date BETWEEN ? AND ? ORDER BY record_date`,
    [id, FROM, TO]);
  await q("ROSTER",
    `SELECT roster_date, shift_start_time, shift_end_time, is_week_off, publish_status
       FROM wfm_roster_assignment WHERE employee_id = ? AND roster_date BETWEEN ? AND ? ORDER BY roster_date, updated_at`,
    [id, FROM, TO]);
  await q("LEAVE",
    `SELECT from_date, to_date, total_days, status FROM leave_request
      WHERE employee_id = ? AND to_date >= ? AND from_date <= ?`, [id, FROM, TO]);
  await q("SALARY LINES",
    `SELECT spl.*, spr.run_month, spr.status AS run_status
       FROM salary_prep_line spl JOIN salary_prep_run spr ON spr.id = spl.run_id
      WHERE spl.employee_id = ? ORDER BY spr.run_month DESC LIMIT 3`, [id]);
  await db.end();
})().catch(async (e) => { console.error("ERR", e?.message ?? e); try { await db.end(); } catch { } process.exit(1); });
