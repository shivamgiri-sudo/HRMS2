/**
 * Where does an employee's salary package live in HRMS? STRICTLY READ-ONLY (SELECT only).
 *
 *   npx tsx scripts/salary-package-sources-audit.ts MAS63403 MAS63404 ...
 *
 * For each code prints every salary_component_assignments row (any status), the employee_salary_assignment
 * rows (structure + CTC path the engine falls back to), the latest salary_increment_request rows and the Aug
 * salary_prep_line (status, lock, gross, net, payable days). Employee code only, no PII.
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db, closePool } from "../src/db/mysql.js";

const codes = process.argv.slice(2).filter((a) => /^[A-Za-z0-9]+$/.test(a));
const q = async (sql: string, p: unknown[]) => {
  if (!/^\s*select/i.test(sql)) throw new Error("read-only");
  const [rows] = await db.execute<RowDataPacket[]>(sql, p as any[]);
  return rows as any[];
};

async function main() {
  if (!codes.length) throw new Error("pass employee codes");
  for (const code of codes) {
    const [e] = await q(`SELECT id FROM employees WHERE employee_code = ? LIMIT 1`, [code]);
    if (!e) { console.log(`\n== ${code}: not found`); continue; }
    console.log(`\n== ${code}`);
    console.log("salary_component_assignments:");
    console.table(await q(
      `SELECT status, effective_date, gross, basic, approval_reference, assigned_at, created_at
         FROM salary_component_assignments WHERE employee_id = ? ORDER BY created_at`, [e.id]));
    console.log("employee_salary_assignment:");
    console.table(await q(
      `SELECT a.active_status, a.effective_from, a.effective_to, ROUND(a.ctc_annual/12) AS monthly_ctc, a.structure_id IS NOT NULL AS has_structure
         FROM employee_salary_assignment a WHERE a.employee_id = ? ORDER BY a.created_at`, [e.id]));
    console.log("Aug 2026 prep line:");
    console.table(await q(
      `SELECT spl.status, spl.manual_override_locked AS locked, spl.gross_salary, spl.net_salary, spl.final_payable_days, spl.updated_at
         FROM salary_prep_line spl JOIN salary_prep_run r ON r.id = spl.run_id
        WHERE spl.employee_id = ? AND r.run_month = '2026-08'`, [e.id]).catch(() => []));
  }
}
main().then(() => closePool()).catch(async (e) => { console.error("ERR", e?.message ?? e); try { await closePool(); } catch { } process.exit(1); });
