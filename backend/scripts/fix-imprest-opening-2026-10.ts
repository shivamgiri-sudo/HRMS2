/**
 * Imprest float true-up at the HRMS cutover, 2026-10 (MAS Callnet only).
 *
 *   npx tsx scripts/fix-imprest-opening-2026-10.ts            # dry run
 *   npx tsx scripts/fix-imprest-opening-2026-10.ts --apply    # one adjustment per holder, one transaction
 *
 * After fix-imprest-float-2026-10 (top-ups, merges, closures), each current holder's HRMS float still
 * carries the scrambled migrated history. The float that db_bill itself shows is
 *
 *   top-ups to the holder's db_bill imprest manager  -  imprest GRNs the holder entered at that branch
 *   (MAS, CompId 1; Finance-rejected "Reject = 4" GRNs included: top-ups reimbursed them, the cash was spent)
 *
 * counted from the holder's appointment, except Shyam Tomar whose GRN spend exists in this table only from
 * FY 2020-21 (earlier spend is in db_bill's old expense tables): his float is counted from 1-Apr-2020.
 * HRMS-only spend since (imprest GRNs raised in HRMS that db_bill does not have) is then taken off.
 * One adjustment per holder brings the HRMS float to that figure; nothing else is touched.
 */
import "dotenv/config";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { billQuery, closeBillPool } from "../src/db/billDb.js";
import { db } from "../src/db/mysql.js";
import { imprestLedgerService } from "../src/modules/finance/imprest-ledger.service.js";

const APPLY = process.argv.includes("--apply");
const ACTOR = "00000000-0000-0000-0000-dbbill000001";
const TODAY = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
const r2 = (n: number) => Math.round(n * 100) / 100;
const q = async (sql: string, params: unknown[] = []) => (await db.query<RowDataPacket[]>(sql, params))[0] as any[];
const iso = (v: unknown) => {
  const s = String(v ?? "").trim();
  const m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : "";
};

const HOLDERS = [
  { who: "Aman Lawaniya / Noida", hrms: "bcf3c262", mgr: 49, user: 288, branch: 9, from: "2000-01-01" },
  { who: "Dharmendra / Noida-2", hrms: "f515bb17", mgr: 47, user: 231, branch: 19, from: "2000-01-01" },
  { who: "HO Imprest (Sanjeev Tyagi)", hrms: "44b81c66", mgr: 50, user: 102, branch: 3, from: "2000-01-01" },
  { who: "Shyam Tomar / Jaldarshan", hrms: "82a9d42a", mgr: 30, user: 132, branch: 18, from: "2020-04-01" },
];

console.log(`mode: ${APPLY ? "APPLY" : "dry run (nothing is written)"}; adjustments dated ${TODAY}`);
const ids = new Map<string, any>();
for (const m of await q(`SELECT id, branch_id, active_status FROM imprest_manager`)) ids.set(String(m.id).slice(0, 8), m);

const plan: { h: (typeof HOLDERS)[number]; id: string; branchId: string; current: number; target: number; delta: number }[] = [];
for (const h of HOLDERS) {
  const m = ids.get(h.hrms);
  if (!m || Number(m.active_status) !== 1) throw new Error(`${h.who}: HRMS record ${h.hrms} missing or inactive — run fix-imprest-float-2026-10 first`);
  const allot = (await billQuery<any>(`SELECT EntryDate, Amount FROM imprest_allotment_master WHERE ImprestManagerId = ?`, [h.mgr])) as any[];
  const topups = allot.filter((a) => iso(a.EntryDate) >= h.from).reduce((s, a) => s + Number(a.Amount), 0);
  const legacy = (await billQuery<any>(`SELECT Id, CAST(Amount AS DECIMAL(16,2)) amt, ExpenseDate, bill_date, createdate FROM expense_entry_master
    WHERE ExpenseEntryType = 'Imprest' AND CompId = 1 AND userid = ? AND BranchId = ? AND FinanceYear >= ?`, [h.user, h.branch, h.from === "2020-04-01" ? "2020-21" : "2000-01"])) as any[];
  const spent = legacy.reduce((s, l) => s + Number(l.amt), 0);

  // HRMS-raised imprest GRNs on this float that db_bill does not have (same amount, within a week).
  const live = await q(`SELECT g.grn_number, g.bill_date, l.amount FROM imprest_transaction_ledger l JOIN grn_request g ON g.id = l.reference_id
    WHERE l.imprest_manager_id = ? AND l.reference_type = 'grn_request' AND l.entry_type = 'voucher' AND l.direction = 'debit'
      AND g.bill_source_id IS NULL AND g.created_by NOT LIKE '00000000-%'`, [m.id]);
  const recent = legacy.filter((l) => String(l.createdate) >= "2026-07-01" || iso(l.ExpenseDate) >= "2026-07-01");
  const used = new Set<number>();
  let hrmsOnly = 0, matched = 0;
  for (const g of live) {
    const d = String(g.bill_date ?? "").slice(0, 10);
    const hit = recent.find((l) => !used.has(Number(l.Id)) && Math.abs(Number(l.amt) - Number(g.amount)) <= 1 &&
      Math.abs(Date.parse(iso(l.ExpenseDate) || iso(l.bill_date) || "1970-01-01") - Date.parse(d)) <= 7 * 86400000);
    if (hit) { used.add(Number(hit.Id)); matched++; } else hrmsOnly += Number(g.amount);
  }
  const [[bal]] = (await db.query<RowDataPacket[]>(`SELECT COALESCE(SUM(IF(direction='credit', amount, -amount)), 0) b FROM imprest_transaction_ledger WHERE imprest_manager_id = ?`, [m.id])) as any;
  const current = r2(Number(bal.b));
  const target = r2(topups - spent - hrmsOnly);
  plan.push({ h, id: String(m.id), branchId: String(m.branch_id), current, target, delta: r2(target - current) });
  console.log(`\n${h.who}: db_bill top-ups ${r2(topups)} - db_bill imprest GRNs ${r2(spent)} (${legacy.length}) - HRMS-only spend ${r2(hrmsOnly)} (${live.length - matched} of ${live.length} HRMS GRNs) = ${target}; HRMS now ${current}; adjustment ${r2(target - current)}`);
}

if (APPLY) {
  const conn = (await db.getConnection()) as PoolConnection;
  try {
    await conn.beginTransaction();
    for (const p of plan) {
      if (p.delta === 0) continue;
      await imprestLedgerService.post({
        imprestManagerId: p.id, branchId: p.branchId, entryType: "adjustment", direction: p.delta > 0 ? "credit" : "debit",
        amount: Math.abs(p.delta), transactionDate: TODAY, referenceType: "manual", referenceId: null, actorUserId: ACTOR,
        narration: `Float set to ${p.target.toFixed(2)} at HRMS cutover ${TODAY}: db_bill top-ups less imprest GRNs (MAS)${p.h.from !== "2000-01-01" ? ` since ${p.h.from}` : ""}, less HRMS-only spend`,
      }, conn);
    }
    await conn.commit();
    console.log("\nAPPLIED (one transaction).");
  } catch (e) {
    await conn.rollback();
    console.log(`\nROLLED BACK: ${(e as Error).message}`);
    process.exitCode = 1;
  } finally {
    conn.release();
  }
  for (const p of plan) {
    const [[bal]] = (await db.query<RowDataPacket[]>(`SELECT COALESCE(SUM(IF(direction='credit', amount, -amount)), 0) b FROM imprest_transaction_ledger WHERE imprest_manager_id = ?`, [p.id])) as any;
    console.log(`  ${p.h.who}: HRMS float now ${r2(Number(bal.b))} (target ${p.target})`);
  }
}
await closeBillPool();
process.exit(process.exitCode ?? 0);
