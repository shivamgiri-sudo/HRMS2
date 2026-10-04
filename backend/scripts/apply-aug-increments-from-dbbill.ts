/**
 * Bring HRMS salary packages up to the August increments that exist only in db_bill.
 *
 *   npx tsx scripts/apply-aug-increments-from-dbbill.ts [YYYY-MM]          # dry run (default), writes nothing
 *   npx tsx scripts/apply-aug-increments-from-dbbill.ts [YYYY-MM] --apply  # write
 *
 * Candidates: active employees whose latest db_bill salary_data row is in the given month and whose
 * Gross differs (> Rs 1) from their single active salary_component_assignments row. For each one, in a
 * transaction: supersede the active row, insert a new active row copied from that db_bill row (same
 * columns and convention as rebuild-salary-package-from-dbbill.mjs), then, after commit, recalculate the
 * month's run for exactly those employees (manual-override-locked lines are skipped by the engine).
 * Employees with no active row get one; employees with several active rows, or whose db_bill Gross is 0, are reported and left alone.
 * Re-running is a no-op once the packages agree. IDC codes are excluded.
 */
import "dotenv/config";
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db, closePool } from "../src/db/mysql.js";
import { billQuery, closeBillPool } from "../src/db/billDb.js";
import { calculatePayrollRunScoped } from "../src/modules/payroll/payrollCalculate.service.js";
import { isRunClosed } from "../src/modules/payroll/run-status.js";

const APPLY = process.argv.includes("--apply");
const MONTH = process.argv.find((a) => /^\d{4}-\d{2}$/.test(a)) ?? "2026-08";
const num = (v: unknown) => { const x = parseFloat(String(v ?? "").replace(/,/g, "")); return Number.isFinite(x) ? x : 0; };

const PKG: Array<[string, string]> = [
  ["Basic", "basic"], ["HRA", "hra"], ["Bonus", "bonus"], ["Conv", "conveyance"], ["Portfolio", "portfolio"],
  ["MedicalAllowance", "medical_allowance"], ["LTA", "lta"], ["SpecialAllowance", "special_allowance"],
  ["OtherAllowance", "other_allowance"], ["PLI1", "pli"],
];

async function main() {
  const [runs] = await db.execute<RowDataPacket[]>(`SELECT id, status FROM salary_prep_run WHERE run_month = ?`, [MONTH]);
  if ((runs as any[]).length !== 1) throw new Error(`expected exactly one run for ${MONTH}`);
  const run = (runs as any[])[0];
  if (isRunClosed(run.status)) throw new Error(`run ${run.id} is ${run.status}; closed runs are not touched`);

  const bill = await billQuery<any>(
    `SELECT TRIM(s.EmpCode) AS code, s.SalayDate, s.Basic, s.HRA, s.Bonus, s.Conv, s.Portfolio, s.MedicalAllowance,
            s.LTA, s.SpecialAllowance, s.OtherAllowance, s.PLI1, s.Gross
       FROM salary_data s
       JOIN (SELECT TRIM(EmpCode) AS code, MAX(SalayDate) AS mx FROM salary_data
              WHERE EmpCode IS NOT NULL AND TRIM(EmpCode) <> '' AND EmpCode NOT LIKE 'IDC%' GROUP BY TRIM(EmpCode)) latest
         ON latest.code = TRIM(s.EmpCode) AND latest.mx = s.SalayDate
      WHERE s.EmpCode NOT LIKE 'IDC%' AND DATE_FORMAT(s.SalayDate, '%Y-%m') = ?`,
    [MONTH],
  );
  const bMap = new Map<string, any>();
  for (const r of bill) if (!bMap.has(r.code)) bMap.set(r.code, r);
  // identity guard, same as the rebuild script: never copy an inconsistent source row
  const bad = [...bMap.values()].filter((r) => Math.abs(PKG.filter(([, c]) => c !== "pli").reduce((s, [b]) => s + num(r[b]), 0) - num(r.Gross)) > 1);
  for (const r of bad) bMap.delete(r.code);

  const [emps] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, TRIM(e.employee_code) AS code, spl.manual_override_locked AS locked
       FROM employees e LEFT JOIN salary_prep_line spl ON spl.employee_id = e.id AND spl.run_id = ?
      WHERE e.active_status = 1`, [run.id]);  // locked lines are skipped by the engine's recalculation itself
  const [asg] = await db.execute<RowDataPacket[]>(
    `SELECT id, employee_id, gross, status FROM salary_component_assignments WHERE status = 'active'`);
  const byEmp = new Map<string, any[]>();
  for (const a of asg as any[]) { if (!byEmp.has(a.employee_id)) byEmp.set(a.employee_id, []); byEmp.get(a.employee_id)!.push(a); }

  const todo: Array<{ emp: any; b: any; old: any | undefined; vals: Record<string, number> }> = [];
  const skipped: string[] = [];
  for (const emp of emps as any[]) {
    const b = bMap.get(emp.code);
    if (!b) continue;
    const act = byEmp.get(emp.id) ?? [];
    if (num(b.Gross) <= 0) { skipped.push(`${emp.code}(db_bill gross 0)`); continue; }
    if (act.length === 1 && Math.abs(num(act[0].gross) - num(b.Gross)) <= 1) continue;
    if (act.length > 1) { skipped.push(`${emp.code}(${act.length} active rows)`); continue; }
    const vals: Record<string, number> = {};
    for (const [bc, hc] of PKG) vals[hc] = num(b[bc]);
    todo.push({ emp, b, old: act[0], vals });
  }

  console.log(`${APPLY ? "APPLY" : "DRY RUN"} ${MONTH} run ${run.id} (${run.status}): ${todo.length} packages to update; ${bad.length} db_bill rows failed the sum check; ${skipped.length} skipped`);
  console.table(todo.map((t) => ({ code: t.emp.code, hrms_gross: t.old ? num(t.old.gross) : null, bill_gross: num(t.b.Gross), bill_row: String(t.b.SalayDate).slice(0, 10) })));
  if (skipped.length) console.log("skipped:", skipped.join(", "));
  if (!APPLY) { console.log("Dry run complete. Re-run with --apply to write."); return; }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    for (const t of todo) {
      if (t.old) await conn.execute(`UPDATE salary_component_assignments SET status = 'superseded' WHERE id = ? AND status = 'active'`, [t.old.id]);
      const eff = t.b.SalayDate instanceof Date ? t.b.SalayDate.toISOString().slice(0, 10) : String(t.b.SalayDate).slice(0, 10);
      await conn.execute(
        `INSERT INTO salary_component_assignments
           (id, employee_id, effective_date, basic, hra, bonus, conveyance, portfolio, medical_allowance, lta,
            special_allowance, other_allowance, pli, gross, status, approval_reference)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active','db_bill August increment')`,
        [randomUUID(), t.emp.id, eff, t.vals.basic, t.vals.hra, t.vals.bonus, t.vals.conveyance, t.vals.portfolio,
         t.vals.medical_allowance, t.vals.lta, t.vals.special_allowance, t.vals.other_allowance, t.vals.pli, num(t.b.Gross)]);
    }
    await conn.commit();
    console.log(`COMMITTED ${todo.length} package updates`);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  if (todo.length) {
    const res = await calculatePayrollRunScoped(run.id, "aug_increments_from_dbbill", { employeeIds: todo.map((t) => t.emp.id) });
    console.log(`recalculated ${todo.length} lines, run total_net ${res.total_net}`);
  }
}

main().then(async () => { await closeBillPool(); await closePool(); })
  .catch(async (e) => { console.error("ERR", e?.message ?? e); try { await closeBillPool(); await closePool(); } catch { } process.exit(1); });
