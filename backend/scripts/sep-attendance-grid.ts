/**
 * Sep 2026 day grid for the employees in sep-attendance-vs-dbbill. READ-ONLY (SELECTs only).
 * Per employee per day: roster shift, HRMS daily record, APR rows, biometric, db_bill Attandence.
 *
 *   npx tsx scripts/sep-attendance-grid.ts
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { billQuery, closeBillPool } from "../src/db/billDb.js";
import type { RowDataPacket } from "mysql2";

const CODES = (process.argv[2] ?? "").split(",").filter(Boolean);
const FROM = "2026-08-30", TO = "2026-10-01";

(async () => {
  // Only attendance-relevant APR columns: login date, net login and login/logout times when present.
  const [cols] = await db.query<RowDataPacket[]>(`SHOW COLUMNS FROM apr`);
  const have = new Set((cols as any[]).map((c) => c.Field));
  const aprCols = ["UserID", "ReportDate", "Net_Login", "Login_Time", "Logout_Time", "First_Login", "Last_Logout"].filter((c) => have.has(c));
  console.log("APRCOLS", JSON.stringify(aprCols));
  for (const code of CODES) {
    const [[e]] = (await db.query<RowDataPacket[]>(`SELECT id FROM employees WHERE employee_code = ?`, [code])) as any;
    if (!e) { console.log("NOEMP", code); continue; }
    const [ros] = await db.query<RowDataPacket[]>(
      `SELECT DATE_FORMAT(wra.roster_date,'%Y-%m-%d') d, wra.publish_status, wra.is_week_off wo, COALESCE(wra.shift_start_time, wsm.start_time) s, COALESCE(wra.shift_end_time, wsm.end_time) en
         FROM wfm_roster_assignment wra LEFT JOIN wfm_shift_master wsm ON wsm.id = wra.shift_id
        WHERE wra.employee_id = ? AND wra.roster_date BETWEEN ? AND ?`, [e.id, FROM, TO]).catch(async () =>
      db.query<RowDataPacket[]>(
      `SELECT DATE_FORMAT(wra.roster_date,'%Y-%m-%d') d, wra.publish_status, COALESCE(wra.shift_start_time, wsm.start_time) s, COALESCE(wra.shift_end_time, wsm.end_time) en
         FROM wfm_roster_assignment wra LEFT JOIN wfm_shift_master wsm ON wsm.id = wra.shift_id
        WHERE wra.employee_id = ? AND wra.roster_date BETWEEN ? AND ?`, [e.id, FROM, TO]));
    const [adr] = await db.query<RowDataPacket[]>(
      `SELECT DATE_FORMAT(record_date,'%Y-%m-%d') d, attendance_status st, source_system src, dialler_minutes dm, biometric_minutes bm, raw_minutes rm
         FROM attendance_daily_record WHERE employee_id = ? AND record_date BETWEEN ? AND ?`, [e.id, FROM, TO]);
    const [apr] = await db.query<RowDataPacket[]>(`SELECT DISTINCT ${aprCols.join(", ")} FROM apr WHERE UserID = ? AND ReportDate BETWEEN ? AND ?`, [code, FROM, TO]);
    const [bio] = await db.query<RowDataPacket[]>(
      `SELECT DATE_FORMAT(punch_date,'%Y-%m-%d') d, first_punch_in i, last_punch_out o, raw_minutes m FROM biometric_attendance_log WHERE employee_id = ? AND punch_date BETWEEN ? AND ?`, [e.id, FROM, TO]);
    const bill = (await billQuery(
      `SELECT DATE_FORMAT(AttandDate,'%Y-%m-%d') d, Status, OldStatus, Intime, OutTime, DATE_FORMAT(ImportDate,'%Y-%m-%d %H:%i') imp FROM Attandence WHERE EmpCode = '${code}' AND AttandDate BETWEEN '${FROM}' AND '${TO}'`)) as any[];
    console.log("GRID", JSON.stringify({ code, ros, adr, apr, bio, bill }));
  }
  await closeBillPool();
  process.exit(0);
})().catch(async (e) => { console.error(e); await closeBillPool().catch(() => {}); process.exit(1); });
