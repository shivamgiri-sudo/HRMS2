/**
 * Imprest float reconciliation, round 3 — read-only (HRMS SELECTs capped at 60 s; db_bill via billQuery).
 *
 *   npx tsx scripts/imprest-float-reconcile.ts
 *
 * GRN by GRN for the current holders: which db_bill imprest GRNs count (status flags), how the HRMS
 * ledger debits map onto them (one legacy GRN debited more than once through parent/child rows,
 * debits for GRNs db_bill does not count), and allotments vs HRMS allocation credits.
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { billQuery, closeBillPool } from "../src/db/billDb.js";
import { db } from "../src/db/mysql.js";

const q = async (sql: string, params: unknown[] = []) => {
  if (!/^\s*SELECT\b/i.test(sql)) throw new Error("read-only");
  try {
    return (await db.query<RowDataPacket[]>(sql.replace(/^\s*SELECT/i, "SELECT /*+ MAX_EXECUTION_TIME(60000) */"), params))[0] as any[];
  } catch (e) {
    console.log(`ERROR ${(e as Error).message}`);
    return [];
  }
};
const out = (title: string, rows: unknown[], max = 40) => {
  console.log(`\n## ${title} (${rows.length})`);
  for (const r of rows.slice(0, max)) console.log(`  ${typeof r === "string" ? r : JSON.stringify(r)}`);
};
const r2 = (n: number) => Math.round(n * 100) / 100;

out("db_bill imprest GRN flag combinations (FY 2025-26/26-27)", (await billQuery<any>(`SELECT EntryStatus, grn_status, Reject, PendingGrn, payment_processing, COUNT(*) n, SUM(CAST(Amount AS DECIMAL(16,2))) amt
  FROM expense_entry_master WHERE ExpenseEntryType = 'Imprest' AND FinanceYear IN ('2025-26','2026-27') GROUP BY 1,2,3,4,5 ORDER BY n DESC`)) as any[]);
out("db_bill tables that may hold the imprest balance logic", (await billQuery<any>(`SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
  AND (TABLE_NAME LIKE '%imprest%' OR COLUMN_NAME LIKE '%imprest%' OR COLUMN_NAME LIKE '%balance%') ORDER BY TABLE_NAME`)) as any[], 80);

const HOLDERS = [
  { who: "Dharmendra / Noida-2", user: 231, branch: 19, mgr: 47, hrms: ["c3dbde3b", "f515bb17"] },
  { who: "Aman / Noida", user: 288, branch: 9, mgr: 49, hrms: ["d13a35d5", "bcf3c262"] },
  { who: "Shyam / Jaldarshan", user: 132, branch: 18, mgr: 30, hrms: ["0cfc8043", "82a9d42a"] },
  { who: "HO Imprest", user: 102, branch: 3, mgr: 50, hrms: ["44b81c66"] },
];
const allIds = new Map<string, string>();
for (const m of await q(`SELECT id FROM imprest_manager`)) allIds.set(String(m.id).slice(0, 8), String(m.id));

for (const h of HOLDERS) {
  const recs = h.hrms.map((p) => allIds.get(p)!).filter(Boolean);
  const legacy = (await billQuery<any>(`SELECT Id, GrnNo, CAST(Amount AS DECIMAL(16,2)) amt, EntryStatus, Reject, createdate, FinanceYear
    FROM expense_entry_master WHERE ExpenseEntryType = 'Imprest' AND userid = ? AND BranchId = ?`, [h.user, h.branch])) as any[];
  const deleted = new Set<number>();
  try {
    for (const d of (await billQuery<any>(`SELECT Id FROM expense_entry_master_delete WHERE ExpenseEntryType = 'Imprest' AND userid = ?`, [h.user])) as any[]) deleted.add(Number(d.Id));
  } catch (e) {
    console.log(`(delete table not readable: ${(e as Error).message})`);
  }
  const allot = (await billQuery<any>(`SELECT Id, Amount FROM imprest_allotment_master WHERE ImprestManagerId = ?`, [h.mgr])) as any[];

  // HRMS: every ledger row on the person's records, with the GRN it points at.
  const rows = await q(`SELECT l.entry_type, l.direction, l.amount, l.reference_type, l.reference_id, l.created_by, g.grn_number, g.bill_source_id, g.status, g.grn_type
    FROM imprest_transaction_ledger l LEFT JOIN grn_request g ON l.reference_type = 'grn_request' AND g.id = l.reference_id
    WHERE l.imprest_manager_id IN (?)`, [recs]);
  const legacyIdOf = (r: any) => (r.bill_source_id ? Number(r.bill_source_id) : Number(String(r.grn_number ?? "").match(/-(\d+)$/)?.[1] ?? 0));
  const byLegacy = new Map<number, any[]>();
  for (const r of rows) if (r.reference_type === "grn_request" && r.direction === "debit") { const k = legacyIdOf(r); if (!byLegacy.has(k)) byLegacy.set(k, []); byLegacy.get(k)!.push(r); }
  const legacyById = new Map(legacy.map((l) => [Number(l.Id), l]));
  const multi = [...byLegacy.entries()].filter(([k, v]) => k && v.length > 1);
  const notInLegacy = [...byLegacy.entries()].filter(([k]) => k && !legacyById.has(k));
  const liveHrms = [...byLegacy.entries()].filter(([k]) => !k);
  const legacyNotDebited = legacy.filter((l) => !byLegacy.has(Number(l.Id)));
  const sum = (a: any[], f: (x: any) => number) => r2(a.reduce((s, x) => s + f(x), 0));
  const allocRows = rows.filter((r) => r.entry_type === "allocation");
  console.log(`\n==================== ${h.who} ====================`);
  console.log(JSON.stringify({
    legacy_grns: legacy.length, legacy_amt: sum(legacy, (l) => Number(l.amt)),
    legacy_by_status: legacy.reduce((a: any, l) => { const k = `${l.EntryStatus}/R${l.Reject}`; a[k] = r2((a[k] ?? 0) + Number(l.amt)); return a; }, {}),
    legacy_in_delete_table: legacy.filter((l) => deleted.has(Number(l.Id))).length,
    allot_n: allot.length, allot_amt: sum(allot, (a) => Number(a.Amount)),
    hrms_alloc_n: allocRows.length, hrms_alloc_amt: sum(allocRows, (r) => Number(r.amount)),
    hrms_grn_debits: sum(rows.filter((r) => r.reference_type === "grn_request" && r.direction === "debit"), (r) => Number(r.amount)),
    debited_more_than_once: multi.length, extra_amt: sum(multi, ([, v]) => v.slice(1).reduce((s: number, x: any) => s + Number(x.amount), 0)),
    debits_for_grns_not_this_holders_in_dbbill: notInLegacy.length, their_amt: sum(notInLegacy, ([, v]) => v.reduce((s: number, x: any) => s + Number(x.amount), 0)),
    live_hrms_grn_debits: sum(liveHrms, ([, v]) => v.reduce((s: number, x: any) => s + Number(x.amount), 0)),
    legacy_grns_not_debited: legacyNotDebited.length, their_legacy_amt: sum(legacyNotDebited, (l) => Number(l.amt)),
    other_rows: rows.filter((r) => r.reference_type !== "grn_request" && r.entry_type !== "allocation").reduce((a: any, r) => { const k = `${r.entry_type}/${r.direction}`; a[k] = r2((a[k] ?? 0) + Number(r.amount)); return a; }, {}),
  }, null, 0));
  out("sample: one legacy GRN debited more than once", multi.slice(0, 5).map(([k, v]) => `${k} ${legacyById.get(k)?.GrnNo} ${legacyById.get(k)?.amt}: ${v.map((x: any) => `${x.grn_number}=${x.amount}`).join(", ")}`), 5);
  out("sample: legacy GRNs not debited", legacyNotDebited.slice(0, 8).map((l) => `${l.Id} ${l.GrnNo} ${l.amt} ${l.EntryStatus}/R${l.Reject} ${String(l.createdate).slice(0, 10)}`), 8);
}
await closeBillPool();
process.exit(0);
