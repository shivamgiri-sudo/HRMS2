/**
 * Imprest float reconciliation, round 2 — read-only (HRMS SELECTs capped at 60 s each; db_bill via billQuery).
 *
 *   npx tsx scripts/imprest-float-reconcile.ts
 *
 * 1. Is any GRN debited to more than one float (or twice to one)?
 * 2. What the August-2026 duplicate holder records carry: live vs migrated rows, by month.
 * 3. db_bill vs HRMS per current holder, FY 2026-27: top-ups (imprest_allotment_master) and imprest
 *    GRNs, so "ledger not updated" can be put in rupees.
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
const out = (title: string, rows: unknown[]) => {
  console.log(`\n## ${title} (${rows.length})`);
  for (const r of rows) console.log(`  ${typeof r === "string" ? r : JSON.stringify(r)}`);
};

// Current holders at the live branches, both records each (ids from round 1).
const HOLDERS: Record<string, { hrms: string[]; dbbill: number; branchId: number; userId: number }> = {
  "Shyam Tomar / Jaldarshan": { hrms: ["0cfc8043", "82a9d42a"], dbbill: 30, branchId: 18, userId: 132 },
  "Aman Lawaniya / Noida": { hrms: ["d13a35d5", "bcf3c262"], dbbill: 49, branchId: 9, userId: 288 },
  "Dharmendra / Noida-2": { hrms: ["c3dbde3b", "f515bb17"], dbbill: 47, branchId: 19, userId: 231 },
  "Nitin Aggarwal / Noida-2": { hrms: ["070e89a5"], dbbill: 39, branchId: 19, userId: 194 },
  "HO Imprest (Sanjeev Tyagi)": { hrms: ["44b81c66"], dbbill: 50, branchId: 3, userId: 102 },
};

const ids = new Map<string, string>();
for (const m of await q(`SELECT id FROM imprest_manager`)) ids.set(String(m.id).slice(0, 8), String(m.id));
const full = (p: string) => ids.get(p) ?? p;

out("GRNs debited more than once (any float)", await q(`SELECT n_managers, COUNT(*) grns, SUM(total) amount FROM (
    SELECT reference_id, COUNT(DISTINCT imprest_manager_id) n_managers, COUNT(*) n_rows, SUM(amount) total
      FROM imprest_transaction_ledger WHERE reference_type = 'grn_request' AND direction = 'debit'
     GROUP BY reference_id HAVING COUNT(*) > 1) d GROUP BY n_managers`));
out("GRNs debited more than once, by the records involved", await q(`SELECT recs, COUNT(*) grns, SUM(one_amount) amount FROM (
    SELECT reference_id, GROUP_CONCAT(DISTINCT LEFT(imprest_manager_id,8) ORDER BY imprest_manager_id) recs, MIN(amount) one_amount
      FROM imprest_transaction_ledger WHERE reference_type = 'grn_request' AND direction = 'debit'
     GROUP BY reference_id HAVING COUNT(*) > 1) d GROUP BY recs ORDER BY grns DESC LIMIT 25`));

for (const [who, h] of Object.entries(HOLDERS)) {
  const recs = h.hrms.map(full);
  out(`${who}: HRMS ledger by record, month, type (FY 26-27)`, await q(`SELECT LEFT(imprest_manager_id,8) rec, period_code, entry_type, direction,
      SUM(created_by LIKE '00000000-%') migrated_rows, SUM(created_by NOT LIKE '00000000-%') live_rows, SUM(amount) amount
    FROM imprest_transaction_ledger WHERE imprest_manager_id IN (?) AND period_code >= '2026-04'
    GROUP BY rec, period_code, entry_type, direction ORDER BY period_code, rec, entry_type`, [recs]));
  const allot = (await billQuery<any>(`SELECT DATE_FORMAT(STR_TO_DATE(EntryDate,'%d-%m-%Y'),'%Y-%m') m, COUNT(*) n, SUM(Amount) amt
      FROM imprest_allotment_master WHERE ImprestManagerId = ? AND STR_TO_DATE(EntryDate,'%d-%m-%Y') >= '2026-04-01' GROUP BY m ORDER BY m`, [h.dbbill])) as any[];
  out(`${who}: db_bill top-ups by month (FY 26-27)`, allot);
  const spend = (await billQuery<any>(`SELECT DATE_FORMAT(createdate,'%Y-%m') m, COUNT(*) n, SUM(CAST(Amount AS DECIMAL(16,2))) amt
      FROM expense_entry_master WHERE ExpenseEntryType = 'Imprest' AND userid = ? AND BranchId = ? AND FinanceYear = '2026-27' GROUP BY m ORDER BY m`, [h.userId, h.branchId])) as any[];
  out(`${who}: db_bill imprest GRNs by entry month (FY 26-27)`, spend);
  const allotTotal = allot.reduce((s, a) => s + Number(a.amt), 0);
  const spendTotal = spend.reduce((s, a) => s + Number(a.amt), 0);
  const hrms = await q(`SELECT SUM(CASE WHEN direction='credit' AND entry_type='allocation' THEN amount ELSE 0 END) alloc,
      SUM(CASE WHEN direction='debit' AND entry_type='voucher' THEN amount ELSE 0 END) vouchers
    FROM imprest_transaction_ledger WHERE imprest_manager_id IN (?) AND period_code >= '2026-04'`, [recs]);
  console.log(`  >> FY 26-27 top-ups: db_bill ${allotTotal.toFixed(2)} vs HRMS ${Number(hrms[0]?.alloc ?? 0).toFixed(2)} | spend: db_bill ${spendTotal.toFixed(2)} vs HRMS ${Number(hrms[0]?.vouchers ?? 0).toFixed(2)}`);
}

out("HRMS allocations by status (FY 26-27)", await q(`SELECT status, COUNT(*) n, SUM(amount) amount, SUM(bill_source_id IS NULL) hrms_raised, MAX(allocation_date) latest
    FROM imprest_allocation WHERE allocation_date >= '2026-04-01' GROUP BY status`));
out("db_bill imprest_allotment_master latest entries", (await billQuery<any>(`SELECT Id, ImprestManagerId, Branch, EntryDate, Amount, CreateDate FROM imprest_allotment_master ORDER BY Id DESC LIMIT 12`)) as any[]);
out("HRMS imprest_allocation latest migrated (bill_source_id)", await q(`SELECT MAX(bill_source_id) max_src, MAX(allocation_date) latest, COUNT(*) n FROM imprest_allocation WHERE bill_source_id IS NOT NULL`));
await closeBillPool();
process.exit(0);
