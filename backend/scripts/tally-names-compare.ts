/**
 * Tally names in db_bill, round 3 — read-only (db_bill via billQuery; HRMS SELECT-only, 60 s cap).
 *
 *   npx tsx scripts/tally-names-compare.ts
 *
 * Every db_bill column that carries a Tally name; how legacy vouchers named banks and heads (tbl_voucher_entries,
 * cheque masters, receipts, imprest); and the HRMS bank accounts / ledger heads those names must land on.
 * Prints schemas and samples; writes nothing.
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { billQuery, closeBillPool } from "../src/db/billDb.js";
import { db } from "../src/db/mysql.js";

const b = async (sql: string, params: unknown[] = []) => {
  try { return (await billQuery<any>(sql, params as any)) as any[]; } catch (e) { console.log(`  db_bill ERROR ${(e as Error).message}`); return []; }
};
const h = async (sql: string, params: unknown[] = []) => {
  if (!/^\s*SELECT\b/i.test(sql)) throw new Error("read-only");
  try { return (await db.query<RowDataPacket[]>(sql.replace(/^\s*SELECT/i, "SELECT /*+ MAX_EXECUTION_TIME(60000) */"), params))[0] as any[]; }
  catch (e) { console.log(`  HRMS ERROR ${(e as Error).message}`); return []; }
};
const out = (title: string, rows: unknown[], max = 40) => {
  console.log(`\n## ${title} (${rows.length})`);
  for (const r of rows.slice(0, max)) console.log(`  ${typeof r === "string" ? r : JSON.stringify(r).slice(0, 700)}`);
};
const cols = async (t: string) => (await b(`SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`, [t])).map((r) => r.COLUMN_NAME);

// Every column whose name mentions tally, with distinct-value counts.
const tallyCols = await b(`SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME LIKE '%tally%' ORDER BY TABLE_NAME`);
out("db_bill columns named *tally*", tallyCols.map((r) => `${r.TABLE_NAME}.${r.COLUMN_NAME}`), 100);
for (const r of tallyCols) {
  if (/^(tbl_tally_row_invoice_data|cost_master|branch_master|tbl_vendormaster|imprest_manager|tbl_state_list)$/i.test(r.TABLE_NAME)) continue;
  out(`${r.TABLE_NAME}.${r.COLUMN_NAME} values`, await b(`SELECT \`${r.COLUMN_NAME}\` v, COUNT(*) n FROM \`${r.TABLE_NAME}\` GROUP BY \`${r.COLUMN_NAME}\` ORDER BY n DESC LIMIT 60`), 60);
}

// Tables that look like voucher / cheque / receipt / imprest bank records: schema + latest rows.
for (const t of ["tbl_voucher_entries", "ChequePrintMaster", "LoanPrintChequeMaster", "receipt_master", "imprest_master", "head_master", "bill_pay_particulars", "Automail_Grnpayment_Master", "collection_tracking_matrix"]) {
  const c = await cols(t);
  console.log(`\n### ${t}: ${c.join(", ")}`);
  if (!c.length) continue;
  out(`${t} latest rows`, await b(`SELECT * FROM \`${t}\` ORDER BY 1 DESC LIMIT 6`), 6);
  // Distinct values of every name-like column.
  for (const col of c.filter((x) => /bank|ledger|head|account|acc_?name|party|particular|deposit|by_?to|dr|cr|narration/i.test(x) && !/amount|amt|_id$|^id$|date|no$/i.test(x)))
    out(`${t}.${col} values`, await b(`SELECT \`${col}\` v, COUNT(*) n FROM \`${t}\` GROUP BY \`${col}\` ORDER BY n DESC LIMIT 40`), 40);
}

// Payment-side: which bank + account (if any) each tbl_bank name is tied to.
out("tbl_payment deposit_bank by company, FY 2025-27", await b(`SELECT company_name, deposit_bank, COUNT(*) n, MAX(pays_date) last FROM tbl_payment WHERE financial_year IN ('2025-26','2026-27') GROUP BY company_name, deposit_bank ORDER BY n DESC LIMIT 30`));
out("tbl_payment_processing bank by GRN prefix, since 2025-04", await b(`SELECT SUBSTRING_INDEX(GrnNo, '/', 1) co, BankName, COUNT(*) n, MAX(PaymentDate) last FROM tbl_payment_processing WHERE PaymentDate >= '2025-04-01' GROUP BY co, BankName ORDER BY n DESC LIMIT 30`));

// HRMS side.
out("HRMS company_bank_account", await h(`SELECT a.id, a.account_name, a.account_number_last4, a.ifsc_code, a.tally_ledger_name, a.active_status, bm.bank_name, br.branch_name
  FROM company_bank_account a LEFT JOIN bank_master bm ON bm.id = a.bank_id LEFT JOIN branch_master br ON br.id = a.branch_id`), 60);
out("HRMS payable_account_master", await h(`SELECT id, account_name, account_type, tally_ledger_name, active_status FROM payable_account_master`), 60);
out("HRMS journal_entry by source since 2026-04", await h(`SELECT source_type, COUNT(*) n, MIN(entry_date) first, MAX(entry_date) last FROM journal_entry WHERE entry_date >= '2026-04-01' GROUP BY source_type`));
out("HRMS imprest_manager tally names", await h(`SELECT tally_name, COUNT(*) n FROM imprest_manager GROUP BY tally_name ORDER BY n DESC LIMIT 60`), 60);

await closeBillPool();
process.exit(0);
