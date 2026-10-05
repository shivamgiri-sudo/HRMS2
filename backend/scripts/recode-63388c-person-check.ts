/**
 * STRICTLY READ-ONLY. Are the HRMS and db_bill 63388C the same person? Prints name, DOB, cost centre, last-4 of
 * mobile (never full mobile / PAN / Aadhaar), then what activity exists after the HRMS exit date and the state
 * of the HRMS exit request. HRMS via SELECT; db_bill via billQuery() (SELECT allowlist).
 *   npx tsx scripts/recode-63388c-person-check.ts [CODE]
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { billQuery, closeBillPool } from "../src/db/billDb.js";

const CODE = (process.argv[2] ?? "63388C").toUpperCase();
const d10 = (v: unknown) => (v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 10) : null);
const last4 = (v: unknown) => String(v ?? "").replace(/\D/g, "").slice(-4) || null;
const q = async (sql: string, p: unknown[] = []) => (await db.execute<RowDataPacket[]>(sql, p))[0];
const safe = async <T,>(label: string, f: () => Promise<T>) => { try { return await f(); } catch (e) { console.log(`  [${label} failed: ${(e as Error).message.slice(0, 120)}]`); return null; } };

async function main() {
  const [h] = await q(
    `SELECT e.id, e.first_name, e.last_name, e.date_of_birth, e.mobile, e.date_of_joining, e.date_of_exit, e.cost_centre_id,
            (SELECT cost_centre_name FROM cost_centre_master c WHERE c.id = e.cost_centre_id) AS cost_centre
       FROM employees e WHERE UPPER(TRIM(e.employee_code)) = ?`, [CODE]);
  const [b] = await billQuery<RowDataPacket>(
    `SELECT EmpName, DOB, Mobile, DOJ, CostCenter, Status FROM masjclrentry WHERE UPPER(TRIM(EmpCode)) = ? LIMIT 1`, [CODE]);
  const hName = `${h?.first_name ?? ""} ${h?.last_name ?? ""}`.trim().toUpperCase();
  const bName = String(b?.EmpName ?? "").trim().toUpperCase();
  console.log("HRMS    :", JSON.stringify({ name: hName, dob: d10(h?.date_of_birth), mobile_last4: last4(h?.mobile), doj: d10(h?.date_of_joining), exit: d10(h?.date_of_exit), cost_centre: h?.cost_centre }));
  console.log("db_bill :", JSON.stringify({ name: bName, dob: d10(b?.DOB), mobile_last4: last4(b?.Mobile), doj: d10(b?.DOJ), cost_centre: b?.CostCenter, status: b?.Status }));
  console.log("same name:", hName === bName, "| same DOB:", d10(h?.date_of_birth) === d10(b?.DOB),
    "| same mobile last4:", last4(h?.mobile) !== null && last4(h?.mobile) === last4(b?.Mobile));
  if (!h) return;
  const id = String(h.id), exit = d10(h.date_of_exit) ?? "2026-08-24";

  console.log(`\nHRMS activity AFTER exit date (${exit}):`);
  await safe("attendance", async () => console.log("  attendance_daily_record by status:", JSON.stringify(
    await q(`SELECT attendance_status s, COUNT(*) n, MIN(record_date) first_day, MAX(record_date) last_day FROM attendance_daily_record WHERE employee_id = ? AND record_date > ? GROUP BY attendance_status`, [id, exit]))));
  await safe("biometric", async () => console.log("  biometric_attendance_log:", JSON.stringify(
    await q(`SELECT COUNT(*) n, MIN(DATE(punch_time)) first_day, MAX(DATE(punch_time)) last_day FROM biometric_attendance_log WHERE employee_id = ?`, [id]))));
  await safe("exit_request", async () => console.log("  exit_request:", JSON.stringify(
    await q(`SELECT status, created_at, updated_at FROM exit_request WHERE employee_id = ? ORDER BY created_at DESC LIMIT 3`, [id]))));
  await safe("payroll", async () => console.log("  salary_prep_line:", JSON.stringify(
    await q(`SELECT * FROM salary_prep_line WHERE employee_id = ? LIMIT 0`, [id]).then(async () => q(`SELECT COUNT(*) n FROM salary_prep_line WHERE employee_id = ?`, [id])))));

  console.log("\ndb_bill activity:");
  await safe("bill attendance", async () => console.log("  Attandence by status:", JSON.stringify(
    await billQuery<RowDataPacket>(`SELECT Status s, COUNT(*) n, MIN(AttandDate) first_day, MAX(AttandDate) last_day FROM Attandence WHERE UPPER(TRIM(EmpCode)) = ? GROUP BY Status`, [CODE]))));
  await safe("bill salary", async () => console.log("  salary_data rows:", (await billQuery<RowDataPacket>(`SELECT COUNT(*) n FROM salary_data WHERE UPPER(TRIM(EmpCode)) = ?`, [CODE]))[0]?.n));
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => { await closeBillPool().catch(() => {}); process.exit(process.exitCode ?? 0); });
