/**
 * Repair the ex-GST amounts of db_bill-migrated GRNs whose GST was stored inside amount_without_tax.
 *
 * WHY: db_bill keeps the taxable value and GST on the bill LINES (expense_entry_particular.Amount / .Tax); the
 * header GST fields are empty. migrate-grn-from-dbbill read the header, saw tax 0 and stored the GROSS as
 * amount_without_tax (tax_amount 0). FY 2026-27: 661 GRNs, ~10 lakh/month of GST counted as P&L cost.
 *
 * WHAT IT WRITES (apply only), for FY 2026-27 migrated GRNs where HRMS amount_without_tax equals the db_bill gross
 * and the db_bill lines carry tax:
 *   grn_request:             amount_without_tax = line taxable, tax_amount = line tax (amount_with_tax unchanged)
 *   vendor_payment_tracking: amount_without_tax and tax_amount scaled by taxable / gross (linked rows)
 *   grn_cost_allocation:     amount_without_tax and tax_amount scaled by taxable / gross (linked rows)
 * Every changed row is printed with its old values (RG_OLD) so it can be reverted exactly.
 *
 *   npx tsx scripts/repair-migrated-grn-ex-gst.ts            # dry-run (default)
 *   npx tsx scripts/repair-migrated-grn-ex-gst.ts --apply
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { billQuery } from "../src/db/billDb.js";
import type { RowDataPacket } from "mysql2";

const APPLY = process.argv.includes("--apply");
(async () => {
  const bill = await billQuery<any>(
    `SELECT m.GrnNo g, SUM(CAST(p.Amount AS DECIMAL(16,2))) taxable, SUM(CAST(p.Tax AS DECIMAL(16,2))) tax, SUM(CAST(p.Total AS DECIMAL(16,2))) gross
       FROM expense_entry_master m JOIN expense_entry_particular p ON CAST(p.ExpenseEntry AS UNSIGNED) = m.Id
      WHERE m.FinanceYear = '2026-27' GROUP BY m.GrnNo`);
  const B = new Map<string, any>(); for (const b of bill) B.set(String(b.g).toUpperCase(), b);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT g.id, g.grn_number, g.accounting_period ap, g.amount_without_tax ax, g.tax_amount tx, g.amount_with_tax wx
       FROM grn_request g WHERE g.bill_source_id IS NOT NULL AND g.financial_year = '2026-27'`);
  const fixes: any[] = [];
  for (const r of rows as any[]) {
    const b = B.get(String(r.grn_number).toUpperCase()); if (!b) continue;
    const taxable = Number(b.taxable), tax = Number(b.tax), gross = Number(b.gross), ax = Number(r.ax ?? 0);
    if (!(tax > 0.5 && gross > 0 && Math.abs(ax - gross) < 2 && Math.abs(ax - taxable) >= 2)) continue;
    fixes.push({ id: r.id, g: r.grn_number, ap: r.ap, ax, tx: Number(r.tx ?? 0), taxable, tax, gross, ratio: taxable / gross });
  }
  const byMonth: Record<string, { n: number; overstated: number }> = {};
  for (const f of fixes) { const m = byMonth[f.ap] ?? { n: 0, overstated: 0 }; m.n++; m.overstated += f.ax - f.taxable; byMonth[f.ap] = m; }
  console.log("RG_PLAN " + JSON.stringify({ grns: fixes.length, overstated_ex_gst_total: Math.round(fixes.reduce((a, f) => a + f.ax - f.taxable, 0)) }));
  for (const [m, v] of Object.entries(byMonth).sort()) console.log("RG_MONTH " + JSON.stringify({ m, n: v.n, overstated: Math.round(v.overstated) }));
  if (!APPLY) { console.log("RG_MODE dry-run: nothing written"); process.exit(0); }

  const conn = await db.getConnection();
  let gN = 0, vN = 0, aN = 0;
  try {
    await conn.beginTransaction();
    for (const f of fixes) {
      const [olds] = await conn.query<RowDataPacket[]>(
        `SELECT 'vpt' t, id, amount_without_tax ax, tax_amount tx FROM vendor_payment_tracking WHERE grn_request_id = ?
         UNION ALL SELECT 'alloc', id, amount_without_tax, tax_amount FROM grn_cost_allocation WHERE grn_request_id = ?`, [f.id, f.id]);
      console.log("RG_OLD " + JSON.stringify({ grn_id: f.id, g: f.g, ax: f.ax, tx: f.tx, linked: olds }));
      const [r1] = await conn.execute<any>(`UPDATE grn_request SET amount_without_tax = ?, tax_amount = ? WHERE id = ? AND ABS(COALESCE(amount_without_tax,0) - ?) < 2`,
        [f.taxable, f.tax, f.id, f.ax]);
      gN += r1.affectedRows;
      const [r2] = await conn.execute<any>(`UPDATE vendor_payment_tracking SET tax_amount = ROUND(COALESCE(amount_without_tax,0) * (1 - ?), 2) + COALESCE(tax_amount,0),
             amount_without_tax = ROUND(COALESCE(amount_without_tax,0) * ?, 2) WHERE grn_request_id = ?`, [f.ratio, f.ratio, f.id]);
      vN += r2.affectedRows;
      const [r3] = await conn.execute<any>(`UPDATE grn_cost_allocation SET tax_amount = ROUND(COALESCE(amount_without_tax,0) * (1 - ?), 2) + COALESCE(tax_amount,0),
             amount_without_tax = ROUND(COALESCE(amount_without_tax,0) * ?, 2) WHERE grn_request_id = ?`, [f.ratio, f.ratio, f.id]);
      aN += r3.affectedRows;
    }
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  console.log("RG_APPLIED " + JSON.stringify({ grn_request: gN, vendor_payment_tracking: vN, grn_cost_allocation: aN }));
  process.exit(0);
})().catch((e) => { console.error("RG_ERROR", e instanceof Error ? e.message : e); process.exit(1); });
