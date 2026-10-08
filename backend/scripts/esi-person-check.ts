/**
 * Why is an employee on the ESI Registration screen? READ-ONLY.
 *   npx tsx scripts/esi-person-check.ts MAS63459 MAS12345
 * Prints every input the screen (and the payroll engine) uses to decide ESI applicability.
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { billQuery } from "../src/db/billDb.js";
import type { RowDataPacket } from "mysql2";
import { ESI_STILL_APPLICABLE_SQL } from "../src/modules/payroll/esi-pending.query.js";

const show = (label: string, rows: RowDataPacket[]) => {
  console.log(`  -- ${label}`);
  if (!rows.length) console.log("     (none)");
  for (const r of rows) console.log("     " + Object.entries(r).map(([k, v]) => `${k}=${v instanceof Date ? v.toISOString().slice(0, 10) : v}`).join("  "));
};
const run = async (label: string, sql: string, params: unknown[]) => {
  try { const [rows] = await db.execute<RowDataPacket[]>(sql, params as never[]); show(label, rows as RowDataPacket[]); }
  catch (e) { console.log(`  -- ${label} FAILED: ${(e as Error).message}`); }
};

(async () => {
  const codes = process.argv.slice(2).join(" ").split(/[\s,;]+/).filter(Boolean);
  for (const code of codes) {
    const [emps] = await db.execute<RowDataPacket[]>(
      `SELECT id, employee_code, first_name, last_name, active_status, employment_status, date_of_joining, salary_start_date, esic_number, created_at
         FROM employees WHERE employee_code = ? LIMIT 1`, [code]);
    const e = (emps as RowDataPacket[])[0];
    console.log(`\n##### ${code}`);
    if (!e) { console.log("  not found"); continue; }
    show("employee", [e]);
    await run("statutory_info (flag the ESI screen trusts)", `SELECT esi_eligible, esi_number, pf_eligible, epf_number, created_at, updated_at FROM employee_statutory_info WHERE employee_id = ?`, [e.id]);
    await run("statutory overrides (opt-outs)", `SELECT override_type, status, effective_from_month FROM employee_statutory_override WHERE employee_id = ?`, [e.id]);
    await run("latest salary snapshots", `SELECT effective_date, gross, basic FROM employee_salary_snapshot WHERE employee_id = ? ORDER BY effective_date DESC LIMIT 3`, [e.id]);
    await run("ESI Reg screen rule (flag + opt-out + ceiling): would be LISTED?", `SELECT IF(esi.esi_eligible = 1 AND ${ESI_STILL_APPLICABLE_SQL}, 'YES', 'NO') AS listed FROM employees e LEFT JOIN employee_statutory_info esi ON esi.employee_id = e.id WHERE e.id = ?`, [e.id]);
    try {
      const [o] = await db.execute<RowDataPacket[]>(`SELECT o.* FROM ats_onboarding_bridge b JOIN ats_employment_offer o ON o.candidate_id = b.candidate_id WHERE b.employee_id = ? ORDER BY o.created_at DESC LIMIT 1`, [e.id]);
      show("ATS offer (money / ESI columns only)", (o as RowDataPacket[]).map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => /gross|ctc|esi|pf_el|salary/i.test(k))) as unknown as RowDataPacket));
    } catch (err) { console.log(`  -- offer FAILED: ${(err as Error).message}`); }
    await run("offer esi_eligible (ATS)", `SELECT o.esi_eligible, o.pf_eligible FROM ats_onboarding_bridge b JOIN ats_employment_offer o ON o.candidate_id = b.candidate_id WHERE b.employee_id = ? ORDER BY o.created_at DESC LIMIT 2`, [e.id]);
    try {
      const rows = await billQuery<RowDataPacket>(
        `SELECT DATE_FORMAT(SalDate, '%Y-%m') AS month, PFELig, ESIElig FROM salary_data WHERE EmpCode = ? ORDER BY SalDate DESC LIMIT 3`, [code]);
      show("db_bill salary_data (ESIElig actually applied when paid)", rows as RowDataPacket[]);
    } catch (err) { console.log(`  -- db_bill FAILED: ${(err as Error).message}`); }
  }
  process.exit(0);
})();
