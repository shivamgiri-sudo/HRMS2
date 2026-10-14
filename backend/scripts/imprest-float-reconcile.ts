/**
 * Imprest float reconciliation, round 5 — db_bill only, read-only (billQuery allows SELECT/SHOW only).
 * MAS Callnet (CompId 1).
 *
 *   npx tsx scripts/imprest-float-reconcile.ts
 *
 * What db_bill itself says each current holder's float is: latest top-ups and imprest GRNs, running balance
 * since the holder was appointed, the branch view, any balance-like tables, and whether "Reject = 4" GRNs
 * were re-entered (superseded) or are a separate state.
 */
import "dotenv/config";
import { billQuery, closeBillPool } from "../src/db/billDb.js";

const b = async (sql: string, params: unknown[] = []) => {
  try {
    return (await billQuery<any>(sql, params as any)) as any[];
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
const AMT = "CAST(Amount AS DECIMAL(16,2))";

out("columns that look like a balance / opening / float", await b(`SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME REGEXP 'balance|opening|closing|float|imprest' ORDER BY TABLE_NAME`), 80);
out("tables with imprest in the name, row counts", await b(`SELECT TABLE_NAME, TABLE_ROWS, UPDATE_TIME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE '%imprest%'`));
out("Reject=4 remarks", await b(`SELECT RejectRemarks, COUNT(*) n, SUM(${AMT}) amt FROM expense_entry_master WHERE ExpenseEntryType = 'Imprest' AND Reject = 4 GROUP BY RejectRemarks ORDER BY n DESC LIMIT 15`));

const HOLDERS = [
  { who: "Shyam / Jaldarshan", user: 132, branch: 18, mgr: 30 },
  { who: "Aman / Noida", user: 288, branch: 9, mgr: 49 },
  { who: "Dharmendra / Noida-2", user: 231, branch: 19, mgr: 47 },
  { who: "HO Imprest (Sanjeev)", user: 102, branch: 3, mgr: 50 },
];
for (const h of HOLDERS) {
  console.log(`\n==================== ${h.who} ====================`);
  const mgr = (await b(`SELECT * FROM imprest_manager WHERE Id = ?`, [h.mgr]))[0];
  console.log(`  manager: ${JSON.stringify(mgr)}`);
  out("other db_bill managers for the same login or branch", await b(`SELECT Id, UserId, UserName, TallyHead, BranchId, Active, CreateDate FROM imprest_manager WHERE UserId = ? OR BranchId = ?`, [h.user, h.branch]));
  out("who enters imprest GRNs at this branch (MAS), FY 26-27", await b(`SELECT userid, COUNT(*) n, SUM(${AMT}) amt, MIN(createdate) first, MAX(createdate) last FROM expense_entry_master
    WHERE ExpenseEntryType = 'Imprest' AND CompId = 1 AND BranchId = ? AND FinanceYear = '2026-27' GROUP BY userid`, [h.branch]));
  out("top-ups to this manager by FY", await b(`SELECT LEFT(EntryDate, 4) y, COUNT(*) n, SUM(Amount) amt FROM imprest_allotment_master WHERE ImprestManagerId = ? GROUP BY y`, [h.mgr]));
  out("top-ups to anyone at this branch by FY", await b(`SELECT ImprestManagerId, COUNT(*) n, SUM(Amount) amt, MAX(Id) last_id FROM imprest_allotment_master WHERE BranchId = ? GROUP BY ImprestManagerId`, [h.branch]));
  out("latest 12 top-ups", await b(`SELECT Id, EntryDate, Amount, PaymentMode, PaymentNo, Remarks FROM imprest_allotment_master WHERE ImprestManagerId = ? ORDER BY Id DESC LIMIT 12`, [h.mgr]), 12);
  out("latest 12 imprest GRNs by this login at this branch", await b(`SELECT Id, GrnNo, FinanceMonth, ExpenseDate, ${AMT} amt, Reject, createdate FROM expense_entry_master
    WHERE ExpenseEntryType = 'Imprest' AND userid = ? AND BranchId = ? ORDER BY Id DESC LIMIT 12`, [h.user, h.branch]), 12);

  // Running balance since appointment, and by financial year, with and without Reject=4, MAS only.
  const since = String(mgr?.CreateDate ?? "2000-01-01").slice(0, 10);
  const all = await b(`SELECT FinanceYear fy, Reject, COUNT(*) n, SUM(${AMT}) amt FROM expense_entry_master
    WHERE ExpenseEntryType = 'Imprest' AND CompId = 1 AND userid = ? AND BranchId = ? GROUP BY FinanceYear, Reject ORDER BY FinanceYear`, [h.user, h.branch]);
  out("imprest GRNs by FY and Reject (this login, this branch, MAS)", all);
  const allot = await b(`SELECT CASE WHEN STR_TO_DATE(EntryDate,'%Y-%m-%d') IS NOT NULL THEN EntryDate ELSE DATE_FORMAT(STR_TO_DATE(EntryDate,'%d-%m-%Y'),'%Y-%m-%d') END d, Amount FROM imprest_allotment_master WHERE ImprestManagerId = ?`, [h.mgr]);
  const fyOf = (d: string) => { const y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7)); return m >= 4 ? `${y}-${String(y + 1).slice(2)}` : `${y - 1}-${String(y).slice(2)}`; };
  const allotFy = new Map<string, number>();
  for (const a of allot) if (a.d) allotFy.set(fyOf(String(a.d)), (allotFy.get(fyOf(String(a.d))) ?? 0) + Number(a.Amount));
  const spendFy = new Map<string, number>();
  const spendFyR1 = new Map<string, number>();
  for (const s of all) { spendFy.set(s.fy, (spendFy.get(s.fy) ?? 0) + Number(s.amt)); if (Number(s.Reject) !== 4) spendFyR1.set(s.fy, (spendFyR1.get(s.fy) ?? 0) + Number(s.amt)); }
  const fys = [...new Set([...allotFy.keys(), ...spendFy.keys()])].sort();
  let run = 0, runR1 = 0;
  out("by FY: top-ups, spend, running balance (all / excluding Reject=4)", fys.map((fy) => {
    run += (allotFy.get(fy) ?? 0) - (spendFy.get(fy) ?? 0);
    runR1 += (allotFy.get(fy) ?? 0) - (spendFyR1.get(fy) ?? 0);
    return `${fy}: top-ups ${r2(allotFy.get(fy) ?? 0)} spend ${r2(spendFy.get(fy) ?? 0)} (excl R4 ${r2(spendFyR1.get(fy) ?? 0)}) -> running ${r2(run)} / ${r2(runR1)}`;
  }));
  out("Reject=4 GRNs of this holder: re-entered? (same amount within 45 days, Reject=1)", await b(`SELECT r.Id, r.GrnNo, CAST(r.Amount AS DECIMAL(16,2)) amt, r.createdate, r.RejectRemarks,
      (SELECT MIN(o.GrnNo) FROM expense_entry_master o WHERE o.ExpenseEntryType='Imprest' AND o.userid = r.userid AND o.Reject = 1 AND o.Amount = r.Amount AND ABS(DATEDIFF(o.createdate, r.createdate)) <= 45) reentered_as
    FROM expense_entry_master r WHERE r.ExpenseEntryType = 'Imprest' AND r.Reject = 4 AND r.userid = ? ORDER BY r.Id DESC LIMIT 15`, [h.user]), 15);
}
await closeBillPool();
process.exit(0);
