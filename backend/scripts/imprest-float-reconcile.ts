/**
 * Imprest float reconciliation, round 4 — read-only (HRMS SELECTs capped at 60 s; db_bill via billQuery).
 * MAS Callnet only (db_bill CompId 1).
 *
 *   npx tsx scripts/imprest-float-reconcile.ts
 *
 * Per current holder: the db_bill float (allotments minus imprest GRNs, by Reject flag), the latest db_bill
 * activity, and the HRMS-raised imprest GRNs since August next to db_bill's (same person, amount and date)
 * to see whether they are double entries or HRMS-only spend.
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
const iso = (v: unknown) => {
  const s = String(v ?? "").trim();
  const m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : "";
};

out("db_bill Reject values on imprest GRNs, all years, MAS", (await billQuery<any>(`SELECT Reject, COUNT(*) n, SUM(CAST(Amount AS DECIMAL(16,2))) amt, MIN(createdate) first, MAX(createdate) last, MAX(RejectRemarks) sample_remark
  FROM expense_entry_master WHERE ExpenseEntryType = 'Imprest' AND CompId = 1 GROUP BY Reject`)) as any[]);
out("db_bill imprest GRNs by company", (await billQuery<any>(`SELECT CompId, COUNT(*) n, SUM(CAST(Amount AS DECIMAL(16,2))) amt FROM expense_entry_master WHERE ExpenseEntryType = 'Imprest' GROUP BY CompId`)) as any[]);
out("imprest_allotment_master columns", (await billQuery<any>(`SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'imprest_allotment_master'`)) as any[]);

const HOLDERS = [
  { who: "Dharmendra / Noida-2", user: 231, branch: 19, mgr: 47, hrms: ["c3dbde3b", "f515bb17"] },
  { who: "Aman / Noida", user: 288, branch: 9, mgr: 49, hrms: ["d13a35d5", "bcf3c262"] },
  { who: "Shyam / Jaldarshan", user: 132, branch: 18, mgr: 30, hrms: ["0cfc8043", "82a9d42a"] },
  { who: "HO Imprest (Sanjeev)", user: 102, branch: 3, mgr: 50, hrms: ["44b81c66"] },
];
const ids = new Map<string, string>();
for (const m of await q(`SELECT id FROM imprest_manager`)) ids.set(String(m.id).slice(0, 8), String(m.id));

for (const h of HOLDERS) {
  const recs = h.hrms.map((p) => ids.get(p)!).filter(Boolean);
  const allot = (await billQuery<any>(`SELECT COUNT(*) n, SUM(Amount) amt, MAX(Id) last_id, MAX(EntryDate) last_date FROM imprest_allotment_master WHERE ImprestManagerId = ?`, [h.mgr])) as any[];
  const spend = (await billQuery<any>(`SELECT Reject, COUNT(*) n, SUM(CAST(Amount AS DECIMAL(16,2))) amt, MAX(createdate) last FROM expense_entry_master
    WHERE ExpenseEntryType = 'Imprest' AND CompId = 1 AND userid = ? AND BranchId = ? GROUP BY Reject`, [h.user, h.branch])) as any[];
  const spentOk = spend.filter((s) => Number(s.Reject) !== 4).reduce((s, x) => s + Number(x.amt), 0);
  const spentAll = spend.reduce((s, x) => s + Number(x.amt), 0);
  console.log(`\n==================== ${h.who} ====================`);
  console.log(JSON.stringify({ allot: allot[0], spend, dbbill_balance_excl_R4: r2(Number(allot[0]?.amt ?? 0) - spentOk), dbbill_balance_all: r2(Number(allot[0]?.amt ?? 0) - spentAll) }));
  const hrmsBal = await q(`SELECT LEFT(imprest_manager_id,8) rec, SUM(IF(direction='credit', amount, -amount)) bal FROM imprest_transaction_ledger WHERE imprest_manager_id IN (?) GROUP BY rec`, [recs]);
  console.log(`  HRMS balances: ${JSON.stringify(hrmsBal)}`);

  // HRMS-raised imprest GRNs since August for this person vs db_bill's imprest GRNs since July.
  const live = await q(`SELECT g.grn_number, g.status, g.bill_date, g.created_at, COALESCE(NULLIF(g.amount_with_tax,0), g.amount) amt, g.sub_head, g.description
    FROM grn_request g WHERE g.grn_type = 'imprest' AND g.bill_source_id IS NULL AND g.created_by NOT LIKE '00000000-%'
      AND (g.imprest_manager_id IN (?) OR EXISTS (SELECT 1 FROM imprest_transaction_ledger l WHERE l.reference_type='grn_request' AND l.reference_id = g.id AND l.imprest_manager_id IN (?)))`, [recs, recs]);
  const legacy = (await billQuery<any>(`SELECT Id, GrnNo, CAST(Amount AS DECIMAL(16,2)) amt, bill_date, ExpenseDate, createdate, Description FROM expense_entry_master
    WHERE ExpenseEntryType = 'Imprest' AND CompId = 1 AND userid = ? AND BranchId = ? AND createdate >= '2026-07-01'`, [h.user, h.branch])) as any[];
  const used = new Set<number>();
  let matched = 0, matchedAmt = 0;
  const unmatched: string[] = [];
  for (const g of live) {
    const d = String(g.bill_date ?? "").slice(0, 10);
    const hit = legacy.find((l) => !used.has(Number(l.Id)) && Math.abs(Number(l.amt) - Number(g.amt)) <= 1 && (iso(l.bill_date) === d || iso(l.ExpenseDate) === d || Math.abs(Date.parse(iso(l.ExpenseDate) || "1970-01-01") - Date.parse(d)) <= 7 * 86400000));
    if (hit) { used.add(Number(hit.Id)); matched++; matchedAmt += Number(g.amt); }
    else unmatched.push(`${g.grn_number} ${g.status} ${d} ${g.amt} ${String(g.sub_head ?? "")}`);
  }
  console.log(`  HRMS-raised imprest GRNs: ${live.length} (${r2(live.reduce((s, g) => s + Number(g.amt), 0))}); also in db_bill: ${matched} (${r2(matchedAmt)}); db_bill imprest GRNs since July: ${legacy.length} (${r2(legacy.reduce((s, l) => s + Number(l.amt), 0))}), last ${legacy.map((l) => String(l.createdate)).sort().pop() ?? "-"}`);
  out("HRMS-only (not found in db_bill)", unmatched, 12);
}
await closeBillPool();
process.exit(0);
