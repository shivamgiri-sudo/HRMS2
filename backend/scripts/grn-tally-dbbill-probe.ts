/**
 * db_bill GRN -> Tally probe — read-only (billQuery allows SELECT/SHOW only).
 *
 *   npx tsx scripts/grn-tally-dbbill-probe.ts
 *
 * Finds where the legacy billing system keeps what its JrnlP GRN import needs and HRMS lacks: TDS per
 * GRN and per vendor, vendor Tally ledger names, imprest holder ledgers, GST input credit, and how the
 * GRN number is formed. Prints schema and samples for the Sep-26 import (GRN Mas/9/26/125 onward).
 */
import "dotenv/config";
import { billQuery, closeBillPool } from "../src/db/billDb.js";

const show = async (title: string, sql: string) => {
  try {
    const rows = (await billQuery<any>(sql)) as any[];
    console.log(`\n## ${title} (${rows.length})`);
    for (const r of rows) console.log(JSON.stringify(r));
  } catch (e) {
    console.log(`\n## ${title}\nERROR ${(e as Error).message}`);
  }
};

await show("tables of interest", `SELECT TABLE_NAME, TABLE_ROWS FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME REGEXP 'expense|vendor|tds|tally|imprest|ledger|grn|heading|payment|gst|branch|cost' ORDER BY TABLE_NAME`);
await show("columns mentioning tds/tally/ledger/gst/tax/narration/vch/input/credit", `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME REGEXP 'tds|tally|ledger|gst|tax|narrat|vch|voucher|input|itc|recover|section|pan|imprest' ORDER BY TABLE_NAME, ORDINAL_POSITION`);
for (const t of ["expense_entry_master", "expense_entry_particular", "tbl_vendormaster", "imprest_allotment_master", "tbl_bgt_expensesubheadingmaster", "tbl_payment_processing"]) {
  await show(`columns ${t}`, `SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${t}' ORDER BY ORDINAL_POSITION`);
}
await show("Sep-26 import GRNs (masters)", `SELECT * FROM expense_entry_master WHERE GrnNo IN ('Mas/9/26/125','Mas/9/26/126','Mas/9/26/139','Mas/8/26/411','Mas/7/26/338','Mas/8/26/276','Mas/8/26/298','Mas/9/26/168')`);
await show("their lines", `SELECT p.* FROM expense_entry_particular p WHERE CAST(p.ExpenseEntry AS UNSIGNED) IN (SELECT Id FROM expense_entry_master WHERE GrnNo IN ('Mas/9/26/125','Mas/9/26/126','Mas/9/26/139','Mas/8/26/411','Mas/7/26/338','Mas/8/26/276','Mas/8/26/298','Mas/9/26/168'))`);
await show("vendors of those GRNs", `SELECT v.* FROM tbl_vendormaster v WHERE v.Id IN (SELECT VendorId FROM expense_entry_master WHERE GrnNo IN ('Mas/9/26/126','Mas/9/26/125','Mas/8/26/276','Mas/7/26/338'))`);
await show("GRN number middle part vs month, FY 2026-27", `SELECT SUBSTRING_INDEX(SUBSTRING_INDEX(GrnNo,'/',2),'/',-1) mid, MIN(CreateDate) first_created, MAX(CreateDate) last_created, COUNT(*) n FROM expense_entry_master WHERE GrnNo LIKE 'Mas/%/26/%' GROUP BY mid ORDER BY mid+0`);
await closeBillPool();
process.exit(0);
