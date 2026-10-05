/**
 * Month shift between db_bill expense entries (FinanceMonth) and the month HRMS recognises them in. READ-ONLY.
 * Joins HRMS vendor_payment_tracking.grn_number to db_bill expense_entry_master.GrnNo; aggregates only.
 *   NT_SHIFT  (hrms recognition month, db_bill FinanceMonth) -> n, sum ex-tax
 *   NT_MISS   db_bill GRNs (Reject=1, FY 2026-27) with no HRMS vendor_payment_tracking row, by FinanceMonth
 *   NT_RECOG  how many HRMS rows carry recognition_period vs fall back to due_date
 *   npx tsx scripts/nonpeople-timing.ts
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { billQuery } from "../src/db/billDb.js";
import type { RowDataPacket } from "mysql2";

const MON: Record<string, string> = { Apr: "2026-04", May: "2026-05", Jun: "2026-06", Jul: "2026-07", Aug: "2026-08", Sep: "2026-09" };
(async () => {
  const bill = await billQuery<any>(
    `SELECT m.GrnNo g, m.FinanceMonth fm, m.BranchId br, m.ExpenseEntryType t, SUM(CAST(p.Amount AS DECIMAL(16,2))) amt
       FROM expense_entry_master m JOIN expense_entry_particular p ON CAST(p.ExpenseEntry AS UNSIGNED) = m.Id
      WHERE m.FinanceYear = '2026-27' AND m.Reject = 1 GROUP BY m.GrnNo, m.FinanceMonth, m.BranchId, m.ExpenseEntryType`);
  const B = new Map<string, any>(); for (const r of bill) B.set(String(r.g).toUpperCase(), r);
  const [vpt] = await db.execute<RowDataPacket[]>(
    `SELECT vpt.grn_number g, vpt.recognition_period rp, DATE_FORMAT(COALESCE(vpt.due_date, vpt.payment_date, vpt.created_at), '%Y-%m') due_m,
            (vpt.bill_source_id IS NOT NULL) fromdb, COALESCE(vpt.amount_without_tax, vpt.due_amount, 0) exg
       FROM vendor_payment_tracking vpt`);
  const shift = new Map<string, { n: number; amt: number }>(); const seen = new Set<string>();
  let withRp = 0, withoutRp = 0;
  for (const v of vpt as any[]) {
    if (v.rp) withRp++; else withoutRp++;
    const g = String(v.g ?? "").toUpperCase(); const b = B.get(g); if (!b) continue; seen.add(g);
    const hm = v.rp ?? v.due_m; const bm = MON[b.fm] ?? b.fm;
    if (!hm || !/^2026-(0[4-9])$/.test(String(hm)) && !/^2026-(0[4-9])$/.test(String(bm))) continue;
    const k = `${hm}|${bm}`; const c = shift.get(k) ?? { n: 0, amt: 0 }; c.n++; c.amt += Number(b.amt ?? 0); shift.set(k, c);
  }
  for (const [k, c] of shift) { const [hm, bm] = k.split("|"); console.log("NT_SHIFT " + JSON.stringify({ hrms_month: hm, dbbill_month: bm, n: c.n, dbbill_amt: Math.round(c.amt) })); }
  const miss = new Map<string, { n: number; amt: number }>();
  for (const [g, b] of B) if (!seen.has(g)) { const m = MON[b.fm] ?? b.fm; const c = miss.get(m) ?? { n: 0, amt: 0 }; c.n++; c.amt += Number(b.amt ?? 0); miss.set(m, c); }
  for (const [m, c] of miss) console.log("NT_MISS " + JSON.stringify({ dbbill_month: m, n: c.n, dbbill_amt: Math.round(c.amt) }));
  console.log("NT_RECOG " + JSON.stringify({ with_recognition_period: withRp, without: withoutRp }));
  await new Promise((resolve) => process.stdout.write("NT_DONE\n", resolve));
  process.exit(0);
})();
