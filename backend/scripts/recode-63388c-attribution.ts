/**
 * STRICTLY READ-ONLY. For the 63388C clash: date ranges of every code-text row, so each can be attributed to
 * Talabhai (HRMS exit 2026-08-24) or Tina (db_bill DOJ 2026-08-19, active), plus Tina's db_bill salary figures.
 * Prints dates, counts and amounts only. HRMS via SELECT; db_bill via billQuery() (SELECT allowlist).
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { billQuery, closeBillPool } from "../src/db/billDb.js";

const CODE = "63388C";
const q = async (sql: string, p: unknown[] = []) => (await db.execute<RowDataPacket[]>(sql, p))[0];
const say = async (label: string, f: () => Promise<unknown>) => {
  try { console.log(`${label}:`, JSON.stringify(await f())); } catch (e) { console.log(`${label}: [failed ${(e as Error).message.slice(0, 100)}]`); }
};

async function main() {
  const [e] = await q(`SELECT id FROM employees WHERE employee_code = ?`, [CODE]);
  const id = String(e.id);
  console.log("== punches / biometric (whose are they?) ==");
  await say("biometric_attendance_log by day band", () => q(
    `SELECT CASE WHEN punch_date <= '2026-08-24' THEN 'on/before exit' ELSE 'after exit' END band, COUNT(*) n, MIN(punch_date) first_day, MAX(punch_date) last_day,
            SUM(total_punches) punches FROM biometric_attendance_log WHERE employee_id = ? GROUP BY band`, [id]));
  await say("integration_biometric_daily", () => q(
    `SELECT COUNT(*) n FROM integration_biometric_daily WHERE employee_code = ?`, [CODE]));
  await say("employee_biometric_enrollment", () => q(
    `SELECT is_active, enrolled_at FROM employee_biometric_enrollment WHERE employee_id = ?`, [id]));
  await say("wfm_attendance_session band", () => q(
    `SELECT CASE WHEN DATE(created_at) <= '2026-08-24' THEN 'on/before exit' ELSE 'after exit' END band, COUNT(*) n, MIN(created_at) first_at, MAX(created_at) last_at
       FROM wfm_attendance_session WHERE employee_id = ? GROUP BY band`, [id]));
  console.log("\n== Talabhai-only history (ATS/joining/exit) - dates ==");
  await say("ats_onboarding_bridge", () => q(`SELECT created_at FROM ats_onboarding_bridge WHERE employee_id = ? LIMIT 3`, [id]));
  await say("exit_request", () => q(`SELECT status, created_at, updated_at FROM exit_request WHERE employee_id = ?`, [id]));
  await say("full_final_calculation", () => q(`SELECT created_at FROM full_final_calculation WHERE employee_id = ? LIMIT 2`, [id]));
  await say("salary_prep_line + salary_assignment", () => q(
    `SELECT (SELECT COUNT(*) FROM salary_prep_line WHERE employee_id = ?) prep_lines,
            (SELECT COUNT(*) FROM employee_salary_assignment WHERE employee_id = ?) assignments`, [id, id]));
  await say("legacy_salary_snapshot / master snapshot / pnl", () => q(
    `SELECT (SELECT COUNT(*) FROM legacy_salary_snapshot WHERE employee_code = ?) legacy_salary,
            (SELECT COUNT(*) FROM employee_master_snapshot WHERE employee_code = ?) master_snapshot,
            (SELECT COUNT(*) FROM pnl_running_salary_snapshot WHERE employee_code = ?) pnl`, [CODE, CODE, CODE]));

  console.log("\n== Tina in db_bill (amounts only) ==");
  await say("salary_data", async () => (await billQuery<RowDataPacket>(`SELECT * FROM salary_data WHERE UPPER(TRIM(EmpCode)) = ? LIMIT 1`, [CODE]))
    .map((r) => Object.fromEntries(Object.entries(r).filter(([k, v]) => typeof v === "number" || /date|month|days|gross|net|ctc|ded|inc/i.test(k)))));
  await say("masjclrentry pay columns", async () => billQuery<RowDataPacket>(
    `SELECT CTC, Gross, NetInhand, bs, hra, conv, da, portf, ma, lta, mob, sa, oa, PFELig, ESIElig, Dept, Desgination, BranchName, Process FROM masjclrentry WHERE UPPER(TRIM(EmpCode)) = ? LIMIT 1`, [CODE]));
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => { await closeBillPool().catch(() => {}); process.exit(process.exitCode ?? 0); });
