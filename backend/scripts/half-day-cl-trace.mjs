/**
 * Half-day CL/ML trace — read-only. Why does a 0.5 CL count as 1?
 *   CODES="MAS60040,MAS62413" MONTH=2026-09 node scripts/half-day-cl-trace.mjs
 * Per employee: every CL/ML request in the month (days, status, created), what the monthly-cap
 * query counts for each, balance deductions recorded on approval, and that day's attendance.
 * Company-wide: approved half-day CL/ML requests whose deduction is not 0.5.
 */
import { createRequire } from "node:module";

await import("dotenv/config");
const require = createRequire(import.meta.url);
const mysql = require("mysql2/promise");
const strip = (v) => String(v ?? "").trim().replace(/^["']|["']$/g, "");
const MONTH = process.env.MONTH || "2026-09";
const codes = String(process.env.CODES ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const conn = await mysql.createConnection({
  host: process.env.DB_HOST_OVERRIDE || strip(process.env.DB_HOST),
  port: Number(strip(process.env.DB_PORT) || 3306),
  user: strip(process.env.DB_USER),
  password: strip(process.env.DB_PASSWORD),
  database: strip(process.env.DB_NAME),
  connectTimeout: 20000,
  dateStrings: true,
});
const show = async (title, sql, params = []) => {
  try {
    const [rows] = await conn.query(sql, params);
    console.log(`\n## ${title}`);
    for (const r of rows) console.log(JSON.stringify(r));
    if (!rows.length) console.log("(none)");
  } catch (e) {
    console.log(`\n## ${title}\nERROR ${e.code ?? ""} ${e.message}`);
  }
};

try {
  await conn.query("SET SESSION TRANSACTION READ ONLY");
  const start = `${MONTH}-01`;
  await show(
    `CL/ML requests in ${MONTH} for ${codes.join(",")}`,
    `SELECT e.employee_code, lt.leave_code, lr.from_date, lr.to_date, lr.total_days, lr.status,
            CASE WHEN lr.from_date = lr.to_date THEN LEAST(lr.total_days, 1)
                 ELSE DATEDIFF(LEAST(lr.to_date, LAST_DAY(?)), GREATEST(lr.from_date, ?)) + 1 END cap_counts,
            (SELECT COALESCE(SUM(d.days_deducted), 0) FROM leave_balance_deduction d WHERE d.leave_request_id = lr.id) deducted,
            (SELECT CONCAT(a.attendance_status, IF(a.is_locked, '/L', ''), ' lwp=', a.lwp_value) FROM attendance_daily_record a
              WHERE a.employee_id = lr.employee_id AND a.record_date = lr.from_date LIMIT 1) att,
            lr.created_at, lr.approved_at
       FROM leave_request lr JOIN employees e ON e.id = lr.employee_id
       JOIN leave_type_master lt ON lt.id = lr.leave_type_id
      WHERE e.employee_code IN (?) AND lt.leave_code IN ('CL','ML')
        AND lr.from_date <= LAST_DAY(?) AND lr.to_date >= ?
      ORDER BY e.employee_code, lr.from_date, lr.created_at`,
    [start, start, codes.length ? codes : [""], start, start],
  );
  await show(
    `approved half-day CL/ML in ${MONTH} (company): deduction recorded vs 0.5`,
    `SELECT COALESCE(x.deducted, -1) deducted, COUNT(*) n FROM (
       SELECT lr.id, (SELECT SUM(d.days_deducted) FROM leave_balance_deduction d WHERE d.leave_request_id = lr.id) deducted
         FROM leave_request lr JOIN leave_type_master lt ON lt.id = lr.leave_type_id
        WHERE lt.leave_code IN ('CL','ML') AND lr.total_days = 0.5 AND lr.status IN ('approved','branch_head_approved')
          AND lr.from_date >= ? AND lr.from_date <= LAST_DAY(?)) x
      GROUP BY deducted ORDER BY n DESC`,
    [start, start],
  );
  await show(
    `approved half-day CL/ML in ${MONTH} with NO balance deduction: why (roster week-off / holiday / ledger)`,
    `SELECT e.employee_code, lt.leave_code, lr.from_date, DAYNAME(lr.from_date) dow, lr.status, lr.approved_at,
            (SELECT GROUP_CONCAT(CONCAT(IFNULL(w.roster_status, '-'), '/wo=', IFNULL(w.is_week_off, '-')))
               FROM wfm_roster_assignment w WHERE w.employee_id = lr.employee_id AND w.roster_date = lr.from_date) roster,
            (SELECT GROUP_CONCAT(h.holiday_name) FROM leave_holiday_master h WHERE h.holiday_date = lr.from_date) holiday,
            (SELECT CONCAT(a.attendance_status, IF(a.is_locked, '/L', ''), ' lwp=', a.lwp_value, ' src=', IFNULL(a.source_system, '-'))
               FROM attendance_daily_record a WHERE a.employee_id = lr.employee_id AND a.record_date = lr.from_date LIMIT 1) att,
            (SELECT CONCAT('alloc=', l.allocated_days, ' used=', l.used_days) FROM leave_balance_ledger l
              WHERE l.employee_id = lr.employee_id AND l.leave_type_id = lr.leave_type_id AND l.balance_year = YEAR(lr.from_date) LIMIT 1) ledger,
            (SELECT GROUP_CONCAT(CONCAT(al.action, '@', al.action_at)) FROM leave_approval_log al WHERE al.leave_request_id = lr.id) log
       FROM leave_request lr JOIN employees e ON e.id = lr.employee_id
       JOIN leave_type_master lt ON lt.id = lr.leave_type_id
      WHERE lt.leave_code IN ('CL','ML') AND lr.status IN ('approved','branch_head_approved')
        AND lr.from_date >= ? AND lr.from_date <= LAST_DAY(?)
        AND NOT EXISTS (SELECT 1 FROM leave_balance_deduction d WHERE d.leave_request_id = lr.id)
      ORDER BY lr.total_days, e.employee_code, lr.from_date LIMIT 60`,
    [start, start],
  );
  await show(
    `CL/ML requests in ${MONTH} by total_days x single-day (company)`,
    `SELECT lr.total_days, lr.from_date = lr.to_date single_day, lr.status, COUNT(*) n
       FROM leave_request lr JOIN leave_type_master lt ON lt.id = lr.leave_type_id
      WHERE lt.leave_code IN ('CL','ML') AND lr.from_date >= ? AND lr.from_date <= LAST_DAY(?)
      GROUP BY lr.total_days, single_day, lr.status ORDER BY n DESC LIMIT 30`,
    [start, start],
  );
  await show(
    `same employee + same date with more than one live CL/ML request in ${MONTH} (double counting)`,
    `SELECT e.employee_code, lr.from_date, COUNT(*) n, GROUP_CONCAT(CONCAT(lr.total_days, ':', lr.status) ORDER BY lr.created_at) reqs
       FROM leave_request lr JOIN employees e ON e.id = lr.employee_id
       JOIN leave_type_master lt ON lt.id = lr.leave_type_id
      WHERE lt.leave_code IN ('CL','ML') AND lr.status IN ('approved','pending','pending_branch_head','branch_head_approved')
        AND lr.from_date >= ? AND lr.from_date <= LAST_DAY(?)
      GROUP BY lr.employee_id, e.employee_code, lr.from_date HAVING n > 1 ORDER BY n DESC LIMIT 40`,
    [start, start],
  );
} finally {
  await conn.end();
}
