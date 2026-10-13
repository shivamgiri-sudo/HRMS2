// READ-ONLY population scan for the night-shift calendar-date grouping defect.
//   A. inflated days : attendance_daily_record with raw_minutes > 14h (tail + start merged / double-added)
//   B. phantom tails : absent / half_day row whose punches are only an early-morning exit
//                      (in < 09:00, out < 11:00) right after a day that ended late (>= 20:00)
// Usage: npx tsx scripts/attendance-night-shift-population-scan.ts <ignored> [from] [to]
import "dotenv/config";
import { db } from "../src/db/mysql.js";

const FROM = process.argv[3] ?? "2026-08-01";
const TO = process.argv[4] ?? "2026-10-12";

async function q(label: string, sql: string, params: unknown[] = []) {
  try {
    const [rows] = await db.execute<any[]>(sql, params as any);
    console.log(`\n=== ${label} (${(rows as any[]).length} rows) ===`);
    if ((rows as any[]).length) console.table(rows);
  } catch (e: any) {
    console.log(`\n=== ${label} === FAILED: ${e?.code ?? ""} ${e?.message ?? e}`);
  }
}

(async () => {
  await q("A. INFLATED DAYS (>14h) by month",
    `SELECT DATE_FORMAT(record_date,'%Y-%m') AS month,
            COUNT(*) AS days, COUNT(DISTINCT employee_id) AS employees,
            SUM(is_locked=1) AS locked_days,
            ROUND(AVG(raw_minutes)/60,1) AS avg_hours, ROUND(MAX(raw_minutes)/60,1) AS max_hours
       FROM attendance_daily_record
      WHERE record_date BETWEEN ? AND ? AND raw_minutes > 840
      GROUP BY month ORDER BY month`, [FROM, TO]);

  await q("A. INFLATED DAYS by branch",
    `SELECT COALESCE(b.branch_name,'?') AS branch, COUNT(*) AS days, COUNT(DISTINCT adr.employee_id) AS employees
       FROM attendance_daily_record adr LEFT JOIN branch_master b ON b.id = adr.branch_id
      WHERE adr.record_date BETWEEN ? AND ? AND adr.raw_minutes > 840
      GROUP BY branch ORDER BY days DESC LIMIT 25`, [FROM, TO]);

  await q("A. INFLATED DAYS distribution",
    `SELECT CASE WHEN raw_minutes > 1320 THEN '>22h' WHEN raw_minutes > 1080 THEN '18-22h' ELSE '14-18h' END AS bucket,
            COUNT(*) AS days, COUNT(DISTINCT employee_id) AS employees
       FROM attendance_daily_record
      WHERE record_date BETWEEN ? AND ? AND raw_minutes > 840
      GROUP BY bucket`, [FROM, TO]);

  await q("B. PHANTOM TAIL ABSENT/HALF-DAY by month",
    `SELECT DATE_FORMAT(t.record_date,'%Y-%m') AS month,
            COUNT(*) AS days, COUNT(DISTINCT t.employee_id) AS employees,
            SUM(t.is_locked=1) AS locked_days,
            SUM(t.attendance_status='absent') AS absent_days, SUM(t.attendance_status='half_day') AS half_days,
            ROUND(SUM(t.lwp_value),1) AS lwp_total
       FROM attendance_daily_record t
       JOIN attendance_daily_record p
         ON p.employee_id = t.employee_id AND p.record_date = DATE_SUB(t.record_date, INTERVAL 1 DAY)
      WHERE t.record_date BETWEEN ? AND ?
        AND t.attendance_status IN ('absent','half_day')
        AND t.clock_in_time IS NOT NULL AND TIME(t.clock_in_time) < '09:00:00'
        AND (t.clock_out_time IS NULL OR TIME(t.clock_out_time) < '11:00:00')
        AND p.clock_out_time IS NOT NULL AND TIME(p.clock_out_time) >= '20:00:00'
      GROUP BY month ORDER BY month`, [FROM, TO]);

  await q("B. PHANTOM TAIL by branch",
    `SELECT COALESCE(b.branch_name,'?') AS branch, COUNT(*) AS days, COUNT(DISTINCT t.employee_id) AS employees,
            ROUND(SUM(t.lwp_value),1) AS lwp_total
       FROM attendance_daily_record t
       JOIN attendance_daily_record p
         ON p.employee_id = t.employee_id AND p.record_date = DATE_SUB(t.record_date, INTERVAL 1 DAY)
       LEFT JOIN branch_master b ON b.id = t.branch_id
      WHERE t.record_date BETWEEN ? AND ?
        AND t.attendance_status IN ('absent','half_day')
        AND t.clock_in_time IS NOT NULL AND TIME(t.clock_in_time) < '09:00:00'
        AND (t.clock_out_time IS NULL OR TIME(t.clock_out_time) < '11:00:00')
        AND p.clock_out_time IS NOT NULL AND TIME(p.clock_out_time) >= '20:00:00'
      GROUP BY branch ORDER BY days DESC LIMIT 25`, [FROM, TO]);

  await q("TOP 25 employees by inflated days",
    `SELECT e.employee_code, CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS name,
            COUNT(*) AS inflated_days, ROUND(AVG(adr.raw_minutes)/60,1) AS avg_hours,
            SUM(adr.is_locked=1) AS locked
       FROM attendance_daily_record adr JOIN employees e ON e.id = adr.employee_id
      WHERE adr.record_date BETWEEN ? AND ? AND adr.raw_minutes > 840
      GROUP BY e.id, e.employee_code, name ORDER BY inflated_days DESC LIMIT 25`, [FROM, TO]);

  await q("PAYROLL RUN STATUS for affected months",
    `SELECT run_month, status, COUNT(*) AS runs FROM salary_prep_run
      WHERE run_month >= DATE_FORMAT(?, '%Y-%m') GROUP BY run_month, status ORDER BY run_month`, [FROM]);

  await db.end();
})().catch(async (e) => { console.error("ERR", e?.message ?? e); try { await db.end(); } catch { } process.exit(1); });
