/**
 * db_bill revenue and salary cost by branch + cost centre + month. READ-ONLY (billQuery = SELECT only).
 * Revenue: tbl_invoice.total (ex-tax), status = 0, grouped by invoiceDate month.
 * Cost: salary_data (Gross / CTC / employer statutory) grouped by SalayDate month.
 * One output line per row so the runner log does not truncate.
 *
 *   npx tsx scripts/dbbill-pnl-by-cc.ts
 */
import "dotenv/config";
import { billQuery } from "../src/db/billDb.js";

(async () => {
  const rev = await billQuery<any>(
    `SELECT DATE_FORMAT(invoiceDate,'%Y-%m') p, TRIM(branch_name) branch, TRIM(cost_center) cc, TRIM(cost_process_name) pname,
            COUNT(*) n, SUM(CAST(total AS DECIMAL(16,2))) rev
       FROM tbl_invoice
      WHERE status = 0 AND invoiceDate >= '2026-04-01' AND invoiceDate < '2026-10-01'
      GROUP BY p, branch, cc, pname ORDER BY p, branch, cc`);
  for (const r of rev) console.log("DBB_REV " + JSON.stringify(r));
  const sal = await billQuery<any>(
    `SELECT DATE_FORMAT(SalayDate,'%Y-%m') p, TRIM(Branch) branch, TRIM(CostCenter) cc, COUNT(*) n,
            SUM(CAST(Gross AS DECIMAL(14,2))) gross, SUM(CAST(CTC AS DECIMAL(14,2))) ctc,
            SUM(CAST(EPFCompany AS DECIMAL(14,2))) epf_co, SUM(CAST(ESICCompany AS DECIMAL(14,2))) esic_co,
            SUM(CAST(AdminChrg AS DECIMAL(14,2))) admin, SUM(CAST(Incentive AS DECIMAL(14,2))) incentive
       FROM salary_data
      WHERE SalayDate >= '2026-04-01' AND SalayDate < '2026-10-01'
      GROUP BY p, branch, cc ORDER BY p, branch, cc`);
  for (const r of sal) console.log("DBB_SAL " + JSON.stringify(r));
  await new Promise((resolve) => process.stdout.write("DBB_DONE\n", resolve));
  process.exit(0);
})();
