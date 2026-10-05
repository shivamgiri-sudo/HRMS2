/**
 * Every HRMS table the P&L non-people cost can read, aggregated per month and branch. READ-ONLY.
 * Aggregates only (no vendor names / invoice numbers).
 *   NS_VPT    vendor_payment_tracking by recognition period
 *   NS_GRN    grn_request (not linked to a vendor_payment_tracking row = the second leg of getGrnVendorActuals)
 *   NS_ALLOC  grn_cost_allocation by lifecycle (the overlay's allocation view)
 *   NS_SNAP   grn_entry_snapshot (the db_bill expense mirror) by period
 *   npx tsx scripts/hrms-nonpeople-sources.ts
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import type { RowDataPacket } from "mysql2";

const P = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08"];
const IN = P.map(() => "?").join(",");
const run = async (tag: string, sql: string, params: unknown[] = P) => {
  try { const [rows] = await db.execute<RowDataPacket[]>(sql, params); for (const r of rows) console.log(`${tag} ${JSON.stringify(r)}`); }
  catch (e) { console.log(`${tag} ERROR ${e instanceof Error ? e.message : String(e)}`); }
};
(async () => {
  await run("NS_VPT", `
    SELECT COALESCE(vpt.recognition_period, DATE_FORMAT(COALESCE(vpt.due_date, vpt.payment_date, vpt.created_at), '%Y-%m')) p, bm.branch_name br, vpt.cost_class cls, vpt.pnl_bucket bucket,
           LOWER(REPLACE(COALESCE(vpt.payment_status,''),'_',' ')) st, (vpt.bill_source_id IS NOT NULL) from_dbbill, (vpt.grn_request_id IS NOT NULL) has_grn,
           COUNT(*) n, ROUND(SUM(COALESCE(vpt.amount_without_tax, vpt.due_amount, 0)),0) ex_gst, ROUND(SUM(COALESCE(vpt.due_amount,0)),0) due
      FROM vendor_payment_tracking vpt LEFT JOIN branch_master bm ON bm.id = vpt.branch_id
     WHERE COALESCE(vpt.recognition_period, DATE_FORMAT(COALESCE(vpt.due_date, vpt.payment_date, vpt.created_at), '%Y-%m')) IN (${IN})
     GROUP BY p, br, cls, bucket, st, from_dbbill, has_grn`);
  await run("NS_GRN", `
    SELECT COALESCE(g.recognition_period, DATE_FORMAT(COALESCE(g.bill_date, g.reviewed_at, g.created_at), '%Y-%m')) p, g.accounting_period acct, bm.branch_name br, g.cost_class cls, g.pnl_bucket bucket,
           LOWER(REPLACE(COALESCE(g.status,''),'_',' ')) st, (g.bill_source_id IS NOT NULL) from_dbbill, (COALESCE(g.created_by,'') LIKE '00000000-%') sys_user,
           (EXISTS (SELECT 1 FROM vendor_payment_tracking v WHERE v.grn_request_id = g.id)) has_vpt, (EXISTS (SELECT 1 FROM grn_cost_allocation a WHERE a.grn_request_id = g.id)) has_alloc,
           COUNT(*) n, ROUND(SUM(COALESCE(g.amount_without_tax, g.amount, 0)),0) ex_gst
      FROM grn_request g LEFT JOIN branch_master bm ON bm.id = g.branch_id
     WHERE COALESCE(g.recognition_period, DATE_FORMAT(COALESCE(g.bill_date, g.reviewed_at, g.created_at), '%Y-%m')) IN (${IN}) OR g.accounting_period IN (${IN})
     GROUP BY p, acct, br, cls, bucket, st, from_dbbill, sys_user, has_vpt, has_alloc`, [...P, ...P]);
  await run("NS_ALLOC", `
    SELECT a.recognition_period p, a.lifecycle_status lc, bm.branch_name br, a.cost_class cls, a.pnl_bucket bucket, (gr.bill_source_id IS NOT NULL) from_dbbill, (COALESCE(gr.created_by,'') LIKE '00000000-%') sys_user,
           COUNT(*) n, ROUND(SUM(COALESCE(a.amount_without_tax,0)),0) ex_gst
      FROM grn_cost_allocation a JOIN grn_request gr ON gr.id = a.grn_request_id LEFT JOIN branch_master bm ON bm.id = a.branch_id
     WHERE a.recognition_period IN (${IN}) GROUP BY p, lc, br, cls, bucket, from_dbbill, sys_user`);
  await run("NS_SNAP", `
    SELECT s.period_code p, s.branch_name br, s.entry_status est, s.is_rejected rej, COUNT(*) n, ROUND(SUM(s.amount),0) amt, ROUND(SUM(COALESCE(s.cgst,0)+COALESCE(s.sgst,0)+COALESCE(s.igst,0)),0) gst
      FROM grn_entry_snapshot s WHERE s.period_code IN (${IN}) GROUP BY p, br, est, rej`);
  await new Promise((resolve) => process.stdout.write("NS_DONE\n", resolve));
  process.exit(0);
})();
