/**
 * db_bill GRN / expense structure probe. READ-ONLY (billQuery = SELECT only).
 *   GS_ROW   sample rows (no vendor personal data: ids, heads, amounts)
 *   GS_DIST  distinct values and counts of status / month / type columns for FY 2026-27
 *   GS_JOIN  which key links expense_entry_particular to expense_entry_master
 *   npx tsx scripts/dbbill-grn-sample.ts
 */
import "dotenv/config";
import { billQuery } from "../src/db/billDb.js";

const show = async (tag: string, sql: string) => {
  try { for (const r of await billQuery<any>(sql)) console.log(`${tag} ${JSON.stringify(r)}`); }
  catch (e) { console.log(`${tag} ERROR ${e instanceof Error ? e.message : String(e)}`); }
};
(async () => {
  await show("GS_ROW", `SELECT 'master' k, Id, GrnNo, ExpenseEntryType, BranchId, Vendor, FinanceYear, FinanceMonth, HeadId, SubHeadId, Amount, ExpenseDate, EntryStatus, grn_status, Reject, multi_month, CompId, bill_no, CGST, SGST, IGST, DATE_FORMAT(createdate,'%Y-%m-%d') cd FROM expense_entry_master WHERE FinanceYear = '2026-27' ORDER BY Id DESC LIMIT 4`);
  await show("GS_ROW", `SELECT 'particular' k, Id, BranchId, ExpenseEntryType, Particular, ExpenseEntry, CostCenterId, Amount, Rate, Tax, Total, DATE_FORMAT(createdate,'%Y-%m-%d') cd FROM expense_entry_particular ORDER BY Id DESC LIMIT 4`);
  await show("GS_DIST", `SELECT 'FinanceMonth' c, FinanceMonth v, COUNT(*) n FROM expense_entry_master WHERE FinanceYear = '2026-27' GROUP BY FinanceMonth`);
  await show("GS_DIST", `SELECT 'EntryStatus' c, EntryStatus v, COUNT(*) n FROM expense_entry_master WHERE FinanceYear = '2026-27' GROUP BY EntryStatus`);
  await show("GS_DIST", `SELECT 'grn_status' c, grn_status v, COUNT(*) n FROM expense_entry_master WHERE FinanceYear = '2026-27' GROUP BY grn_status`);
  await show("GS_DIST", `SELECT 'ExpenseEntryType' c, ExpenseEntryType v, COUNT(*) n FROM expense_entry_master WHERE FinanceYear = '2026-27' GROUP BY ExpenseEntryType`);
  await show("GS_DIST", `SELECT 'Reject' c, Reject v, COUNT(*) n FROM expense_entry_master WHERE FinanceYear = '2026-27' GROUP BY Reject`);
  await show("GS_JOIN", `SELECT 'by_Id' k, COUNT(*) n FROM expense_entry_particular p JOIN expense_entry_master m ON m.Id = CAST(p.ExpenseEntry AS UNSIGNED) WHERE m.FinanceYear = '2026-27'`);
  await show("GS_JOIN", `SELECT 'by_GrnNo' k, COUNT(*) n FROM expense_entry_particular p JOIN expense_entry_master m ON m.GrnNo = p.ExpenseEntry WHERE m.FinanceYear = '2026-27'`);
  await show("GS_HEAD", `SELECT * FROM tbl_bgt_expenseheadingmaster LIMIT 60`);
  await show("GS_SUB", `SELECT * FROM tbl_bgt_expensesubheadingmaster LIMIT 3`);
  await show("GS_CC", `SELECT * FROM cost_master LIMIT 2`);
  await new Promise((resolve) => process.stdout.write("GS_DONE\n", resolve));
  process.exit(0);
})();
