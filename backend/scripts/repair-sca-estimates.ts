/**
 * Repair the stored display estimates on package rows made by the db_bill increment syncs.
 *
 *   npx tsx scripts/repair-sca-estimates.ts            # dry run (default), writes nothing
 *   npx tsx scripts/repair-sca-estimates.ts --apply    # write, one transaction
 *
 * Rows: status active, package_id NULL, approval_reference 'db_bill increment 2026-08' or 'db_bill August increment'.
 * The first sync left net_estimate at nonsense values (Rs 3,647 on a Rs 38,398 gross, 31 rows) and zero employee PF /
 * employer PF; the second left net_estimate and ctc NULL (10 rows). Sets pf_employee, esic_employee, employer_pf,
 * employer_esi and net_estimate from the row's own components and PF/ESIC flags (salary-estimates.ts); ctc only when it
 * is NULL. Components, gross, flags and effective dates are not touched, and payroll does not read these fields.
 * The 10 'db_bill August increment' rows were inserted without PF/ESIC flags (defaults), so their flags are first taken from
 * db_bill's latest PFELig / ESIElig for the employee (YES/NO) and written with the estimates.
 * Only rows whose net is missing or more than Rs 50 off, or whose ctc is NULL, or whose flags need setting, are changed.
 * Re-running is a no-op.
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db, closePool } from "../src/db/mysql.js";
import { billQuery, closeBillPool } from "../src/db/billDb.js";
import { deriveSalaryEstimates } from "../src/modules/salary-change/salary-estimates.js";

const APPLY = process.argv.includes("--apply");
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

async function main() {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT s.id, e.employee_code, s.approval_reference, s.gross, s.basic, s.pf_applicable, s.esi_applicable, s.net_estimate, s.ctc, s.employer_pf, s.employer_esi, s.pf_employee, s.esic_employee
       FROM salary_component_assignments s JOIN employees e ON e.id = s.employee_id
      WHERE s.status = 'active' AND s.package_id IS NULL AND s.approval_reference IN ('db_bill increment 2026-08', 'db_bill August increment')`);
  const todo: any[] = [];
  for (const r0 of rows as any[]) {
    let r = r0;
    let flagsFromBill = false;
    if (String(r0.approval_reference) === "db_bill August increment") {
      const b = await billQuery<any>(`SELECT PFELig, ESIElig FROM salary_data WHERE TRIM(EmpCode) = ? ORDER BY SalayDate DESC LIMIT 1`, [r0.employee_code]);
      if (b[0]) {
        const yes = (v: unknown) => String(v ?? "").trim().toUpperCase() === "YES" ? 1 : 0;
        const pf = yes(b[0].PFELig), esi = yes(b[0].ESIElig);
        flagsFromBill = pf !== n(r0.pf_applicable) || esi !== n(r0.esi_applicable);
        r = { ...r0, pf_applicable: pf, esi_applicable: esi };
      }
    }
    const est = deriveSalaryEstimates(r);
    const netBad = r.net_estimate == null || Math.abs(n(r.net_estimate) - est.net_in_hand) > 50;
    const ctcMissing = r.ctc == null;
    if (!netBad && !ctcMissing && !flagsFromBill) continue;
    todo.push({ r, est, setFlags: String(r0.approval_reference) === "db_bill August increment" });
  }
  console.log(`${APPLY ? "APPLY" : "DRY RUN"}: ${(rows as any[]).length} rows from the increment syncs, ${todo.length} to repair`);
  console.table(todo.slice(0, 50).map(({ r, est }) => ({
    code: r.employee_code, gross: n(r.gross), stored_net: r.net_estimate == null ? null : n(r.net_estimate), new_net: est.net_in_hand,
    stored_ctc: r.ctc == null ? null : n(r.ctc), derived_ctc: est.ctc, pf: est.pf_employee, esic: est.esic_employee,
    flags: `pf=${r.pf_applicable} esi=${r.esi_applicable}`, from: String(r.approval_reference).slice(0, 26),
  })));
  const ctcDisagree = todo.filter(({ r, est }) => r.ctc != null && Math.abs(n(r.ctc) - est.ctc) > 5);
  console.log(`stored ctc differs from the derived ctc by more than Rs 5 on ${ctcDisagree.length} rows (their ctc is left as stored)`);
  if (!APPLY) { console.log("Dry run complete. Re-run with --apply to write."); return; }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    for (const { r, est, setFlags } of todo) {
      await conn.execute(
        `UPDATE salary_component_assignments
            SET pf_employee = ?, esic_employee = ?, employer_pf = ?, employer_esi = ?, net_estimate = ?, ctc = COALESCE(ctc, ?)
                ${setFlags ? ", pf_applicable = ?, esi_applicable = ?" : ""}
          WHERE id = ? AND status = 'active'`,
        [est.pf_employee, est.esic_employee, est.employer_pf, est.employer_esi, est.net_in_hand, est.ctc,
         ...(setFlags ? [n(r.pf_applicable), n(r.esi_applicable)] : []), r.id]);
    }
    await conn.commit();
    console.log(`COMMITTED ${todo.length} rows`);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

main().then(async () => { await closeBillPool(); await closePool(); }).catch(async (e) => { console.error("ERR", e?.message ?? e); try { await closeBillPool(); await closePool(); } catch { } process.exit(1); });
