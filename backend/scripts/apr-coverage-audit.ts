/**
 * APR load coverage per ReportDate. READ-ONLY (SELECTs only). Prints COUNTS ONLY per date / hour,
 * never an employee code, name or per-person row.
 *
 *   npx tsx scripts/apr-coverage-audit.ts 2026-08-25 2026-10-05
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { billQuery, closeBillPool } from "../src/db/billDb.js";
import type { RowDataPacket } from "mysql2";

const FROM = process.argv[2] ?? "2026-08-25";
const TO = process.argv[3] ?? "2026-10-05";

(async () => {
  const [tz] = await db.query<RowDataPacket[]>(`SELECT @@global.time_zone g, @@session.time_zone s, NOW() now_db`);
  console.log("HRMS DB time zone", JSON.stringify(tz[0]));

  console.log("== 1. apr rows per ReportDate: distinct users (all / NOIDA-2) and by source ==");
  const [perDate] = await db.query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(ReportDate,'%Y-%m-%d %a') d,
            COUNT(DISTINCT UserID) users,
            COUNT(DISTINCT CASE WHEN branch_name LIKE 'NOIDA-2%' THEN UserID END) noida2,
            COUNT(DISTINCT CASE WHEN COALESCE(source,'') = 'manual' THEN UserID END) manual,
            COUNT(DISTINCT CASE WHEN campaign_id IN ('APR_BULK','MANUAL_UPLOAD') THEN UserID END) bulk,
            COUNT(DISTINCT CASE WHEN COALESCE(source,'') NOT IN ('manual') AND campaign_id NOT IN ('APR_BULK','MANUAL_UPLOAD') THEN UserID END) sync,
            ROUND(SUM(TIME_TO_SEC(Net_Login))/3600) net_hours
       FROM apr WHERE ReportDate BETWEEN ? AND ? GROUP BY ReportDate ORDER BY ReportDate`, [FROM, TO]);
  for (const r of perDate as any[]) console.log(`  ${r.d}  users=${r.users} noida2=${r.noida2} sync=${r.sync} manual=${r.manual} bulk=${r.bulk} netH=${r.net_hours}`);

  console.log("== 2. Sep sync rows by HOUR(Login_Time) (IST store => day shift peaks ~09; UTC store => ~03) ==");
  const [hours] = await db.query<RowDataPacket[]>(
    `SELECT HOUR(Login_Time) h, COUNT(*) n FROM apr
      WHERE ReportDate BETWEEN '2026-09-01' AND '2026-09-30' AND Login_Time IS NOT NULL AND Login_Time <> '00:00:00'
        AND campaign_id NOT IN ('APR_BULK','MANUAL_UPLOAD') GROUP BY h ORDER BY h`);
  console.log("  " + (hours as any[]).map((r) => `${r.h}h:${r.n}`).join("  "));

  console.log("== 3. NOIDA-2 per date: biometric presence vs APR on the same date ==");
  const [cmp] = await db.query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(b.punch_date,'%Y-%m-%d %a') d,
            COUNT(*) punched,
            SUM(HOUR(b.first_punch_in) < 6) early_punch,
            SUM(EXISTS(SELECT 1 FROM apr a WHERE a.UserID = e.employee_code AND a.ReportDate = b.punch_date)) apr_same,
            SUM(HOUR(b.first_punch_in) < 6 AND EXISTS(SELECT 1 FROM apr a WHERE a.UserID = e.employee_code AND a.ReportDate = b.punch_date)) early_apr_same,
            SUM(HOUR(b.first_punch_in) < 6 AND EXISTS(SELECT 1 FROM apr a WHERE a.UserID = e.employee_code AND a.ReportDate = DATE_SUB(b.punch_date, INTERVAL 1 DAY))) early_apr_prev
       FROM biometric_attendance_log b
       JOIN employees e ON e.id = b.employee_id
       JOIN branch_master bm ON bm.id = e.branch_id AND bm.branch_name = 'NOIDA-2'
      WHERE b.punch_date BETWEEN ? AND ? AND b.raw_minutes >= 240
      GROUP BY b.punch_date ORDER BY b.punch_date`, [FROM, TO]);
  for (const r of cmp as any[]) console.log(`  ${r.d}  punched=${r.punched} aprSameDate=${r.apr_same} | early(<6h)=${r.early_punch} earlyAprSame=${r.early_apr_same} earlyAprPrev=${r.early_apr_prev}`);

  console.log("== 4. db_bill Attandence NOIDA-2 per date: P / HD / A ==");
  const bill = await billQuery<any>(
    `SELECT DATE_FORMAT(AttandDate,'%Y-%m-%d') d, SUM(Status='P') p, SUM(Status='HD') hd, SUM(Status='A') a, COUNT(*) n
       FROM Attandence WHERE AttandDate BETWEEN ? AND ? AND BranchName = 'NOIDA-2' GROUP BY AttandDate ORDER BY AttandDate`, [FROM, TO]);
  for (const r of bill) console.log(`  ${r.d}  rows=${r.n} P=${r.p} HD=${r.hd} A=${r.a}`);
  await closeBillPool();
  process.exit(0);
})().catch(async (e) => { console.error(e); await closeBillPool().catch(() => {}); process.exit(1); });
