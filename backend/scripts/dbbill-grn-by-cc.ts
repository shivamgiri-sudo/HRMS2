/**
 * db_bill GRN / expense by month, cost centre, head. READ-ONLY (billQuery = SELECT only).
 *   GC_ROW   expense_entry_particular joined to expense_entry_master (join key: particular.ExpenseEntry = master.Id)
 *   GC_CC    cost_master id -> company, branch, process
 *   GC_HEAD / GC_SUB / GC_BR  heading, sub-heading and branch names
 *   npx tsx scripts/dbbill-grn-by-cc.ts
 */
import "dotenv/config";
import { billQuery } from "../src/db/billDb.js";

const show = async (tag: string, sql: string) => {
  try { for (const r of await billQuery<any>(sql)) console.log(`${tag} ${JSON.stringify(r)}`); }
  catch (e) { console.log(`${tag} ERROR ${e instanceof Error ? e.message : String(e)}`); }
};
(async () => {
  await show("GC_ROW", `
    SELECT m.FinanceMonth fm, m.BranchId br, p.CostCenterId cc, m.HeadId head, m.SubHeadId sub, m.ExpenseEntryType typ, m.Reject rej, m.EntryStatus est, IFNULL(m.multi_month,'') mm, m.CompId comp,
           COUNT(*) n, SUM(CAST(p.Amount AS DECIMAL(16,2))) amt, SUM(CAST(p.Tax AS DECIMAL(16,2))) tax
      FROM expense_entry_particular p JOIN expense_entry_master m ON m.Id = CAST(p.ExpenseEntry AS UNSIGNED)
     WHERE m.FinanceYear = '2026-27' AND m.FinanceMonth IN ('Apr','May','Jun','Jul','Aug','Sep')
     GROUP BY m.FinanceMonth, m.BranchId, p.CostCenterId, m.HeadId, m.SubHeadId, m.ExpenseEntryType, m.Reject, m.EntryStatus, IFNULL(m.multi_month,''), m.CompId`);
  await show("GC_CC", `SELECT id, company_name co, branch, OPBranch opb, process, process_name pn, client, type, category, Revenue rev, Billing bil FROM cost_master`);
  await show("GC_HEAD", `SELECT HeadingId id, HeadingDesc d, Cost c, close_status cs FROM tbl_bgt_expenseheadingmaster`);
  await show("GC_SUB", `SELECT SubHeadingId id, HeadingId h, SubHeadingDesc d, HeadType ht FROM tbl_bgt_expensesubheadingmaster`);
  await show("GC_BR", `SELECT * FROM branch_master`);
  await new Promise((resolve) => process.stdout.write("GC_DONE\n", resolve));
  process.exit(0);
})();
