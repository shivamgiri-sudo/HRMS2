/**
 * 63388C code clash, PHASE 5 - copy Tina's db_bill Qualification into HRMS employee_education (the table HRMS uses; it is
 * not a column on employees). dry-run (default) prints the plan; --apply inserts one row if Tina has none.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { billQuery, closeBillPool } from "../src/db/billDb.js";

const APPLY = process.argv.includes("--apply");
const q = async (sql: string, p: unknown[] = []) => (await db.execute<RowDataPacket[]>(sql, p))[0];

async function main() {
  console.log(APPLY ? "MODE: APPLY" : "MODE: DRY-RUN (no writes)");
  const [tina] = await q(`SELECT id, first_name FROM employees WHERE employee_code = '63388C'`);
  const [bill] = await billQuery<RowDataPacket>(`SELECT EmpName, Qualification FROM masjclrentry WHERE UPPER(TRIM(EmpCode)) = '63388C' LIMIT 1`);
  if (!tina || !bill || String(bill.EmpName).trim().toUpperCase() !== "TINA DIPAKBHAI VALERA") throw new Error("PRECONDITION FAILED: not Tina");
  const qual = String(bill.Qualification ?? "").trim();
  if (!qual) { console.log("db_bill qualification is blank - nothing to copy"); return; }
  const have = await q(`SELECT id FROM employee_education WHERE employee_id = ?`, [tina.id]);
  console.log(`qualification "${qual}"; Tina has ${have.length} employee_education row(s)`);
  if (have.length) { console.log("already has education rows - not adding"); return; }
  console.log(`PLAN: INSERT employee_education (employee_id=${tina.id}, qualification="${qual}")`);
  if (!APPLY) { console.log("Dry-run only. Nothing written."); return; }
  await db.execute(`INSERT INTO employee_education (id, employee_id, qualification) VALUES (?, ?, ?)`, [randomUUID(), tina.id, qual]);
  console.log("INSERTED 1 employee_education row");
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => { await closeBillPool().catch(() => {}); process.exit(process.exitCode ?? 0); });
