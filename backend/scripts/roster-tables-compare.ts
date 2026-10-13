// READ-ONLY. Do the two roster stores agree?  roster_daily_assignment (governance / rule engine)
// vs wfm_roster_assignment (the live table attendance reads).
// Usage: npx tsx scripts/roster-tables-compare.ts <ignored> <from> <to>
import "dotenv/config";
import { db } from "../src/db/mysql.js";

const FROM = process.argv[3] ?? "2026-10-01";
const TO = process.argv[4] ?? "2026-10-12";

async function q(label: string, sql: string, params: unknown[] = []) {
  try {
    const [rows] = await db.execute<any[]>(sql, params as any);
    console.log(`\n=== ${label} (${(rows as any[]).length} rows) ===`);
    if ((rows as any[]).length) console.table(rows);
  } catch (e: any) { console.log(`\n=== ${label} === FAILED: ${e?.code ?? ""} ${e?.message ?? e}`); }
}

(async () => {
  await q("row counts in window",
    `SELECT 'roster_daily_assignment' AS tbl, COUNT(*) AS n, COUNT(DISTINCT employee_id) AS emps FROM roster_daily_assignment WHERE roster_date BETWEEN ? AND ?
     UNION ALL SELECT 'wfm_roster_assignment', COUNT(*), COUNT(DISTINCT employee_id) FROM wfm_roster_assignment WHERE roster_date BETWEEN ? AND ?`,
    [FROM, TO, FROM, TO]);

  await q("live table: publish_status x decision_source",
    `SELECT publish_status, COALESCE(decision_source,'(null)') AS decision_source, COUNT(*) AS n, COUNT(DISTINCT employee_id) AS emps
       FROM wfm_roster_assignment WHERE roster_date BETWEEN ? AND ? GROUP BY publish_status, decision_source ORDER BY n DESC`, [FROM, TO]);

  await q("live table: employees with MORE THAN ONE row on a date",
    `SELECT COUNT(*) AS employee_days_with_duplicates FROM (
       SELECT employee_id, roster_date FROM wfm_roster_assignment WHERE roster_date BETWEEN ? AND ?
        GROUP BY employee_id, roster_date HAVING COUNT(*) > 1) d`, [FROM, TO]);

  await q("only in roster_daily_assignment (working days, no live row)",
    `SELECT COUNT(*) AS employee_days, COUNT(DISTINCT rda.employee_id) AS emps
       FROM roster_daily_assignment rda
       LEFT JOIN wfm_roster_assignment w ON w.employee_id = rda.employee_id AND w.roster_date = rda.roster_date
      WHERE rda.roster_date BETWEEN ? AND ? AND rda.is_week_off = 0 AND rda.is_holiday = 0 AND w.id IS NULL`, [FROM, TO]);

  await q("only in roster_daily_assignment, by branch (top 10)",
    `SELECT COALESCE(b.branch_name,'?') AS branch, COUNT(*) AS employee_days, COUNT(DISTINCT rda.employee_id) AS emps
       FROM roster_daily_assignment rda
       JOIN employees e ON e.id = rda.employee_id LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN wfm_roster_assignment w ON w.employee_id = rda.employee_id AND w.roster_date = rda.roster_date
      WHERE rda.roster_date BETWEEN ? AND ? AND rda.is_week_off = 0 AND rda.is_holiday = 0 AND w.id IS NULL
      GROUP BY branch ORDER BY employee_days DESC LIMIT 10`, [FROM, TO]);

  await q("both present but DIFFERENT working/week-off flag",
    `SELECT COUNT(*) AS employee_days FROM roster_daily_assignment rda
       JOIN wfm_roster_assignment w ON w.employee_id = rda.employee_id AND w.roster_date = rda.roster_date
      WHERE rda.roster_date BETWEEN ? AND ? AND rda.is_week_off <> w.is_week_off`, [FROM, TO]);

  await q("both present, working day, DIFFERENT shift start time",
    `SELECT COUNT(*) AS employee_days FROM roster_daily_assignment rda
       JOIN wfm_shift_template wst ON wst.id = rda.shift_template_id
       JOIN wfm_roster_assignment w ON w.employee_id = rda.employee_id AND w.roster_date = rda.roster_date
      WHERE rda.roster_date BETWEEN ? AND ? AND rda.is_week_off = 0 AND w.is_week_off = 0
        AND wst.start_time IS NOT NULL AND w.shift_start_time IS NOT NULL
        AND TIME(wst.start_time) <> TIME(w.shift_start_time)`, [FROM, TO])
    .catch(() => undefined);

  await q("live table: working days with NO shift times (cannot form a shift window)",
    `SELECT publish_status, COUNT(*) AS employee_days FROM wfm_roster_assignment
      WHERE roster_date BETWEEN ? AND ? AND is_week_off = 0 AND (shift_start_time IS NULL OR shift_end_time IS NULL)
      GROUP BY publish_status`, [FROM, TO]);

  await q("biometric employees with attendance but NO live roster row on that date",
    `SELECT COUNT(*) AS employee_days, COUNT(DISTINCT a.employee_id) AS emps
       FROM attendance_daily_record a
       LEFT JOIN wfm_roster_assignment w ON w.employee_id = a.employee_id AND w.roster_date = a.record_date
      WHERE a.record_date BETWEEN ? AND ? AND a.attendance_status IN ('present','half_day') AND w.id IS NULL`, [FROM, TO]);

  await db.end();
  process.exit(0);
})().catch(async (e) => { console.error("ERR", e?.message ?? e); try { await db.end(); } catch { } process.exit(1); });
