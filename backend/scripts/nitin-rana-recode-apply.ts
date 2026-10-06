/**
 * Nitin Rana: employee MAS63401 (DOJ 2026-08-26, exited 2026-08-31, inactive) -> code MAS63449, active.
 * Owner decision. dry-run (default) prints preconditions, an inventory of rows tied to either code, and the plan.
 * --apply (one transaction): employees.employee_code/biometric_code -> MAS63449, active_status=1, employment_status='Active',
 * date_of_exit/date_of_leaving -> NULL; ats_candidate.employee_code MAS63401 -> MAS63449.
 * NOT touched (reported): exit_request, full_final_calculation, exit clearance, payroll lines, COSEC queue, LMS rows,
 * code-text snapshots, db_bill (read-only; it keeps MAS63401 and the exit).
 * Revert: UPDATE employees SET employee_code='MAS63401', biometric_code='MAS63401', active_status=0, employment_status=<printed>,
 * date_of_exit=<printed> WHERE id=<printed>; UPDATE ats_candidate SET employee_code='MAS63401' WHERE id=<printed>.
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { billQuery, closeBillPool } from "../src/db/billDb.js";

const OLD = "MAS63401", NEW = "MAS63449";
const APPLY = process.argv.includes("--apply");
const q = async (sql: string, p: unknown[] = []) => (await db.execute<RowDataPacket[]>(sql, p))[0];
const d10 = (v: unknown) => (v ? (v instanceof Date ? v.toLocaleDateString("en-CA") : String(v).slice(0, 10)) : null);
const fail = (m: string) => { throw new Error(`PRECONDITION FAILED: ${m}`); };
const id = (s: string) => `\`${s.replace(/`/g, "")}\``;

async function main() {
  console.log(APPLY ? "MODE: APPLY" : "MODE: DRY-RUN (no writes)");
  const emp = await q(`SELECT id, first_name, last_name, active_status, employment_status, date_of_joining, date_of_exit, date_of_leaving, biometric_code FROM employees WHERE employee_code = ?`, [OLD]);
  const taken = await q(`SELECT id FROM employees WHERE UPPER(TRIM(employee_code)) = ? OR UPPER(TRIM(biometric_code)) = ?`, [NEW, NEW]);
  if (emp.length !== 1) fail(`expected 1 employee ${OLD}, found ${emp.length}`);
  const e = emp[0];
  if (`${e.first_name} ${e.last_name ?? ""}`.trim().toUpperCase() !== "NITIN RANA") fail(`${OLD} is not Nitin Rana`);
  if (taken.length) fail(`${NEW} already on an employee row`);
  const [br] = await q(`SELECT candidate_id FROM ats_onboarding_bridge WHERE employee_code = ?`, [NEW]);
  const cand = await q(`SELECT id, full_name, employee_code FROM ats_candidate WHERE employee_code = ?`, [OLD]);
  if (!br) fail("no ATS bridge row for MAS63449");
  if (cand.length !== 1 || String(cand[0].id) !== String(br.candidate_id)) fail("ATS candidate on MAS63401 is not the bridge candidate for MAS63449");
  console.log(`OK. employee id=${e.id}; active=${e.active_status} status=${e.employment_status} doj=${d10(e.date_of_joining)} exit=${d10(e.date_of_exit)} leaving=${d10(e.date_of_leaving)} bio=${e.biometric_code}`);
  const [bill] = await billQuery<RowDataPacket>(`SELECT Status, DOL, ResignationDate FROM masjclrentry WHERE UPPER(TRIM(EmpCode)) = ?`, [OLD]);
  console.log(`db_bill ${OLD} stays as is: Status=${bill?.Status} resignation=${d10(bill?.ResignationDate)} (HRMS and db_bill will DIFFER after apply)`);

  console.log("\nINVENTORY of rows by employee id (not changed by apply unless listed in the plan):");
  const byId = await q(`SELECT TABLE_NAME t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'employee_id' AND TABLE_NAME <> 'employees'`);
  for (const r of byId) {
    try { const [n] = await q(`SELECT COUNT(*) n FROM ${id(String(r.t))} WHERE employee_id = ?`, [e.id]); if (Number(n.n) > 0) console.log(`  ${r.t}: ${n.n}`); } catch { /* view */ }
  }
  console.log("INVENTORY of code-text rows (OLD / NEW):");
  const byCode = await q(`SELECT c.TABLE_NAME t, c.COLUMN_NAME c FROM information_schema.COLUMNS c JOIN information_schema.TABLES x ON x.TABLE_SCHEMA = c.TABLE_SCHEMA AND x.TABLE_NAME = c.TABLE_NAME AND x.TABLE_TYPE = 'BASE TABLE'
      WHERE c.TABLE_SCHEMA = DATABASE() AND c.COLUMN_NAME IN ('employee_code','emp_code','biometric_code','cosec_user_id','employee_code_generated','tried_employee_code') AND c.TABLE_NAME <> 'employees'`);
  for (const r of byCode) {
    try {
      const [a] = await q(`SELECT COUNT(*) n FROM ${id(String(r.t))} WHERE UPPER(TRIM(${id(String(r.c))})) = ?`, [OLD]);
      const [b] = await q(`SELECT COUNT(*) n FROM ${id(String(r.t))} WHERE UPPER(TRIM(${id(String(r.c))})) = ?`, [NEW]);
      if (Number(a.n) || Number(b.n)) console.log(`  ${r.t}.${r.c}: ${OLD}=${a.n}  ${NEW}=${b.n}`);
    } catch { /* skip */ }
  }
  const ex = await q(`SELECT status, created_at, updated_at FROM exit_request WHERE employee_id = ?`, [e.id]);
  console.log("exit_request (left as is):", JSON.stringify(ex.map((x) => ({ status: x.status, created: d10(x.created_at), updated: d10(x.updated_at) }))));

  console.log(`\nPLAN: employees ${e.id}: employee_code ${OLD}->${NEW}, biometric_code ->${NEW}, active_status 1, employment_status 'Active', date_of_exit NULL, date_of_leaving NULL`);
  console.log(`PLAN: ats_candidate ${cand[0].id}: employee_code ${OLD}->${NEW}`);
  if (!APPLY) { console.log("\nDry-run only. Nothing written."); return; }
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [u] = await conn.execute<any>(
      `UPDATE employees SET employee_code = ?, biometric_code = ?, active_status = 1, employment_status = 'Active', date_of_exit = NULL, date_of_leaving = NULL, updated_at = NOW() WHERE id = ? AND employee_code = ?`,
      [NEW, NEW, e.id, OLD]);
    if (u.affectedRows !== 1) throw new Error(`employee update affected ${u.affectedRows}`);
    const [c] = await conn.execute<any>(`UPDATE ats_candidate SET employee_code = ? WHERE id = ? AND employee_code = ?`, [NEW, cand[0].id, OLD]);
    if (c.affectedRows !== 1) throw new Error(`candidate update affected ${c.affectedRows}`);
    await conn.commit();
    console.log("DONE: employee re-coded and active; candidate re-coded");
  } catch (err) { await conn.rollback(); throw err; } finally { conn.release(); }
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => { await closeBillPool().catch(() => {}); process.exit(process.exitCode ?? 0); });
