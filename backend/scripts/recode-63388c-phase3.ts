/**
 * 63388C code clash, PHASE 3 - the August payroll line that belongs to Tina (db_bill paid 63388C: gross 8000, net 2839)
 * is attached to Talabhai (63388C-OLD). Re-point that one salary_prep_line row, and its salary_prep_line_component row,
 * to Tina. dry-run (default) prints the plan; --apply moves them in one transaction.
 * Refuses unless: the run is not closed, the line equals db_bill's gross and net, Tina has no line in that run.
 * Nothing is recalculated and no amount changes - the stored line already equals db_bill.
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { billQuery, closeBillPool } from "../src/db/billDb.js";

const MONTH = "2026-08";
const APPLY = process.argv.includes("--apply");
const q = async (sql: string, p: unknown[] = []) => (await db.execute<RowDataPacket[]>(sql, p))[0];
const fail = (m: string) => { throw new Error(`PRECONDITION FAILED: ${m}`); };

async function main() {
  console.log(APPLY ? "MODE: APPLY" : "MODE: DRY-RUN (no writes)");
  const [run] = await q(`SELECT id, status FROM salary_prep_run WHERE run_month = ?`, [MONTH]);
  if (!run) fail(`no run for ${MONTH}`);
  if (/closed|final|paid|locked/i.test(String(run.status))) fail(`run is ${run.status}`);
  const [old] = await q(`SELECT id FROM employees WHERE employee_code = '63388C-OLD'`);
  const [tina] = await q(`SELECT id FROM employees WHERE employee_code = '63388C'`);
  if (!old || !tina) fail("need both 63388C-OLD and 63388C employee rows");
  const lines = await q(`SELECT id, gross_salary, net_salary, status FROM salary_prep_line WHERE run_id = ? AND employee_id = ?`, [run.id, old.id]);
  const tinaLines = await q(`SELECT id FROM salary_prep_line WHERE run_id = ? AND employee_id = ?`, [run.id, tina.id]);
  if (lines.length !== 1) fail(`expected exactly 1 line on 63388C-OLD, found ${lines.length}`);
  if (tinaLines.length) fail("Tina already has a line in this run");
  const [bill] = await billQuery<RowDataPacket>(
    `SELECT Gross, NetSalary FROM salary_data WHERE UPPER(TRIM(EmpCode)) = '63388C' AND DATE_FORMAT(SalDate,'%Y-%m') = ?`, [MONTH]);
  if (!bill) fail("no db_bill salary_data row");
  const same = Math.round(Number(lines[0].gross_salary)) === Math.round(Number(bill.Gross)) && Math.round(Number(lines[0].net_salary)) === Math.round(Number(bill.NetSalary));
  console.log(`run ${run.id} (${run.status}); line ${lines[0].id} status=${lines[0].status} gross=${lines[0].gross_salary} net=${lines[0].net_salary}; db_bill gross=${bill.Gross} net=${bill.NetSalary}`);
  if (!same) fail("the stored line does not equal db_bill's gross/net - not moving it");
  const comps = await q(`SELECT COUNT(*) n FROM salary_prep_line_component WHERE run_id = ? AND employee_id = ?`, [run.id, old.id]);
  console.log(`PLAN: salary_prep_line ${lines[0].id}: employee_id ${old.id} -> ${tina.id}, employee_code -> 63388C; component rows to move: ${comps[0].n}`);
  if (!APPLY) { console.log("Dry-run only. Nothing written."); return; }
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [a] = await conn.execute<any>(`UPDATE salary_prep_line SET employee_id = ?, employee_code = '63388C' WHERE id = ? AND run_id = ? AND employee_id = ?`, [tina.id, lines[0].id, run.id, old.id]);
    if (a.affectedRows !== 1) throw new Error(`line update affected ${a.affectedRows}`);
    const [b] = await conn.execute<any>(`UPDATE salary_prep_line_component SET employee_id = ? WHERE run_id = ? AND employee_id = ?`, [tina.id, run.id, old.id]);
    if (b.affectedRows !== Number(comps[0].n)) throw new Error(`component update affected ${b.affectedRows}, expected ${comps[0].n}`);
    await conn.commit();
    console.log(`MOVED: 1 line + ${b.affectedRows} component row(s) to Tina`);
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => { await closeBillPool().catch(() => {}); process.exit(process.exitCode ?? 0); });
