/**
 * October 2026 live check after the attendance fixes were deployed (2026-10-05 21:41 UTC). READ-ONLY,
 * COUNTS ONLY.
 *
 *   npx tsx scripts/oct-attendance-verify.ts
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { attendanceInEmploymentWindowSql } from "../src/shared/employmentWindow.js";

const DEPLOYED_IST = "2026-10-06 03:11:00"; // deploy finished 2026-10-05 21:41 UTC
const q = async (sql: string, p: unknown[] = []) => (await db.execute<RowDataPacket[]>(sql, p))[0] as any[];

(async () => {
  console.log("== 1. APR sync runs since deploy (worker_job_run) ==");
  for (const r of await q(
    `SELECT status, DATE_FORMAT(COALESCE(completed_at, started_at), '%Y-%m-%d %H:%i') at, metadata
       FROM worker_job_run WHERE worker_name = 'apr-vicidial-sync' AND started_at >= ? ORDER BY started_at`, [DEPLOYED_IST])) {
    let m: any = {}; try { m = typeof r.metadata === "string" ? JSON.parse(r.metadata) : r.metadata ?? {}; } catch { /* */ }
    console.log(`  ${r.at} ${r.status} deep=${m.deep ?? "-"} dates=${(m.dates ?? []).length} changed=${m.changed ?? "-"} regraded=${m.regraded ?? "-"} heldPayroll=${m.skippedPayroll ?? "-"} failedDates=${(m.failedDates ?? []).join(",") || "none"}`);
  }
  console.log("== 2. APR agents per ReportDate ==");
  for (const r of await q(
    `SELECT DATE_FORMAT(ReportDate,'%Y-%m-%d %a') d, COUNT(DISTINCT UserID) users,
            COUNT(DISTINCT CASE WHEN COALESCE(source,'') = 'manual' THEN UserID END) manual
       FROM apr WHERE ReportDate BETWEEN '2026-09-28' AND CURDATE() GROUP BY ReportDate ORDER BY ReportDate`))
    console.log(`  ${r.d} agents=${r.users} (bulk-uploaded=${r.manual})`);
  console.log("== 3. October attendance rows outside employment (salary start .. exit) ==");
  for (const r of await q(
    `SELECT COUNT(*) n, SUM(adr.created_at >= ?) created_after_deploy, SUM(adr.updated_at >= ?) touched_after_deploy
       FROM attendance_daily_record adr
      WHERE adr.record_date >= '2026-10-01' AND NOT ${attendanceInEmploymentWindowSql("adr")}`, [DEPLOYED_IST, DEPLOYED_IST]))
    console.log(`  total=${r.n} created after deploy=${r.created_after_deploy ?? 0} touched after deploy=${r.touched_after_deploy ?? 0}`);
  console.log("== 4. October rows still built with the old night-shift window ==");
  for (const r of await q(
    `SELECT COUNT(*) n, SUM(updated_at >= ?) touched_after_deploy FROM attendance_daily_record
      WHERE record_date >= '2026-10-01' AND source_system LIKE '%night_shift_window'`, [DEPLOYED_IST]))
    console.log(`  total=${r.n} written after deploy=${r.touched_after_deploy ?? 0}`);
  console.log("== 5. October rows written/updated after deploy, per day ==");
  for (const r of await q(
    `SELECT DATE_FORMAT(record_date,'%Y-%m-%d') d, COUNT(*) n FROM attendance_daily_record
      WHERE record_date >= '2026-10-01' AND updated_at >= ? GROUP BY d ORDER BY d`, [DEPLOYED_IST]))
    console.log(`  ${r.d} rows=${r.n}`);
  console.log("== 6. October payroll run ==");
  const runs = await q(`SELECT status, COUNT(*) n FROM salary_prep_run WHERE LEFT(CAST(run_month AS CHAR),7) = '2026-10' GROUP BY status`);
  console.log("  " + (runs.length ? runs.map((r) => `${r.status}=${r.n}`).join(", ") : "none yet"));
  console.log("== 7. Still marked active with an Exit Date in the past ==");
  const [a] = await q(`SELECT COUNT(*) n FROM employees WHERE active_status = 1 AND date_of_exit IS NOT NULL AND date_of_exit < CURDATE()`);
  console.log(`  ${a.n}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
