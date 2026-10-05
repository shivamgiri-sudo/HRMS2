/**
 * STRICTLY READ-ONLY, HRMS only. Find an employee by name variants or code fragment; print code, name, dates, status,
 * org, and whether db_bill has that code. No PAN/Aadhaar/mobile printed.
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { billQuery, closeBillPool } from "../src/db/billDb.js";

const d10 = (v: unknown) => (v ? (v instanceof Date ? v.toLocaleDateString("en-CA") : String(v).slice(0, 10)) : null);

async function main() {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code, e.first_name, e.last_name, e.date_of_joining, e.date_of_exit, e.date_of_leaving, e.active_status, e.employment_status,
            (SELECT branch_name FROM branch_master WHERE id=e.branch_id) branch,
            (SELECT cost_centre_name FROM cost_centre_master WHERE id=e.cost_centre_id) cc
       FROM employees e
      WHERE UPPER(CONCAT(e.first_name,' ',IFNULL(e.last_name,''))) LIKE '%RANA%'
        AND (UPPER(CONCAT(e.first_name,' ',IFNULL(e.last_name,''))) LIKE '%NIT%' OR UPPER(CONCAT(e.first_name,' ',IFNULL(e.last_name,''))) LIKE '%NEET%')
         OR UPPER(e.employee_code) LIKE '%63449%'
      ORDER BY e.employee_code LIMIT 30`);
  console.log("HRMS matches:", rows.length);
  for (const r of rows) {
    console.log(" ", JSON.stringify({ code: r.employee_code, name: `${r.first_name} ${r.last_name ?? ""}`.trim(), doj: d10(r.date_of_joining), exit: d10(r.date_of_exit), leaving: d10(r.date_of_leaving), active: r.active_status, status: r.employment_status, branch: r.branch, cc: r.cc }));
    const b = await billQuery<RowDataPacket>(`SELECT EmpName, DOJ, DOL, Status FROM masjclrentry WHERE UPPER(TRIM(EmpCode)) = ? LIMIT 1`, [String(r.employee_code).trim().toUpperCase()]);
    console.log("    db_bill:", b[0] ? JSON.stringify({ name: String(b[0].EmpName).trim(), doj: d10(b[0].DOJ), dol: d10(b[0].DOL), status: b[0].Status }) : "no row with this code");
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => { await closeBillPool().catch(() => {}); process.exit(process.exitCode ?? 0); });
