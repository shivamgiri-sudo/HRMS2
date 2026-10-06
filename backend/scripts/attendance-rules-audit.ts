/**
 * Attendance rules audit. READ-ONLY, COUNTS ONLY.
 *   1. Configured thresholds (half-day floors) and rule tables.
 *   2. The October 2026 days re-graded by sep-attendance-regrade (created_by = 'sep-2026-regrade'):
 *      which source decided them, their minutes, and whether each status matches its own threshold.
 *
 *   npx tsx scripts/attendance-rules-audit.ts
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { resolveHalfDayFloorMinutes, COSEC_DEFAULT_FULL_DAY_MINUTES } from "../src/modules/wfm/attendance-engine.service.js";

const q = async (sql: string, p: unknown[] = []) => (await db.execute<RowDataPacket[]>(sql, p))[0] as any[];

(async () => {
  const aprFloor = await resolveHalfDayFloorMinutes("netlogin_half_day_floor_minutes");
  const bioFloor = await resolveHalfDayFloorMinutes("biometric_half_day_floor_minutes");
  console.log("== 1. Thresholds in force ==");
  console.log(`  dialler (APR): full day 480 min, half-day floor ${aprFloor} min`);
  console.log(`  biometric (COSEC): full day ${COSEC_DEFAULT_FULL_DAY_MINUTES} min (unless exception bucket), half-day floor ${bioFloor} min`);

  console.log("== 2. Who is on which attendance logic (apr_eligibility_config, active) ==");
  for (const r of await q(`SELECT COALESCE(attendance_logic,'apr') l, COUNT(*) n FROM apr_eligibility_config WHERE active_status = 1 GROUP BY l`))
    console.log(`  ${r.l}: ${r.n} scope rows`);
  try {
    for (const r of await q(`SELECT COUNT(*) n FROM employee_attendance_logic_override WHERE COALESCE(active_status,1) = 1`))
      console.log(`  personal overrides: ${r.n}`);
  } catch { console.log("  personal overrides: table not present"); }
  try {
    for (const r of await q(`SELECT COUNT(*) n, MIN(full_day_threshold_minutes) mn, MAX(full_day_threshold_minutes) mx FROM employee_attendance_exception_bucket`))
      console.log(`  COSEC exception buckets: ${r.n} employees (full day ${r.mn ?? "-"}..${r.mx ?? "-"} min)`);
  } catch { console.log("  COSEC exception buckets: table not present"); }
  console.log("== 3. attendance_rule_config (active): source / full / half ==");
  for (const r of await q(
    `SELECT attendance_source s, full_day_minutes f, half_day_minutes h, COUNT(*) n FROM attendance_rule_config
      WHERE active_status = 1 GROUP BY s, f, h ORDER BY n DESC`))
    console.log(`  ${r.s} full=${r.f} half=${r.h}: ${r.n} rules`);

  console.log("== 4. The re-graded October days (created_by = 'sep-2026-regrade') ==");
  const rows = await q(
    `SELECT attendance_status st, attendance_source src, COALESCE(source_system,'') sys,
            COALESCE(dialler_minutes,0) dm, COALESCE(biometric_minutes,0) bm, raw_minutes rm, lwp_value lwp
       FROM attendance_daily_record WHERE record_date >= '2026-10-01' AND created_by = 'sep-2026-regrade'`);
  const by: Record<string, number> = {};
  const band = (m: number) => (m <= 0 ? "0" : m < 240 ? "1-239" : m < 480 ? "240-479" : m < 540 ? "480-539" : "540+");
  let mismatch = 0;
  for (const r of rows) {
    const k = `${r.st} | ${r.src} via ${r.sys} | minutes ${band(Number(r.rm))}`;
    by[k] = (by[k] ?? 0) + 1;
    const m = Number(r.rm);
    const full = r.src === "dialler" ? 480 : COSEC_DEFAULT_FULL_DAY_MINUTES;
    const floor = r.src === "dialler" ? aprFloor : bioFloor;
    const expected = m >= full ? "present" : m >= floor ? "half_day" : "absent";
    if (["present", "half_day", "absent"].includes(r.st) && r.st !== expected && r.src !== "biometric") mismatch++;
  }
  console.log(`  rows=${rows.length}`);
  for (const [k, n] of Object.entries(by).sort((a, b) => b[1] - a[1])) console.log(`  ${n}  ${k}`);
  console.log(`  dialler-decided rows whose status does not match their own minutes: ${mismatch}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
