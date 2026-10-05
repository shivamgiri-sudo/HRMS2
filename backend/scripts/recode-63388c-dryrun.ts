/**
 * STRICTLY READ-ONLY dry-run for the 63388C code clash (two different people, one code).
 * Prints counts only (no names / identifiers): which HRMS tables reference the existing 63388C employee,
 * which db_bill tables hold rows for the db_bill 63388C, and what an import of the db_bill person would
 * touch. HRMS via SELECT; db_bill via billQuery() (SELECT allowlist).
 *   npx tsx scripts/recode-63388c-dryrun.ts [CODE]
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { billQuery, closeBillPool } from "../src/db/billDb.js";

const CODE = (process.argv[2] ?? "63388C").toUpperCase();
const ident = (s: string) => `\`${s.replace(/`/g, "")}\``;

async function main() {
  const [emp] = await db.execute<RowDataPacket[]>(
    `SELECT id, employee_code, biometric_code, active_status FROM employees WHERE UPPER(TRIM(employee_code)) = ?`, [CODE]);
  console.log(`HRMS employees rows for ${CODE}: ${emp.length}`);
  if (emp.length !== 1) return;
  const id = String(emp[0].id);
  console.log(`biometric_code equals code: ${String(emp[0].biometric_code ?? "").toUpperCase() === CODE}`);

  const [cols] = await db.execute<RowDataPacket[]>(
    `SELECT TABLE_NAME t, COLUMN_NAME c FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME NOT IN ('employees')
        AND (COLUMN_NAME IN ('employee_id','emp_id') OR COLUMN_NAME IN ('employee_code','emp_code','biometric_code','bio_code'))
        AND TABLE_NAME NOT LIKE 'v\\_%'`);
  console.log("\nHRMS tables with rows for the EXISTING 63388C employee (by id, or by code text):");
  for (const r of cols) {
    const t = String(r.t), c = String(r.c);
    const byId = c === "employee_id" || c === "emp_id";
    try {
      const [n] = await db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) n FROM ${ident(t)} WHERE ${ident(c)} = ?`, [byId ? id : CODE]);
      if (Number(n[0].n) > 0) console.log(`  ${t}.${c} (${byId ? "id" : "code text"}): ${n[0].n}`);
    } catch { /* view or unreadable table */ }
  }

  console.log("\ndb_bill tables with rows for the db_bill 63388C:");
  const bcols = await billQuery<RowDataPacket>(
    `SELECT TABLE_NAME t, COLUMN_NAME c FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME IN ('EmpCode','Empcode','empcode','EmpID','EmpId','emp_code')`);
  for (const r of bcols) {
    try {
      const n = await billQuery<RowDataPacket>(
        `SELECT COUNT(*) n FROM ${ident(String(r.t))} WHERE UPPER(TRIM(${ident(String(r.c))})) = ?`, [CODE]);
      if (Number(n[0].n) > 0) console.log(`  ${r.t}.${r.c}: ${n[0].n}`);
    } catch { /* skip */ }
  }
  const dates = await billQuery<RowDataPacket>(
    `SELECT MIN(AttandDate) first_day, MAX(AttandDate) last_day, COUNT(*) n FROM Attandence WHERE UPPER(TRIM(EmpCode)) = ?`, [CODE]).catch(() => []);
  console.log("\ndb_bill Attandence range:", JSON.stringify(dates));
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => { await closeBillPool().catch(() => {}); process.exit(process.exitCode ?? 0); });
