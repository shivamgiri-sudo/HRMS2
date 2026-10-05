/**
 * 63388C code clash, PHASE 1. Two different people hold 63388C: Talabhai Thakor (HRMS, exited 2026-08-24) and
 * Tina Valera (db_bill, active). Owner decision: the db_bill person keeps 63388C.
 *
 *   dry-run (default): checks preconditions and prints every change it WOULD make. Writes nothing.
 *   --apply:           (1) re-codes Talabhai's employees row to 63388C-OLD (employee_code + biometric_code),
 *                      (2) creates Tina as 63388C through the existing employee sync (employeeSyncHandler),
 *                      (3) sets branch_id / department_id / designation_id / cost_centre_id / process_id on her
 *                          row by EXACT name match against the HRMS masters. A name with no single matching
 *                          master is reported and left NULL - masters are never created here.
 * Not touched here (later phases, after review): code-text rows (legacy snapshots, PnL, ATS bridge), salary
 * assignment, attendance, the August payroll line.
 * Revert for step (1), only if Tina's row was not created:
 *   UPDATE employees SET employee_code='63388C', biometric_code='63388C' WHERE id=<printed id>;
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { billQuery, closeBillPool } from "../src/db/billDb.js";
import { employeeSyncHandler } from "../src/workers/domains/employee-sync-handler.js";

const CODE = "63388C";
const OLD = "63388C-OLD";
const APPLY = process.argv.includes("--apply");
const q = async (sql: string, p: unknown[] = []) => (await db.execute<RowDataPacket[]>(sql, p))[0];

const MASTERS: Array<{ col: string; table: string; nameCol: string; billCol: string }> = [
  { col: "branch_id", table: "branch_master", nameCol: "branch_name", billCol: "BranchName" },
  { col: "department_id", table: "department_master", nameCol: "dept_name", billCol: "Dept" },
  { col: "designation_id", table: "designation_master", nameCol: "designation_name", billCol: "Desgination" },
  { col: "cost_centre_id", table: "cost_centre_master", nameCol: "cost_centre_name", billCol: "CostCenter" },
  { col: "process_id", table: "process_master", nameCol: "process_name", billCol: "Process" },
];

async function main() {
  console.log(APPLY ? "MODE: APPLY" : "MODE: DRY-RUN (no writes)");
  const hr = await q(`SELECT id, first_name, last_name FROM employees WHERE employee_code = ?`, [CODE]);
  const old = await q(`SELECT id FROM employees WHERE employee_code = ?`, [OLD]);
  const [bill] = await billQuery<RowDataPacket>(`SELECT * FROM masjclrentry WHERE UPPER(TRIM(EmpCode)) = ? LIMIT 1`, [CODE]);
  const fail = (m: string) => { console.error(`PRECONDITION FAILED: ${m}`); process.exitCode = 2; };

  if (hr.length !== 1) return fail(`expected exactly 1 HRMS row for ${CODE}, found ${hr.length} (already moved?)`);
  const hrName = `${hr[0].first_name} ${hr[0].last_name ?? ""}`.trim().toUpperCase();
  if (hrName !== "TALABHAI THAKOR") return fail(`HRMS ${CODE} is "${hrName}", not TALABHAI THAKOR`);
  if (old.length) return fail(`${OLD} already exists in HRMS`);
  if (!bill) return fail(`no db_bill row for ${CODE}`);
  const billName = String(bill.EmpName ?? "").trim().toUpperCase();
  if (billName !== "TINA DIPAKBHAI VALERA") return fail(`db_bill ${CODE} is "${billName}", not TINA DIPAKBHAI VALERA`);
  console.log(`preconditions OK. Talabhai id=${hr[0].id}; db_bill person=${billName}`);

  console.log(`\nSTEP 1  employees: ${CODE} -> ${OLD} (employee_code, biometric_code) for id=${hr[0].id}`);
  console.log(`STEP 2  create ${CODE} from db_bill via employeeSyncHandler (status=${bill.Status}, DOJ=${bill.DOJ instanceof Date ? bill.DOJ.toLocaleDateString("en-CA") : String(bill.DOJ)} local, ${bill.DOJ instanceof Date ? bill.DOJ.toISOString() : ""} utc)`);
  const plan: Array<{ col: string; name: string; id: string | null }> = [];
  for (const m of MASTERS) {
    const name = String(bill[m.billCol] ?? "").trim();
    let id: string | null = null;
    if (name) {
      const r = await q(`SELECT id FROM ${m.table} WHERE UPPER(TRIM(${m.nameCol})) = ?`, [name.toUpperCase()]);
      if (r.length === 1) id = String(r[0].id);
      else if (r.length > 1) {
        // Ambiguous name: take the master that most employees at the same cost centre already use, only on a clear winner.
        const ids = r.map((x) => String(x.id));
        const ph = ids.map(() => "?").join(",");
        const use = await q(
          `SELECT ${m.col} AS mid, COUNT(*) n FROM employees
            WHERE ${m.col} IN (${ph}) AND cost_centre_id = (SELECT id FROM cost_centre_master WHERE UPPER(TRIM(cost_centre_name)) = ? LIMIT 1)
            GROUP BY ${m.col} ORDER BY n DESC`,
          [...ids, String(bill.CostCenter ?? "").trim().toUpperCase()]);
        console.log(`  NOTE ${m.col}: "${name}" matches ${r.length} rows; usage at this cost centre: ${JSON.stringify(use)}`);
        if (use.length >= 1 && (use.length === 1 || Number(use[0].n) > Number(use[1].n))) id = String(use[0].mid);
        else console.log(`  WARNING ${m.col}: no clear winner - will be left NULL`);
      } else console.log(`  WARNING ${m.col}: "${name}" matches 0 rows in ${m.table} - will be left NULL`);
    }
    plan.push({ col: m.col, name, id });
    console.log(`STEP 3  ${m.col} <- ${m.table} "${name || "(blank in db_bill)"}" -> ${id ?? "NULL"}`);
  }
  if (!APPLY) { console.log("\nDry-run only. Nothing written."); return; }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [u] = await conn.execute<any>(
      `UPDATE employees SET employee_code = ?, biometric_code = ?, updated_at = NOW() WHERE id = ? AND employee_code = ?`,
      [OLD, OLD, hr[0].id, CODE]);
    if (u.affectedRows !== 1) throw new Error(`re-code affected ${u.affectedRows} rows`);
    await conn.commit();
    console.log(`STEP 1 done: Talabhai is now ${OLD}`);
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }

  const rec = employeeSyncHandler.transform(bill as never);
  const res = await employeeSyncHandler.syncToHRMS([rec]);
  console.log("STEP 2 sync result:", JSON.stringify(res));
  if (res.errors || res.inserted !== 1) throw new Error("Tina was not created as a single insert; inspect, then revert step 1 if needed");

  const [tina] = await q(`SELECT id FROM employees WHERE employee_code = ?`, [CODE]);
  const found = plan.filter((p) => p.id);
  if (found.length) {
    await db.execute(
      `UPDATE employees SET ${found.map((p) => `${p.col} = ?`).join(", ")}, employment_status = 'Active', updated_at = NOW() WHERE id = ?`,
      [...found.map((p) => p.id), tina.id]);
  }
  console.log(`STEP 3 done for new id=${tina.id}`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => { await closeBillPool().catch(() => {}); process.exit(process.exitCode ?? 0); });
