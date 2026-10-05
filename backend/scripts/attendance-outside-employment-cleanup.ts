/**
 * Removes attendance rows dated outside the employee's employment window (before the salary start date,
 * after the exit date, or between two stints of a rejoiner) - the same rule as shared/employmentWindow.ts.
 * Prints COUNTS ONLY.
 *
 * Never touched: locked rows, manual overrides, approved regularizations (counted for HR to review).
 * Apply first copies every removed row into attendance_daily_record_outside_employment_backup (same
 * columns + removed_at), so the removal can be reversed.
 *
 *   npx tsx scripts/attendance-outside-employment-cleanup.ts           # dry run: nothing written
 *   npx tsx scripts/attendance-outside-employment-cleanup.ts --apply
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { attendanceInEmploymentWindowSql } from "../src/shared/employmentWindow.js";

const APPLY = process.argv.includes("--apply");
const BACKUP = "attendance_daily_record_outside_employment_backup";
const OUTSIDE = `NOT ${attendanceInEmploymentWindowSql("adr")}`;
const PROTECTED = `(adr.is_locked = 1 OR adr.override_by IS NOT NULL OR adr.regularization_id IS NOT NULL)`;

(async () => {
  console.log(`mode: ${APPLY ? "APPLY" : "dry-run (nothing written)"}`);
  const [byMonth] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(adr.record_date, '%Y-%m') m, SUM(NOT ${PROTECTED}) removable, SUM(${PROTECTED}) protected_rows,
            COUNT(DISTINCT adr.employee_id) employees
       FROM attendance_daily_record adr WHERE ${OUTSIDE} GROUP BY m ORDER BY m`);
  for (const r of byMonth as any[]) console.log(`  ${r.m}  removable=${r.removable}  protected (left for HR)=${r.protected_rows}  employees=${r.employees}`);
  const [byStatus] = await db.execute<RowDataPacket[]>(
    `SELECT adr.attendance_status s, COUNT(*) n FROM attendance_daily_record adr WHERE ${OUTSIDE} AND NOT ${PROTECTED} GROUP BY s ORDER BY n DESC`);
  console.log("removable by status:", (byStatus as any[]).map((r) => `${r.s}=${r.n}`).join(", "));
  // Which side of the window: before the salary start / joining date, or after it (after exit or a rejoin gap).
  const [bySide] = await db.execute<RowDataPacket[]>(
    `SELECT CASE WHEN adr.record_date < COALESCE(e.salary_start_date, e.date_of_joining) THEN 'before salary start'
                 ELSE 'after exit / rejoin gap' END side,
            adr.attendance_status s, COUNT(*) n
       FROM attendance_daily_record adr JOIN employees e ON e.id = adr.employee_id
      WHERE ${OUTSIDE} AND NOT ${PROTECTED}
      GROUP BY side, s ORDER BY side, n DESC`);
  for (const r of bySide as any[]) console.log(`  ${r.side}: ${r.s}=${r.n}`);

  if (!APPLY) { process.exit(0); }

  await db.execute(`CREATE TABLE IF NOT EXISTS ${BACKUP} LIKE attendance_daily_record`);
  try { await db.execute(`ALTER TABLE ${BACKUP} ADD COLUMN removed_at DATETIME NULL`); } catch { /* already there */ }
  let removed = 0;
  for (;;) {
    const [ids] = await db.execute<RowDataPacket[]>(
      `SELECT adr.id FROM attendance_daily_record adr WHERE ${OUTSIDE} AND NOT ${PROTECTED} LIMIT 500`);
    const list = (ids as any[]).map((r) => String(r.id));
    if (!list.length) break;
    const ph = list.map(() => "?").join(",");
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(`INSERT IGNORE INTO ${BACKUP} SELECT adr.*, NOW() FROM attendance_daily_record adr WHERE adr.id IN (${ph})`, list);
      const [del] = await conn.execute<any>(`DELETE FROM attendance_daily_record WHERE id IN (${ph})`, list);
      await conn.commit();
      removed += Number(del.affectedRows ?? 0);
    } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  }
  const [[b]] = await db.execute<RowDataPacket[]>(`SELECT COUNT(*) n FROM ${BACKUP}`) as any;
  console.log(`removed=${removed}  backup rows=${b.n}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
