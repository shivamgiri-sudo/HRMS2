/**
 * GRN Tally export — read-only production dry run.
 *
 *   npx tsx scripts/grn-tally-prod-dryrun.ts
 *
 * Runs the real export (loadGrnTallyDownload) over HRMS-raised GRNs for the given posting months and
 * reports what would not import cleanly into Tally: exceptions, and ledger / party / cost-category
 * names that the legacy billing system never sent (GRNs migrated from db_bill carry the names the
 * legacy import used, so they are the reference). Every statement is checked to be a SELECT before it
 * runs; nothing is written.
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";

const MONTHS = (process.env.DRYRUN_MONTHS || "2026-09,2026-10").split(",").map((m) => m.trim());

// Read-only guard: refuse anything that is not a SELECT, on every path the export uses.
const guard = <T extends (...a: any[]) => any>(fn: T): T =>
  ((sql: string, ...rest: any[]) => {
    if (!/^\s*\(?\s*SELECT\b/i.test(String(sql))) throw new Error(`read-only dry run refused: ${String(sql).slice(0, 60)}`);
    return fn(sql, ...rest);
  }) as T;
(db as any).execute = guard(db.execute.bind(db));
(db as any).query = guard(db.query.bind(db));

const { loadGrnTallyDownload, grnTallyDownloadSummary } = await import("../src/modules/finance/grn-tally-download.service.js");

const key = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
const count = (items: string[]) => {
  const m = new Map<string, number>();
  for (const i of items) m.set(i, (m.get(i) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};
const print = (title: string, rows: [string, number][] | string[]) => {
  console.log(`\n## ${title} (${rows.length})`);
  for (const r of rows) console.log(Array.isArray(r) ? `  ${r[1]}x  ${r[0]}` : `  ${r}`);
};

// Reference: names the legacy import used, as carried by GRNs migrated from db_bill (FY 2026-27).
const [ref] = await db.query<RowDataPacket[]>(
  `SELECT DISTINCT g.sub_head, g.vendor_name, b.branch_name
     FROM grn_request g LEFT JOIN branch_master b ON b.id = g.branch_id
    WHERE g.bill_source_id IS NOT NULL AND g.bill_date >= '2026-04-01'`,
);
const refSub = new Set(ref.map((r) => key(r.sub_head)));
const refVendor = new Set(ref.map((r) => key(r.vendor_name)));
const refBranch = new Set(ref.map((r) => key(r.branch_name)));
console.log(`reference from migrated db_bill GRNs: ${refSub.size} sub-heads, ${refVendor.size} vendors, ${refBranch.size} branches`);

for (const month of MONTHS) {
  const data = await loadGrnTallyDownload({ branchScope: { mode: "all" } as any, month });
  console.log(`\n==================== posting month ${month} ====================`);
  console.log(JSON.stringify(grnTallyDownloadSummary(data)));
  const okRows = data.rows.filter((r) => !r.exception);
  print("exceptions by reason", count(data.rows.filter((r) => r.exception).map((r) => r.exception!.replace(/[\d,]+\.\d{2}/g, "#"))));
  print("exception GRNs", data.rows.filter((r) => r.exception).map((r) => `${r.grnNumber} | ${r.branchName} | ${r.subHead} | ${r.vendorName} | ${r.exception}`));
  print("imprest credit ledgers", count(okRows.filter((r) => r.grnType === "imprest").map((r) => r.entries.find((e) => e.side === "Cr")?.ledger ?? "")));
  print("TDS basis", count(data.rows.map((r) => r.tdsBasis.replace(/@ [\d.]+%/, "@ n%"))));
  print("voucher types / GRN types", count(data.rows.map((r) => `${r.voucherType ?? "-"} / ${r.grnType}`)));

  const expense = okRows.map((r) => r.entries[0]?.ledger ?? "");
  const party = okRows.map((r) => r.entries.find((e) => e.side === "Cr")?.ledger ?? "");
  const tax = okRows.flatMap((r) => r.entries.filter((e) => /^Input /.test(e.ledger)).map((e) => e.ledger));
  const tds = okRows.flatMap((r) => r.entries.filter((e) => /^TDS /i.test(e.ledger)).map((e) => e.ledger));
  print("expense ledgers NOT used by legacy (check spelling vs Tally)", count(expense.filter((x) => !refSub.has(key(x)))));
  print("party ledgers NOT used by legacy (vendor Tally name?)", count(party.filter((x) => !refVendor.has(key(x)))));
  print("cost categories NOT used by legacy", count(okRows.map((r) => r.header!.costCategory).filter((x) => !refBranch.has(key(x)))));
  print("cost centres", count(okRows.map((r) => r.header!.costCentre)));
  print("GST ledgers", count(tax));
  print("TDS ledgers", count(tds));
  print("sample vouchers (first 5)", okRows.slice(0, 5).flatMap((r) => [
    `${r.header!.voucherNumber} | ${r.header!.date} | ${r.header!.effectiveDate} | ${r.header!.costCategory} | ${r.header!.costCentre}`,
    ...r.entries.map((e) => `      ${e.side} ${e.amount.toFixed(2)}  ${e.ledger}`),
  ]));
}

const show = async (title: string, sql: string) => {
  try {
    const [rows] = await db.query<RowDataPacket[]>(sql);
    print(title, rows.map((r) => JSON.stringify(r)));
  } catch (e) {
    console.log(`\n## ${title}\nERROR ${(e as Error).message}`);
  }
};
const recent = `g.bill_source_id IS NULL AND g.grn_number IS NOT NULL AND COALESCE(g.approved_at, g.finance_head_reviewed_at) >= '2026-09-01'`;
await show("gst_type / tax_treatment / gst_enabled on recent HRMS GRNs", `SELECT g.grn_type, g.gst_type, g.tax_treatment, g.gst_enabled, COUNT(*) n, SUM(g.tax_amount > 0) with_tax FROM grn_request g WHERE ${recent} GROUP BY 1,2,3,4 ORDER BY n DESC`);
await show("gst_rate values on recent HRMS GRNs", `SELECT g.gst_rate, COUNT(*) n FROM grn_request g WHERE ${recent} GROUP BY g.gst_rate ORDER BY n DESC`);
await show("recent GRNs with tax but no claimable GST (ITC would be lost)", `SELECT g.grn_number, g.grn_type, g.gst_type, g.tax_treatment, g.gst_rate, g.recoverable_tax_pct, g.amount_without_tax, g.tax_amount, g.round_off_amount, g.amount_with_tax, g.vendor_gstin FROM grn_request g WHERE ${recent} AND g.tax_amount > 0 AND (g.gst_type IS NULL OR g.gst_type NOT IN ('cgst_sgst','igst') OR COALESCE(g.recoverable_tax_pct,100) = 0) ORDER BY g.grn_number LIMIT 60`);
await show("recent GRNs with a non-slab gst_rate", `SELECT g.grn_number, g.gst_type, g.gst_rate, g.amount_without_tax, g.tax_amount, ROUND(100*g.tax_amount/NULLIF(g.amount_without_tax,0),2) eff FROM grn_request g WHERE ${recent} AND g.gst_rate IS NOT NULL AND g.gst_rate NOT IN (0,0.25,3,5,12,18,28,40) LIMIT 30`);
await show("imprest managers", `SELECT im.branch_id, im.tally_name, im.effective_from, im.effective_to, im.active_status FROM imprest_manager im ORDER BY im.branch_id, im.effective_from`);
await show("branches", `SELECT branch_name, branch_code, branch_seq, gst_state_code, state, active_status FROM branch_master ORDER BY branch_name`);
await show("GRN number format config", `SELECT config_key, config_value FROM finance_config WHERE config_key LIKE 'grn%'`);
await show("HRMS-raised GRN numbers, latest 15", `SELECT grn_number, accounting_period, branch_id, created_at FROM grn_request WHERE bill_source_id IS NULL AND grn_number IS NOT NULL ORDER BY created_at DESC LIMIT 15`);
await show("migrated db_bill GRN numbers by middle part, FY 26-27", `SELECT SUBSTRING_INDEX(SUBSTRING_INDEX(grn_number,'/',2),'/',-1) mid, MIN(accounting_period) min_p, MAX(accounting_period) max_p, COUNT(*) n FROM grn_request WHERE bill_source_id IS NOT NULL AND grn_number LIKE 'Mas/%/26/%' GROUP BY mid ORDER BY n DESC LIMIT 15`);
process.exit(0);
