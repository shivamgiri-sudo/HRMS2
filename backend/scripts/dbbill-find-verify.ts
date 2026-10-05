/**
 * STRICTLY READ-ONLY, db_bill only. Find an employee by code fragment or by name in masjclrentry and print code, name,
 * dates, status, org (no PAN/Aadhaar/mobile). Then, for each hit, whether HRMS has that code and under which name.
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { billQuery, closeBillPool } from "../src/db/billDb.js";

const d10 = (v: unknown) => (v ? (v instanceof Date ? v.toLocaleDateString("en-CA") : String(v).slice(0, 10)) : null);

async function main() {
  const rows = await billQuery<RowDataPacket>(
    `SELECT EmpCode, EmpName, DOB, DOJ, DOL, Status, left_type, ResignationDate, BranchName, CostCenter, Desgination, lastUpdated
       FROM masjclrentry
      WHERE (UPPER(EmpName) LIKE 'NITISH%' AND UPPER(EmpName) LIKE '%RANA%') OR UPPER(EmpName) LIKE 'NITESH%RANA%'
         OR UPPER(EmpName) LIKE 'NITISH%' AND UPPER(EmpName) LIKE '%RAN%' OR UPPER(TRIM(EmpCode)) LIKE '%63449%'
      ORDER BY EmpCode LIMIT 30`);
  console.log("db_bill matches:", rows.length);
  for (const r of rows) {
    console.log(" ", JSON.stringify({ ...r, DOB: d10(r.DOB), DOJ: d10(r.DOJ), DOL: d10(r.DOL), ResignationDate: d10(r.ResignationDate), lastUpdated: d10(r.lastUpdated) }));
    const [h] = (await db.execute<RowDataPacket[]>(`SELECT employee_code, first_name, last_name, active_status, date_of_exit FROM employees WHERE UPPER(TRIM(employee_code)) = ?`, [String(r.EmpCode).trim().toUpperCase()]))[0];
    console.log("    HRMS:", h ? JSON.stringify({ code: h.employee_code, name: `${h.first_name} ${h.last_name ?? ""}`.trim(), active: h.active_status, exit: d10(h.date_of_exit) }) : "no employee with this code");
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => { await closeBillPool().catch(() => {}); process.exit(process.exitCode ?? 0); });
