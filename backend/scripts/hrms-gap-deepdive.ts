/**
 * Deep dive on HRMS vs db_bill P&L gaps. READ-ONLY (HRMS SELECTs; db_bill via billQuery = SELECT only).
 *   GD_CC   per revenue cost centre: master row, process + its active flag + branch, and the active-employee
 *           process split that PROCESS_BY_COST_CENTRE uses, plus whether the process survives the P&L base filter.
 *   GD_EMP  per employee per month (Apr-Jul): HRMS payroll line vs db_bill salary_data, only where they differ.
 *
 *   npx tsx scripts/hrms-gap-deepdive.ts
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { billQuery } from "../src/db/billDb.js";
import { notDialDeskProcessSql } from "../src/shared/ownCompanyCostCentre.js";
import type { RowDataPacket } from "mysql2";

const q = async (sql: string, p: unknown[] = []) => (await db.execute<RowDataPacket[]>(sql, p))[0];
const N = (v: unknown) => Number(v ?? 0) || 0;
const PERIODS = ["2026-04", "2026-05", "2026-06", "2026-07"];

(async () => {
  // ---- cost centres with billed revenue ----
  const ccs = await q(
    `SELECT DISTINCT s.cost_centre_code cc FROM billing_provision_snapshot s WHERE s.period_code IN ('2026-04','2026-05','2026-06','2026-07','2026-08')
     UNION SELECT DISTINCT cost_centre_code FROM billing_invoice_particular_snapshot WHERE period_code IN ('2026-04','2026-05','2026-06','2026-07','2026-08')`);
  for (const { cc } of ccs as any[]) {
    const [m] = (await q(
      `SELECT ccm.id, ccm.company_name, ccm.active_status ccm_active, ccm.revenue_flag, ccm.process_id ccm_process_id, pm.process_name ccm_process, pm.active_status ccm_process_active,
              bm.branch_name ccm_branch, pm.client_name pclient,
              (SELECT 1 FROM process_master p2 LEFT JOIN branch_master b2 ON b2.id = p2.branch_id WHERE p2.id = ccm.process_id AND COALESCE(p2.active_status,1)=1 AND ${notDialDeskProcessSql("p2", "b2")}) in_base
         FROM cost_centre_master ccm LEFT JOIN process_master pm ON pm.id = ccm.process_id LEFT JOIN branch_master bm ON bm.id = ccm.branch_id
        WHERE ccm.cost_centre_code = ? LIMIT 1`, [cc])) as any[];
    const emps = await q(
      `SELECT pm.process_name, pm.active_status p_active, bm.branch_name p_branch, COUNT(*) n,
              (SELECT 1 FROM process_master p2 LEFT JOIN branch_master b2 ON b2.id = p2.branch_id WHERE p2.id = pm.id AND COALESCE(p2.active_status,1)=1 AND ${notDialDeskProcessSql("p2", "b2")}) in_base
         FROM employees e JOIN cost_centre_master c ON c.id = e.cost_centre_id LEFT JOIN process_master pm ON pm.id = e.process_id LEFT JOIN branch_master bm ON bm.id = pm.branch_id
        WHERE c.cost_centre_code = ? AND e.active_status = 1 GROUP BY pm.id, pm.process_name, pm.active_status, bm.branch_name ORDER BY n DESC LIMIT 4`, [cc]);
    console.log("GD_CC " + JSON.stringify({ cc, master: m ?? null, active_employee_processes: emps }));
  }

  // ---- employee-level payroll reconciliation ----
  for (const period of PERIODS) {
    const hr = await q(
      `SELECT e.employee_code code, ccm.cost_centre_code cc, e.employment_status st, e.active_status act, DATE_FORMAT(e.date_of_leaving,'%Y-%m-%d') dol,
              SUM(COALESCE(spl.gross_salary,0)+COALESCE(spl.pf_employer,0)+COALESCE(spl.esic_employer,0)+COALESCE(spl.gratuity,0)
                  -COALESCE(spl.other_deductions,0)-COALESCE(spl.loan_emi,0)-COALESCE(spl.advance_recovery,0)-COALESCE(spl.lwp_deduction,0)) people,
              SUM(COALESCE(spl.incentive_total,0)) inc, SUM(COALESCE(spl.gross_salary,0)) gross
         FROM salary_prep_line spl JOIN salary_prep_run r ON r.id = spl.run_id JOIN employees e ON e.id = spl.employee_id
         LEFT JOIN cost_centre_master ccm ON ccm.id = e.cost_centre_id
        WHERE r.run_month = ? GROUP BY e.employee_code, ccm.cost_centre_code, e.employment_status, e.active_status, e.date_of_leaving`, [period]);
    const bill = await billQuery<any>(
      `SELECT EmpCode code, TRIM(CostCenter) cc, TRIM(Branch) branch, CAST(CTC AS DECIMAL(14,2)) ctc, CAST(Gross AS DECIMAL(14,2)) gross, CAST(Incentive AS DECIMAL(14,2)) inc,
              CAST(AdminChrg AS DECIMAL(14,2)) adm, CAST(EPFCompany AS DECIMAL(14,2)) epf, CAST(ESICCompany AS DECIMAL(14,2)) esic, LeftStatus lft
         FROM salary_data WHERE DATE_FORMAT(SalayDate,'%Y-%m') = ?`, [period]);
    const H = new Map<string, any>(); for (const r of hr as any[]) H.set(String(r.code).toUpperCase(), r);
    const B = new Map<string, any>(); for (const r of bill) B.set(String(r.code).toUpperCase(), r);
    let onlyH = 0, onlyB = 0, both = 0, sumOnlyH = 0, sumOnlyB = 0;
    for (const [code, b] of B) {
      if ((b.branch ?? "").toUpperCase().includes("DIALDESK")) continue;
      const h = H.get(code);
      if (!h) { onlyB++; sumOnlyB += N(b.ctc); console.log("GD_EMP " + JSON.stringify({ p: period, kind: "db_bill_only", code, dbb_cc: b.cc, branch: b.branch, dbb_ctc: N(b.ctc), dbb_inc: N(b.inc), lft: b.lft })); continue; }
      both++;
      const diff = N(b.ctc) - N(h.people) - N(b.inc) - N(b.adm);
      if (Math.abs(diff) > 3000) console.log("GD_EMP " + JSON.stringify({ p: period, kind: "amount", code, hrms_cc: h.cc, dbb_cc: b.cc, hrms_people: Math.round(N(h.people)), dbb_ctc: N(b.ctc), dbb_inc: N(b.inc), dbb_adm: N(b.adm), diff: Math.round(diff), hrms_gross: Math.round(N(h.gross)), dbb_gross: N(b.gross), st: h.st, act: h.act, dol: h.dol }));
    }
    for (const [code, h] of H) if (!B.has(code)) { onlyH++; sumOnlyH += N(h.people); console.log("GD_EMP " + JSON.stringify({ p: period, kind: "hrms_only", code, hrms_cc: h.cc, hrms_people: Math.round(N(h.people)), st: h.st, act: h.act, dol: h.dol })); }
    console.log("GD_EMPSUM " + JSON.stringify({ p: period, hrms_lines: H.size, dbbill_lines_exDD: [...B.values()].filter((b) => !(b.branch ?? "").toUpperCase().includes("DIALDESK")).length, both, onlyH, onlyB, sumOnlyH: Math.round(sumOnlyH), sumOnlyB: Math.round(sumOnlyB) }));
  }
  await new Promise((resolve) => process.stdout.write("GD_DONE\n", resolve));
  process.exit(0);
})();
