/**
 * Read-only: db_bill FY 2026-27 GRNs not yet in HRMS grn_request, with the company of their cost centres.
 *   MG_ROW  one per missing GRN: id, grn no, month, type, branch, head, taxable, tax, cost centres and their company
 *   MG_SUM  totals by company class (MAS / IDC / mixed / no cost centre) and month
 *   npx tsx scripts/missing-grn-company-check.ts
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { billQuery } from "../src/db/billDb.js";
import type { RowDataPacket } from "mysql2";

(async () => {
  const [done] = await db.execute<RowDataPacket[]>(`SELECT bill_source_id FROM grn_request WHERE bill_source_id IS NOT NULL`);
  const have = new Set((done as any[]).map((r) => Number(r.bill_source_id)));
  const rows = await billQuery<any>(
    `SELECT m.Id id, m.GrnNo g, m.FinanceMonth fm, m.ExpenseEntryType t, m.Reject rej, b.branch_name br, h.HeadingDesc head,
            SUM(CAST(p.Amount AS DECIMAL(16,2))) taxable, SUM(CAST(p.Tax AS DECIMAL(16,2))) tax,
            GROUP_CONCAT(DISTINCT CONCAT(p.CostCenterId, ':', COALESCE(c.process_name, '?'), '|', COALESCE(c.company_name, '?')) SEPARATOR ' ; ') ccs,
            SUM(c.company_name LIKE '%Mas Callnet%') mas_lines, SUM(c.company_name IS NOT NULL AND c.company_name NOT LIKE '%Mas Callnet%') other_lines, COUNT(p.Id) line_n
       FROM expense_entry_master m
       LEFT JOIN expense_entry_particular p ON CAST(p.ExpenseEntry AS UNSIGNED) = m.Id
       LEFT JOIN cost_master c ON c.id = CAST(p.CostCenterId AS UNSIGNED)
       LEFT JOIN branch_master b ON b.id = m.BranchId
       LEFT JOIN tbl_bgt_expenseheadingmaster h ON h.HeadingId = m.HeadId
      WHERE m.FinanceYear = '2026-27' AND m.ExpenseEntryType IN ('Vendor','Imprest','Salary')
      GROUP BY m.Id, m.GrnNo, m.FinanceMonth, m.ExpenseEntryType, m.Reject, b.branch_name, h.HeadingDesc`);
  const sum: Record<string, { n: number; taxable: number }> = {};
  for (const r of rows) {
    if (have.has(Number(r.id))) continue;
    const cls = Number(r.mas_lines) > 0 && Number(r.other_lines) === 0 ? "MAS" : Number(r.other_lines) > 0 && Number(r.mas_lines) === 0 ? "IDC/other" : Number(r.mas_lines) > 0 ? "mixed" : "no cost centre";
    const rej = Number(r.rej) === 1 ? "active" : "rejected";
    console.log("MG_ROW " + JSON.stringify({ id: r.id, g: r.g, fm: r.fm, t: r.t, status: rej, br: r.br, head: r.head, taxable: Math.round(Number(r.taxable ?? 0)), tax: Math.round(Number(r.tax ?? 0)), cls, ccs: r.ccs }));
    const k = `${cls}|${rej}|${r.fm}`; const s = sum[k] ?? { n: 0, taxable: 0 }; s.n++; s.taxable += Number(r.taxable ?? 0); sum[k] = s;
  }
  for (const [k, v] of Object.entries(sum).sort()) console.log("MG_SUM " + JSON.stringify({ k, n: v.n, taxable: Math.round(v.taxable) }));
  await new Promise((res) => process.stdout.write("MG_DONE\n", res));
  process.exit(0);
})();
