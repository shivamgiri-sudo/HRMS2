/**
 * Deep attendance audit for a date range. READ-ONLY (the engine is only asked to compute; nothing is
 * written). COUNTS ONLY.
 *
 *   A. Full recompute: every unlocked day re-run through the live engine and compared with what is stored.
 *   B. Active employees inside their employment window with no record at all.
 *   C. Evidence checks on stored rows: punches / dialler minutes ignored, "present" with no evidence,
 *      approved leave not reflected.
 *   D. Biometric half-day policy: days with 240-269 punch minutes (absent at the live 270 floor,
 *      half day at the 240 the rule table shows).
 *   E. Locked / overridden / regularized days, dialler-vs-biometric conflicts, rows outside employment.
 *
 *   npx tsx scripts/attendance-deep-audit.ts 2026-10-01 2026-10-05
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { attendanceEngineService } from "../src/modules/wfm/attendance-engine.service.js";
import { findMissingPersonDays } from "../src/modules/wfm/attendance-heal.service.js";
import { attendanceInEmploymentWindowSql } from "../src/shared/employmentWindow.js";

const [FROM, TO] = process.argv.slice(2);
const q = async (sql: string, p: unknown[] = []) => (await db.execute<RowDataPacket[]>(sql, p))[0] as any[];
const fam = (s: string) => s.startsWith("apr") ? "dialler(apr)" : s.startsWith("dialer") ? "dialler(session)" : s.includes("attendance_session") || s.startsWith("integration") ? "biometric"
  : s === "cosec_policy_absence" ? "no-evidence" : s || "-";
const credit = (s: string) => (["present", "leave_approved", "holiday", "week_off"].includes(s) ? 1 : s === "half_day" ? 0.5 : 0);

(async () => {
  console.log(`range ${FROM}..${TO}`);
  const UNPROT = `adr.is_locked = 0 AND adr.override_by IS NULL AND adr.regularization_id IS NULL`;
  const SESS = `(SELECT COALESCE(SUM(s.total_login_minutes),0) FROM wfm_attendance_session s WHERE s.employee_id = adr.employee_id AND s.session_date = adr.record_date)`;
  const APRM = `(SELECT COALESCE(SUM(TIME_TO_SEC(x.Net_Login)),0) DIV 60 FROM (SELECT DISTINCT UserID, ReportDate, Net_Login, campaign_id FROM apr WHERE ReportDate BETWEEN '${FROM}' AND '${TO}') x WHERE x.UserID = e.employee_code AND x.ReportDate = adr.record_date)`;

  console.log("== E. What is stored ==");
  for (const r of await q(
    `SELECT COUNT(*) n, SUM(adr.is_locked=1) locked, SUM(adr.override_by IS NOT NULL) overrides, SUM(adr.regularization_id IS NOT NULL) regularized,
            SUM(adr.mismatch_flag=1) dialler_vs_biometric_conflict, SUM(NOT ${attendanceInEmploymentWindowSql("adr")}) outside_employment
       FROM attendance_daily_record adr WHERE adr.record_date BETWEEN ? AND ?`, [FROM, TO]))
    console.log(`  rows=${r.n} locked=${r.locked} overrides=${r.overrides} regularized=${r.regularized} conflicts(mismatch_flag)=${r.dialler_vs_biometric_conflict} outside employment=${r.outside_employment}`);
  for (const r of await q(`SELECT attendance_status s, COUNT(*) n FROM attendance_daily_record WHERE record_date BETWEEN ? AND ? GROUP BY s ORDER BY n DESC`, [FROM, TO]))
    console.log(`  status ${r.s}: ${r.n}`);

  console.log("== B. Active employees with no record (inside employment window) ==");
  const missing = await findMissingPersonDays({ from: FROM, to: TO, limit: 5000 });
  console.log(`  person-days missing=${missing.rows.length}${missing.truncated ? "+ (truncated)" : ""}`);

  console.log("== C. Evidence checks on stored, unprotected rows ==");
  for (const r of await q(
    `SELECT
       SUM(adr.attendance_status IN ('absent','missing_punch') AND ${SESS} >= 270) absent_with_punches_ge_270,
       SUM(adr.attendance_status IN ('absent','missing_punch') AND ${APRM} >= 240) absent_with_dialler_ge_240,
       SUM(adr.attendance_status = 'present' AND ${SESS} = 0 AND ${APRM} = 0 AND COALESCE(adr.biometric_minutes,0) = 0 AND COALESCE(adr.dialler_minutes,0) = 0) present_without_any_evidence,
       SUM(adr.attendance_status NOT IN ('leave_approved','half_day') AND EXISTS (SELECT 1 FROM leave_request lr WHERE lr.employee_id = adr.employee_id AND LOWER(lr.status) IN ('approved','branch_head_approved') AND adr.record_date BETWEEN lr.from_date AND lr.to_date)) approved_leave_not_reflected
     FROM attendance_daily_record adr JOIN employees e ON e.id = adr.employee_id
    WHERE adr.record_date BETWEEN ? AND ? AND ${UNPROT}`, [FROM, TO]))
    console.log(`  absent/missing but punches >= 270 min: ${r.absent_with_punches_ge_270}\n  absent/missing but dialler >= 240 min: ${r.absent_with_dialler_ge_240}\n  present with no punches and no dialler at all: ${r.present_without_any_evidence}\n  approved leave not shown as leave: ${r.approved_leave_not_reflected}`);

  console.log("== D. Biometric half-day policy (live floor 270 vs rule table 240) ==");
  for (const r of await q(
    `SELECT COUNT(*) n, SUM(adr.attendance_status='absent') now_absent FROM attendance_daily_record adr
      WHERE adr.record_date BETWEEN ? AND ? AND adr.attendance_source = 'biometric' AND adr.raw_minutes BETWEEN 240 AND 269`, [FROM, TO]))
    console.log(`  days with 240-269 punch minutes: ${r.n} (absent now: ${r.now_absent}) - these become half day if the floor is 240`);

  console.log("== A. Full recompute of every unprotected day with the live engine ==");
  const rows = await q(
    `SELECT adr.employee_id, DATE_FORMAT(adr.record_date,'%Y-%m-%d') d, adr.attendance_status st, adr.lwp_value lwp
       FROM attendance_daily_record adr WHERE adr.record_date BETWEEN ? AND ? AND ${UNPROT} AND ${attendanceInEmploymentWindowSql("adr")}`, [FROM, TO]);
  const moves: Record<string, number> = {};
  let same = 0, diff = 0, failed = 0, before = 0, after = 0;
  for (const r of rows) {
    try {
      const res = await attendanceEngineService.processEmployee(String(r.employee_id), String(r.d));
      before += credit(String(r.st)); after += credit(String(res.status));
      if (res.status === r.st) { same++; continue; }
      diff++;
      const k = `${r.st} -> ${res.status} [${fam(String(res.sourceSystem ?? ""))}]`;
      moves[k] = (moves[k] ?? 0) + 1;
    } catch { failed++; }
  }
  console.log(`  checked=${rows.length} same=${same} different=${diff} failed=${failed}  paid-day credit stored=${before} recomputed=${after}`);
  for (const [k, n] of Object.entries(moves).sort((a, b) => b[1] - a[1])) console.log(`  ${n}  ${k}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
