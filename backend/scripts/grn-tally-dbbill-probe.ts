/**
 * db_bill GRN -> Tally probe — read-only (billQuery allows SELECT/SHOW only; HRMS side SELECT-guarded).
 *
 *   npx tsx scripts/grn-tally-dbbill-probe.ts
 *
 * Round 2: vendor Tally/TDS fields, TDS master, sub-head TDS, imprest ledgers, legacy imprest GRNs, how
 * HRMS vendors link to db_bill vendors, and which HRMS-raised GRNs are the same bill as a db_bill GRN
 * (already sent to Tally by the legacy import).
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { billQuery, closeBillPool } from "../src/db/billDb.js";
import { db } from "../src/db/mysql.js";

const out = (title: string, rows: any[]) => {
  console.log(`\n## ${title} (${rows.length})`);
  for (const r of rows) console.log(JSON.stringify(r));
};
const bill = async (title: string, sql: string) => {
  try {
    const rows = (await billQuery<any>(sql)) as any[];
    out(title, rows);
    return rows;
  } catch (e) {
    console.log(`\n## ${title}\nERROR ${(e as Error).message}`);
    return [];
  }
};
const hrms = async (title: string, sql: string, print = true) => {
  if (!/^\s*SELECT\b/i.test(sql)) throw new Error("read-only");
  try {
    const [rows] = await db.query<RowDataPacket[]>(sql);
    if (print) out(title, rows);
    return rows as any[];
  } catch (e) {
    console.log(`\n## ${title}\nERROR ${(e as Error).message}`);
    return [];
  }
};

await bill("tds_master", `SELECT * FROM tds_master`);
await bill("columns imprest_manager", `SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'imprest_manager' ORDER BY ORDINAL_POSITION`);
await bill("imprest_manager rows", `SELECT * FROM imprest_manager`);
await bill("vendor TDS/Tally fill", `SELECT COUNT(*) n, SUM(TallyHead IS NOT NULL AND TallyHead <> '') tally, SUM(TDSEnabled = 1) tds_on,
  SUM(TDSTallyHead IS NOT NULL AND TDSTallyHead <> '') tds_head, SUM(active = 1) active FROM tbl_vendormaster`);
await bill("vendor TDS combos", `SELECT TDSEnabled, TDS, TDSSection, TDSTallyHead, TDSChange, TDSNew, COUNT(*) n FROM tbl_vendormaster GROUP BY 1,2,3,4,5,6 ORDER BY n DESC LIMIT 40`);
await bill("sample vendors from the Sep import", `SELECT Id, vendor, TallyHead, TDSEnabled, TDS, TDSSection, TDSTallyHead, TDSChange, TDSNew, AmountLimit, GSTEnabled, VendorGSTNo, state FROM tbl_vendormaster
  WHERE Id IN (1850, 1537, 1202, 1596, 691, 1837, 1916) OR vendor LIKE '%OPEN AI%' OR vendor LIKE '%SAROJA%' OR vendor LIKE '%Airtel%' OR vendor LIKE '%Brew%' OR vendor LIKE '%Vodafone%' LIMIT 40`);
await bill("sub-head TDS config", `SELECT s.SubHeadingId, s.SubHeadingDesc, s.SubHeadTDSEnabled, s.SubHeadTdsSection, s.SubHeadTds FROM tbl_bgt_expensesubheadingmaster s WHERE s.SubHeadTDSEnabled IN ('1','Yes','yes','Y') OR s.SubHeadTds IS NOT NULL ORDER BY s.SubHeadingDesc LIMIT 80`);
await bill("legacy entry types and download status, FY 26-27", `SELECT ExpenseEntryType, DownloadStatus, COUNT(*) n FROM expense_entry_master WHERE FinanceYear = '2026-27' GROUP BY 1,2`);
await bill("legacy imprest GRNs Sep-26 sample", `SELECT Id, GrnNo, BranchId, Vendor, FinanceMonth, SubHeadId, Amount, bill_no, bill_date, DownloadStatus, userid FROM expense_entry_master WHERE ExpenseEntryType = 'Imprest' AND FinanceYear = '2026-27' AND FinanceMonth = 'Sep' LIMIT 10`);
await bill("vendor_expense_relation columns", `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('vendor_expense_relation','vendor_master','billing_ledger','tbl_tally_row_invoice_data') ORDER BY TABLE_NAME, ORDINAL_POSITION`);

// HRMS vendor <-> db_bill vendor link
await hrms("HRMS vendor_code shapes", `SELECT LEFT(vendor_code, 8) p, COUNT(*) n FROM vendor_master GROUP BY p ORDER BY n DESC LIMIT 10`);
await hrms("HRMS sub-head GST recovery defaults (non-100)", `SELECT sub_head_name, default_recoverable_tax_pct, default_gst_type, default_tax_treatment FROM finance_expense_sub_head_master WHERE COALESCE(default_recoverable_tax_pct, 100) <> 100 ORDER BY sub_head_name`);

// Duplicates: HRMS-raised GRNs that are the same bill as a db_bill GRN.
const recent = await hrms("hrms recent", `SELECT g.grn_number, g.grn_type, g.invoice_number, g.vendor_name, g.amount_with_tax, g.amount, g.bill_date, g.status
  FROM grn_request g WHERE g.bill_source_id IS NULL AND g.grn_number IS NOT NULL AND COALESCE(g.approved_at, g.finance_head_reviewed_at) >= '2026-08-01'`, false);
const legacy = (await billQuery<any>(`SELECT GrnNo, ExpenseEntryType, bill_no, Amount, bill_date, DownloadStatus, Vendor FROM expense_entry_master WHERE FinanceYear = '2026-27' AND createdate >= '2026-07-01'`)) as any[];
const norm = (s: unknown) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const byBill = new Map<string, any[]>();
for (const l of legacy) { const k = norm(l.bill_no); if (k && k !== "NA") { if (!byBill.has(k)) byBill.set(k, []); byBill.get(k)!.push(l); } }
const dups: any[] = []; let checked = 0;
for (const g of recent) {
  const k = norm(g.invoice_number); if (!k || k === "NA") continue; checked++;
  const gross = Number(g.amount_with_tax) > 0 ? Number(g.amount_with_tax) : Number(g.amount);
  const hits = (byBill.get(k) ?? []).filter((l) => Math.abs(Number(l.Amount) - gross) <= 2);
  if (hits.length) dups.push({ hrms: g.grn_number, type: g.grn_type, bill: g.invoice_number, gross, legacy: hits.map((h) => `${h.GrnNo}(${h.ExpenseEntryType},dl=${h.DownloadStatus})`).join(" ") });
}
console.log(`\nduplicate check: ${checked} HRMS GRNs with a bill no, ${dups.length} match a db_bill GRN (same bill no, amount within Rs 2)`);
out("HRMS GRNs that duplicate a db_bill GRN", dups);
const sameBillDiffAmt = recent.filter((g) => { const k = norm(g.invoice_number); return k && k !== "NA" && byBill.has(k) && !dups.find((d) => d.hrms === g.grn_number); })
  .map((g) => ({ hrms: g.grn_number, bill: g.invoice_number, gross: g.amount_with_tax, legacy: byBill.get(norm(g.invoice_number))!.map((l) => `${l.GrnNo}:${l.Amount}`).join(" ") }));
out("same bill no but different amount (check)", sameBillDiffAmt);

await closeBillPool();
process.exit(0);
