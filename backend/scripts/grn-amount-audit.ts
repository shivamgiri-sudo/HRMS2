/**
 * Ex-GST amount check: HRMS migrated GRNs vs db_bill taxable value. READ-ONLY, aggregates + top examples.
 * db_bill taxable = SUM(expense_entry_particular.Amount); db_bill gross = SUM(Total).
 *   GA_MONTH  per accounting month: db_bill taxable, db_bill gross, HRMS grn_request ex-GST, vpt ex-GST, allocation ex-GST
 *   GA_CLASS  how many GRNs have HRMS ex-GST == taxable / == gross / other
 *   GA_EX     largest mismatches
 *   npx tsx scripts/grn-amount-audit.ts
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import { billQuery } from "../src/db/billDb.js";
import type { RowDataPacket } from "mysql2";

const MON: Record<string, string> = { Apr: "2026-04", May: "2026-05", Jun: "2026-06", Jul: "2026-07", Aug: "2026-08", Sep: "2026-09" };
(async () => {
  const bill = await billQuery<any>(
    `SELECT m.GrnNo g, m.FinanceMonth fm, SUM(CAST(p.Amount AS DECIMAL(16,2))) taxable, SUM(CAST(p.Total AS DECIMAL(16,2))) gross
       FROM expense_entry_master m JOIN expense_entry_particular p ON CAST(p.ExpenseEntry AS UNSIGNED) = m.Id
      WHERE m.FinanceYear = '2026-27' AND m.Reject = 1 GROUP BY m.GrnNo, m.FinanceMonth`);
  const [h] = await db.execute<RowDataPacket[]>(
    `SELECT g.grn_number g, g.accounting_period ap, COALESCE(g.amount_without_tax, g.amount, 0) gx, COALESCE(g.amount_with_tax, 0) gw, COALESCE(g.tax_amount,0) gt,
            (SELECT SUM(COALESCE(v.amount_without_tax, v.due_amount, 0)) FROM vendor_payment_tracking v WHERE v.grn_request_id = g.id) vx,
            (SELECT SUM(COALESCE(a.amount_without_tax,0)) FROM grn_cost_allocation a WHERE a.grn_request_id = g.id AND a.lifecycle_status = 'consumed') ax
       FROM grn_request g WHERE g.bill_source_id IS NOT NULL AND g.financial_year = '2026-27'`);
  const H = new Map<string, any>(); for (const r of h as any[]) H.set(String(r.g).toUpperCase(), r);
  const mon = new Map<string, any>(); const cls: Record<string, number> = {}; const ex: any[] = [];
  for (const b of bill) {
    const m = MON[b.fm]; if (!m) continue;
    const r = H.get(String(b.g).toUpperCase());
    const t = Number(b.taxable), gr = Number(b.gross), gx = r ? Number(r.gx) : 0;
    const o = mon.get(m) ?? { taxable: 0, gross: 0, hrms_grn: 0, hrms_vpt: 0, hrms_alloc: 0, missing: 0 };
    o.taxable += t; o.gross += gr; if (r) { o.hrms_grn += gx; o.hrms_vpt += Number(r.vx ?? 0); o.hrms_alloc += Number(r.ax ?? 0); } else o.missing += t;
    mon.set(m, o);
    const k = !r ? "missing" : Math.abs(gx - t) < 2 ? "eq_taxable" : Math.abs(gx - gr) < 2 ? "eq_gross" : "other";
    cls[k] = (cls[k] ?? 0) + 1;
    if (r && k !== "eq_taxable") ex.push({ g: b.g, m, taxable: Math.round(t), gross: Math.round(gr), hrms_ex: Math.round(gx), hrms_with: Math.round(Number(r.gw)), hrms_tax: Math.round(Number(r.gt)), diff: Math.round(gx - t) });
  }
  for (const [m, o] of [...mon].sort()) console.log("GA_MONTH " + JSON.stringify({ m, ...Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v as number)])) }));
  console.log("GA_CLASS " + JSON.stringify(cls));
  for (const e of ex.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)).slice(0, 15)) console.log("GA_EX " + JSON.stringify(e));
  await new Promise((r) => process.stdout.write("GA_DONE\n", r));
  process.exit(0);
})();
