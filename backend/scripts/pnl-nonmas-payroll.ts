/**
 * Payroll lines that belong to a non-MAS-Callnet entity (DialDesk / I-Spark / IDC / Dataconnect /
 * Pikquick), per month, grouped by branch / cost centre / process. READ-ONLY, aggregates only
 * (counts and cost; no names, no codes of individuals).
 *
 *   npx tsx scripts/pnl-nonmas-payroll.ts YYYY-MM [YYYY-MM ...]
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { nonVoidRunSql } from "../src/modules/payroll/run-status.js";
import { ownCompanyBranchSql, ownCompanyCostCentreSql, notDialDeskProcessSql } from "../src/shared/ownCompanyCostCentre.js";

const r0 = (v: unknown) => Math.round(Number(v ?? 0));

(async () => {
  const periods = process.argv.slice(2);
  if (!periods.length) throw new Error("pass periods");
  const [lineCols] = await db.query<RowDataPacket[]>("SHOW COLUMNS FROM salary_prep_line");
  const have = new Set(lineCols.map((c) => String(c.Field)));
  const col = (c: string) => (have.has(c) ? `COALESCE(spl.${c}, 0)` : "0");
  const cost = `(${col("gross_salary")} + ${col("pf_employer")} + ${col("esic_employer")} + ${col("gratuity")} + ${col("incentive_total")}`
    + ` - ${col("other_deductions")} - ${col("loan_emi")} - ${col("advance_recovery")} - ${col("lwp_deduction")})`;
  for (const period of periods) {
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT bm.branch_name AS branch, bm.company_name AS branch_company,
              ccm.cost_centre_code AS cc, ccm.company_name AS cc_company, pm.process_name AS process,
              CASE WHEN NOT ${ownCompanyBranchSql("bm")} THEN 'branch'
                   WHEN ccm.id IS NOT NULL AND NULLIF(TRIM(COALESCE(ccm.company_name,'')),'') IS NOT NULL AND NOT (${ownCompanyCostCentreSql("ccm")}) THEN 'cost_centre_company'
                   WHEN pm.id IS NOT NULL AND NOT ${notDialDeskProcessSql("pm", "pbm")} THEN 'process'
                   ELSE 'own' END AS why,
              COUNT(*) AS employees, SUM(${cost}) AS cost
         FROM salary_prep_line spl
         JOIN salary_prep_run spr ON spr.id = spl.run_id AND spr.run_month = ? AND ${nonVoidRunSql("spr")}
         JOIN employees e ON e.id = spl.employee_id
         LEFT JOIN branch_master bm ON bm.id = e.branch_id
         LEFT JOIN cost_centre_master ccm ON ccm.id = e.cost_centre_id
         LEFT JOIN process_master pm ON pm.id = e.process_id
         LEFT JOIN branch_master pbm ON pbm.id = pm.branch_id
        GROUP BY branch, branch_company, cc, cc_company, process, why
       HAVING why <> 'own'
        ORDER BY cost DESC`, [period]);
    let n = 0, c = 0;
    for (const r of rows) {
      n += Number(r.employees); c += Number(r.cost);
      console.log("NMP_ROW " + JSON.stringify({ period, why: r.why, branch: r.branch, branchCompany: r.branch_company, cc: r.cc, ccCompany: r.cc_company, process: r.process, employees: Number(r.employees), cost: r0(r.cost) }));
    }
    const [tot] = await db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS employees, SUM(${cost}) AS cost
         FROM salary_prep_line spl JOIN salary_prep_run spr ON spr.id = spl.run_id AND spr.run_month = ? AND ${nonVoidRunSql("spr")}`, [period]);
    console.log("NMP_TOTAL " + JSON.stringify({ period, nonMasEmployees: n, nonMasCost: r0(c), allEmployees: Number(tot[0]?.employees ?? 0), allCost: r0(tot[0]?.cost) }));
  }
  await new Promise((resolve) => process.stdout.write("NMP_DONE\n", resolve));
  process.exit(0);
})();
