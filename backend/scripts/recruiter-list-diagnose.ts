/**
 * Why is an employee missing from the candidate-registration recruiter dropdown? STRICTLY READ-ONLY.
 *
 *   npx tsx scripts/recruiter-list-diagnose.ts [EMPLOYEE_CODE] [BRANCH_DISPLAY_NAME]
 *
 * Prints the employee's branch/department/designation/status, roster rows, branch aliases that
 * look like the branch, and what the live recruiters-by-branch lookup returns for the given
 * branch names (the one the form sends). Output is employee_code + names only.
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { atsFormConfigService } from "../src/modules/ats/ats-form-config.service.js";

const CODE = process.argv[2] ?? "MAS63582";
const BRANCHES = process.argv.slice(3).length ? process.argv.slice(3) : ["Noida 2", "NOIDA-2", "Noida-2", "NOIDA 2"];

async function main() {
  const [emp] = await db.execute<RowDataPacket[]>(
    `SELECT e.employee_code, e.active_status, e.branch_id, b.branch_name, b.branch_code,
            d.dept_name, des.designation_name, e.user_id
       FROM employees e
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN department_master d ON d.id = e.department_id
       LEFT JOIN designation_master des ON des.id = e.designation_id
      WHERE e.employee_code = ?`, [CODE]);
  console.log("EMPLOYEE", JSON.stringify(emp, null, 1));

  const [roster] = await db.execute<RowDataPacket[]>(
    `SELECT r.branch, r.active_status, r.active_flag FROM ats_recruiter_roster r
       JOIN employees e ON e.id = r.employee_id WHERE e.employee_code = ?`, [CODE]);
  console.log("ROSTER ROWS", JSON.stringify(roster));

  const [aliases] = await db.execute<RowDataPacket[]>(
    `SELECT canonical_key, display_name, alias_text, active_status FROM ats_branch_alias_master
      WHERE LOWER(display_name) LIKE '%noida%' OR LOWER(canonical_key) LIKE '%noida%' OR LOWER(alias_text) LIKE '%noida%'`);
  console.log("NOIDA ALIASES", JSON.stringify(aliases));

  const [bm] = await db.execute<RowDataPacket[]>(
    `SELECT branch_name, branch_code, active_status FROM branch_master WHERE LOWER(branch_name) LIKE '%noida%' OR LOWER(branch_code) LIKE '%noida%'`);
  console.log("NOIDA BRANCH_MASTER", JSON.stringify(bm));

  for (const b of BRANCHES) {
    const list = await atsFormConfigService.getRecruitersByBranch(b);
    console.log(`LOOKUP "${b}" -> ${list.length} rows; includes ${CODE}: ${list.some((r) => r.employee_code === CODE)}`);
    console.log("  ", list.map((r) => r.employee_code).join(", "));
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
