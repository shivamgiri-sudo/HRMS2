/**
 * STRICTLY READ-ONLY. August 2026 payroll lines for both people behind the 63388C clash (Talabhai = 63388C-OLD,
 * Tina = 63388C) versus what db_bill paid for 63388C. Prints amounts, days and flags only - no names or identifiers.
 *   npx tsx scripts/recode-63388c-payroll-check.ts [YYYY-MM]
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { billQuery, closeBillPool } from "../src/db/billDb.js";

const MONTH = process.argv[2] ?? "2026-08";
const q = async (sql: string, p: unknown[] = []) => (await db.execute<RowDataPacket[]>(sql, p))[0];
const nums = (r: RowDataPacket) => Object.fromEntries(Object.entries(r).filter(([k, v]) =>
  v !== null && (typeof v === "number" || (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v))) && !/(^id$|_id$|uuid|version)/i.test(k)));

async function main() {
  const [run] = await q(`SELECT id, status FROM salary_prep_run WHERE run_month = ?`, [MONTH]);
  console.log(`run ${MONTH}: ${run ? `${run.id} status=${run.status}` : "none"}`);
  if (!run) return;
  for (const code of ["63388C-OLD", "63388C"]) {
    const [e] = await q(`SELECT id, active_status FROM employees WHERE employee_code = ?`, [code]);
    console.log(`\n=== HRMS ${code} ===`, e ? `active_status=${e.active_status}` : "no employee row");
    if (!e) continue;
    const lines = await q(`SELECT * FROM salary_prep_line WHERE run_id = ? AND employee_id = ?`, [run.id, e.id]);
    console.log("salary_prep_line rows:", lines.length);
    for (const l of lines) {
      console.log(JSON.stringify({ status: l.status, manual_override_locked: l.manual_override_locked, ...nums(l) }));
    }
    const comps = await q(`SELECT COUNT(*) n FROM salary_prep_line_component WHERE employee_id = ? AND run_id = ?`, [e.id, run.id]).catch(() => [{ n: "n/a" }]);
    console.log("salary_prep_line_component rows:", JSON.stringify(comps[0]));
  }
  console.log("\n=== db_bill salary_data for 63388C ===");
  const sd = await billQuery<RowDataPacket>(
    `SELECT SalDate, Gross, WorkingDays, ActualDays, Holidays, EarnedDays, Gross1, Incentive, IncomeTax, LoanDed, TotalDeduction, NetSalary
       FROM salary_data WHERE UPPER(TRIM(EmpCode)) = '63388C' AND DATE_FORMAT(SalDate,'%Y-%m') = ?`, [MONTH]);
  for (const r of sd) console.log(JSON.stringify(r));
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => { await closeBillPool().catch(() => {}); process.exit(process.exitCode ?? 0); });
