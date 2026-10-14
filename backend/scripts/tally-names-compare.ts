/**
 * Tally names: db_bill vs HRMS — read-only (db_bill via billQuery; HRMS SELECT-only, 60 s cap).
 *
 *   npx tsx scripts/tally-names-compare.ts
 *
 * Lists every db_bill column that holds a Tally name, then compares, family by family, the names the legacy
 * system sent to Tally with the names HRMS now puts in its Tally files: vendors, expense ledgers (sub-heads),
 * branches (cost categories), cost centres, banks, TDS ledgers, GST ledgers, clients, imprest holders.
 * MAS Callnet only where db_bill has a company column.
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
  for (const r of rows.slice(0, max)) console.log(`  ${typeof r === "string" ? r : JSON.stringify(r)}`);
  if (rows.length > max) console.log(`  ... ${rows.length - max} more`);
};
const exact = (s: unknown) => String(s ?? "").trim();
const loose = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Compare two name lists: exact match, match ignoring case/punctuation, only-in-each. */
function compare(title: string, legacy: string[], hrms: string[]) {
  const L = new Set(legacy.map(exact).filter(Boolean));
  const H = new Set(hrms.map(exact).filter(Boolean));
  const Hl = new Map([...H].map((x) => [loose(x), x]));
  const Ll = new Map([...L].map((x) => [loose(x), x]));
  const same = [...L].filter((x) => H.has(x));
  const caseOnly = [...L].filter((x) => !H.has(x) && Hl.has(loose(x))).map((x) => `legacy "${x}"  vs  HRMS "${Hl.get(loose(x))}"`);
  const onlyLegacy = [...L].filter((x) => !H.has(x) && !Hl.has(loose(x)));
  const onlyHrms = [...H].filter((x) => !L.has(x) && !Ll.has(loose(x)));
  console.log(`\n==================== ${title} ====================`);
  console.log(`  legacy ${L.size} | HRMS ${H.size} | identical ${same.length} | differ only in case/spacing/punctuation ${caseOnly.length} | only legacy ${onlyLegacy.length} | only HRMS ${onlyHrms.length}`);
  out(`${title}: differ only in case / spacing / punctuation`, caseOnly, 60);
  out(`${title}: only in legacy (Tally has it, HRMS never sends it)`, onlyLegacy, 40);
  out(`${title}: only in HRMS (HRMS sends it, legacy never did — may be missing in Tally)`, onlyHrms, 60);
}

// ── 0. where db_bill keeps Tally names ──────────────────────────────────────────────────────────
out("db_bill columns holding Tally names", await b(`SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME REGEXP 'tally' ORDER BY TABLE_NAME`), 80);
out("db_bill branch_master columns", (await b(`SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'branch_master'`)).map((r) => r.COLUMN_NAME));
out("db_bill branch_master rows", await b(`SELECT * FROM branch_master`), 30);
out("db_bill bank tables", await b(`SELECT TABLE_NAME, TABLE_ROWS FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME REGEXP 'bank'`));

// ── 1. vendors (party ledgers) ──────────────────────────────────────────────────────────────────
// Legacy: vendors on MAS GRNs since FY 2025-26 (what the legacy import actually sent).
const legacyVendors = (await b(`SELECT DISTINCT v.Id, v.TallyHead FROM expense_entry_master m JOIN tbl_vendormaster v ON v.Id = m.Vendor
  WHERE m.ExpenseEntryType = 'Vendor' AND m.CompId = 1 AND m.FinanceYear IN ('2025-26','2026-27')`));
const hrmsVendorsAll = await h(`SELECT id, vendor_code, COALESCE(NULLIF(TRIM(tally_name), ''), vendor_name) n FROM vendor_master`);
const usedHrmsVendors = new Set((await h(`SELECT DISTINCT vendor_id FROM grn_request WHERE bill_source_id IS NULL AND grn_number IS NOT NULL AND vendor_id IS NOT NULL`)).map((r) => String(r.vendor_id)));
compare("Vendors (party ledger) — HRMS vendors on HRMS GRNs", legacyVendors.map((v) => v.TallyHead), hrmsVendorsAll.filter((v) => usedHrmsVendors.has(String(v.id))).map((v) => v.n));
// Same vendor id, different name.
const byLegacyId = new Map(hrmsVendorsAll.filter((v) => /^DB_BILL_\d+$/.test(v.vendor_code)).map((v) => [v.vendor_code.slice(8), v.n]));
const allLegacy = await b(`SELECT Id, vendor, TallyHead FROM tbl_vendormaster`);
out("Vendors: same vendor, HRMS name differs from db_bill TallyHead", allLegacy.filter((l) => byLegacyId.has(String(l.Id)) && exact(byLegacyId.get(String(l.Id))) !== exact(l.TallyHead)).map((l) => `#${l.Id} db_bill "${l.TallyHead}"  HRMS "${byLegacyId.get(String(l.Id))}"`), 60);

// ── 2. expense ledgers (sub-heads) ──────────────────────────────────────────────────────────────
const legacySubs = await b(`SELECT DISTINCT s.SubHeadingDesc FROM expense_entry_master m JOIN tbl_bgt_expensesubheadingmaster s ON s.SubHeadingId = m.SubHeadId
  WHERE m.CompId = 1 AND m.FinanceYear IN ('2025-26','2026-27')`);
const hrmsSubs = await h(`SELECT sub_head_name FROM finance_expense_sub_head_master WHERE active_status = 1`);
compare("Expense ledgers (sub-head names)", legacySubs.map((r) => r.SubHeadingDesc), hrmsSubs.map((r) => r.sub_head_name));

// ── 3. branches = cost categories ───────────────────────────────────────────────────────────────
const legacyBranchesUsed = await b(`SELECT DISTINCT b.* FROM expense_entry_master m JOIN branch_master b ON b.Id = m.BranchId WHERE m.CompId = 1 AND m.FinanceYear = '2026-27'`);
out("db_bill branches on FY 26-27 MAS GRNs (cost categories in the legacy import)", legacyBranchesUsed, 30);
const hrmsBranches = await h(`SELECT branch_name, branch_code, active_status FROM branch_master WHERE active_status = 1`);
out("HRMS active branches (cost category = branch_name)", hrmsBranches);
const map = await h(`SELECT m.dbbill_branch_id, b.branch_name FROM grn_migration_branch_map m JOIN branch_master b ON b.id = m.hrms_branch_id`);
out("db_bill branch -> HRMS branch map", map);

// ── 4. cost centres ─────────────────────────────────────────────────────────────────────────────
out("db_bill cost-centre like columns", await b(`SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND (COLUMN_NAME REGEXP 'costcent|cost_cent|cc_code|centre' ) AND TABLE_NAME REGEXP 'branch|cost|expense' ORDER BY TABLE_NAME`), 40);

// ── 5. banks ────────────────────────────────────────────────────────────────────────────────────
out("HRMS company bank accounts (Tally ledger)", await h(`SELECT account_name, tally_ledger_name, active_status FROM company_bank_account`));
out("db_bill tbl_payment_processing bank names used FY 26-27", await b(`SELECT BankName, COUNT(*) n FROM tbl_payment_processing WHERE CreateDate >= '2026-04-01' GROUP BY BankName ORDER BY n DESC`));

// ── 6. TDS ledgers ──────────────────────────────────────────────────────────────────────────────
compare("TDS ledgers", (await b(`SELECT DISTINCT t.description d FROM tbl_bgt_expensesubheadingmaster s JOIN tds_master t ON t.Id = s.SubHeadTdsSection WHERE s.SubHeadTDSEnabled IN ('Yes','1')
  UNION SELECT DISTINCT t.description FROM tbl_vendormaster v JOIN tds_master t ON t.Id = v.TDSSection WHERE v.TDSEnabled = 1`)).map((r) => r.d),
  [...(await h(`SELECT DISTINCT tds_tally_ledger n FROM finance_expense_sub_head_master WHERE tds_tally_ledger IS NOT NULL`)), ...(await h(`SELECT DISTINCT tds_tally_ledger n FROM vendor_master WHERE tds_tally_ledger IS NOT NULL`))].map((r) => r.n));

// ── 7. GST ledgers ──────────────────────────────────────────────────────────────────────────────
out("db_bill GST-ledger-like values", await b(`SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME REGEXP 'ledger|cgst_head|igst_head|gst_head|input' ORDER BY TABLE_NAME`), 40);
out("db_bill tbl_state_comp_gst_details sample", await b(`SELECT * FROM tbl_state_comp_gst_details LIMIT 5`), 5);

// ── 8. clients (sales export) ───────────────────────────────────────────────────────────────────
const legacyClients = await b(`SELECT DISTINCT tally_head FROM cost_master WHERE tally_head IS NOT NULL AND tally_head <> ''`);
const hrmsClients = await h(`SELECT DISTINCT tally_head FROM cost_centre_master WHERE tally_head IS NOT NULL AND tally_head <> ''`);
compare("Client ledgers (cost centre tally_head)", legacyClients.map((r) => r.tally_head), hrmsClients.map((r) => r.tally_head));

// ── 9. imprest holders ──────────────────────────────────────────────────────────────────────────
compare("Imprest holder ledgers (active)", (await b(`SELECT TallyHead FROM imprest_manager WHERE Active = 1`)).map((r) => r.TallyHead),
  (await h(`SELECT tally_name FROM imprest_manager WHERE active_status = 1`)).map((r) => r.tally_name));

// ── 10. HRMS ledger heads (payable_account_master) ──────────────────────────────────────────────
out("HRMS ledger heads (payable_account_master) — check each exists in Tally", await h(`SELECT account_name, account_type, tally_ledger_name, active_status FROM payable_account_master ORDER BY account_type`));

await closeBillPool();
process.exit(0);
