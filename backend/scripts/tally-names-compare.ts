/**
 * Tally names in db_bill, round 2 — read-only (db_bill via billQuery; HRMS SELECT-only, 60 s cap).
 *
 *   npx tsx scripts/tally-names-compare.ts
 *
 * Where db_bill keeps the Tally names for banks, payment / ledger heads, clients and states, and how the legacy
 * system sent payments to Tally; plus the Delhi branches. Prints schemas and samples; writes nothing.
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
  for (const r of rows.slice(0, max)) console.log(`  ${typeof r === "string" ? r : JSON.stringify(r).slice(0, 600)}`);
};
const cols = async (t: string) => (await b(`SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`, [t])).map((r) => r.COLUMN_NAME).join(", ");

out("db_bill tables about bank / payment / voucher / ledger / receipt / tally / head / account", await b(`SELECT TABLE_NAME, TABLE_ROWS FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME REGEXP 'bank|payment|voucher|ledger|receipt|tally|head|account|contra|journal|collection|state' ORDER BY TABLE_NAME`), 80);

for (const t of ["tbl_bank", "bank_account_verification_master", "billing_ledger", "tbl_payment", "tbl_payment_processing", "tbl_state_list", "tbl_tally_row_invoice_data"]) {
  console.log(`\n### ${t}: ${await cols(t)}`);
  out(`${t} rows`, await b(`SELECT * FROM ${t} ORDER BY 1 DESC LIMIT ${t === "tbl_bank" || t === "billing_ledger" || t === "bank_account_verification_master" ? 100 : 8}`), 100);
}
out("tbl_payment_processing: bank names and payment modes, all time", await b(`SELECT BankName, PaymentMode, COUNT(*) n, MIN(PaymentDate) first, MAX(PaymentDate) last FROM tbl_payment_processing GROUP BY BankName, PaymentMode ORDER BY n DESC LIMIT 30`));

// Columns anywhere that look like a bank / ledger / head name.
out("db_bill columns like bank / ledger / head / account name", await b(`SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
  AND COLUMN_NAME REGEXP '^(bank|bankname|bank_name|ledger|ledgername|ledger_name|head|headname|account|accountname|account_name|acc_name)$' ORDER BY TABLE_NAME`), 80);

// Clients (sales side) — legacy cost_master tally columns vs HRMS.
out("db_bill cost_master tally columns sample", await b(`SELECT TallyHead, client_tally_name, COUNT(*) n FROM cost_master GROUP BY TallyHead, client_tally_name ORDER BY n DESC LIMIT 25`));
out("HRMS cost_centre_master tally_head sample", await h(`SELECT tally_head, COUNT(*) n FROM cost_centre_master GROUP BY tally_head ORDER BY n DESC LIMIT 25`));
out("HRMS client_invoice client_tally_name / tally_head sample", await h(`SELECT client_tally_name, tally_head, COUNT(*) n FROM client_invoice GROUP BY client_tally_name, tally_head ORDER BY n DESC LIMIT 25`));

// Delhi.
out("HRMS Delhi branches", await h(`SELECT id, branch_name, branch_code, active_status, created_at FROM branch_master WHERE branch_name LIKE '%delhi%' OR branch_code LIKE '%DEL%'`));
out("db_bill Delhi branches and their FY 26-27 GRNs", await b(`SELECT b.id, b.branch_name, b.tally_branch, b.tally_code, b.active, (SELECT COUNT(*) FROM expense_entry_master m WHERE m.BranchId = b.id AND m.FinanceYear = '2026-27') grns
  FROM branch_master b WHERE b.branch_name LIKE '%DELHI%' OR b.tally_branch LIKE '%DELHI%'`));
out("HRMS GRNs at Delhi Office", await h(`SELECT COUNT(*) n, MIN(g.created_at) first, MAX(g.created_at) last FROM grn_request g JOIN branch_master b ON b.id = g.branch_id WHERE b.branch_name = 'Delhi Office'`));

await closeBillPool();
process.exit(0);
