/**
 * Trace large db_bill GRNs for one branch/month/head into HRMS. READ-ONLY.
 *   npx tsx scripts/trace-grn.ts <FinanceMonth e.g. May> <min amount, default 300000>
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { billQuery } from "../src/db/billDb.js";
import type { RowDataPacket } from "mysql2";

(async () => {
  const fm = process.argv[2] ?? "May"; const min = Number(process.argv[3] ?? 300000);
  const bills = await billQuery<any>(
    `SELECT m.Id id, m.GrnNo g, m.FinanceMonth fm, b.branch_name br, h.HeadingDesc head, m.ExpenseEntryType t, m.multi_month mm, m.Reject rej,
            SUM(CAST(p.Amount AS DECIMAL(16,2))) amt, MAX(LEFT(p.Particular,60)) particular
       FROM expense_entry_master m JOIN expense_entry_particular p ON CAST(p.ExpenseEntry AS UNSIGNED) = m.Id
       LEFT JOIN branch_master b ON b.id = m.BranchId LEFT JOIN tbl_bgt_expenseheadingmaster h ON h.HeadingId = m.HeadId
      WHERE m.FinanceYear = '2026-27' AND m.FinanceMonth = ? AND m.Reject = 1
      GROUP BY m.Id, m.GrnNo, m.FinanceMonth, b.branch_name, h.HeadingDesc, m.ExpenseEntryType, m.multi_month, m.Reject
     HAVING amt >= ? ORDER BY amt DESC`, [fm, min]);
  for (const b of bills) {
    const [g] = await db.execute<RowDataPacket[]>(
      `SELECT g.grn_number, g.status, g.accounting_period, g.recognition_period, g.is_multi_month, g.recognition_start_period, g.recognition_end_period,
              ROUND(COALESCE(g.amount_without_tax, g.amount)) ex_gst, bm.branch_name, ccm.company_name cc_company, g.cost_class, g.pnl_bucket g_bucket, (SELECT process_name FROM process_master WHERE id = g.process_id) g_process, ccm.cost_centre_code cc, (SELECT process_name FROM process_master WHERE id = ccm.process_id) cc_process,
              (SELECT COUNT(*) FROM vendor_payment_tracking v WHERE v.grn_request_id = g.id) vpt_n,
              (SELECT GROUP_CONCAT(CONCAT(COALESCE(v.recognition_period,'-'),':',COALESCE(v.payment_status,'-'),':',ROUND(COALESCE(v.amount_without_tax,v.due_amount)),':cls=',COALESCE(v.cost_class,'-'),':bkt=',COALESCE(v.pnl_bucket,'-'),':proc=',COALESCE((SELECT process_name FROM process_master WHERE id=v.process_id),'-'),':due=',COALESCE(DATE_FORMAT(v.due_date,'%Y-%m'),'-')) SEPARATOR ' ; ') FROM vendor_payment_tracking v WHERE v.grn_request_id = g.id) vpt,
              (SELECT GROUP_CONCAT(CONCAT(COALESCE(a.recognition_period,'-'),':',a.lifecycle_status,':',ROUND(a.amount_without_tax),':cls=',COALESCE(a.cost_class,'-'),':bkt=',COALESCE(a.pnl_bucket,'-'),':proc=',COALESCE((SELECT process_name FROM process_master WHERE id=a.process_id),'-'),':line=',COALESCE(a.budget_line_id,'-')) SEPARATOR ' ; ') FROM grn_cost_allocation a WHERE a.grn_request_id = g.id) alloc
         FROM grn_request g LEFT JOIN branch_master bm ON bm.id = g.branch_id LEFT JOIN cost_centre_master ccm ON ccm.id = g.cost_centre_id
        WHERE g.grn_number = ? OR g.grn_number LIKE CONCAT(?, '-%')`, [b.g, b.g]);
    console.log("TG " + JSON.stringify({ dbbill: b, hrms: g }));
  }
  await new Promise((r) => process.stdout.write("TG_DONE\n", r));
  process.exit(0);
})();
