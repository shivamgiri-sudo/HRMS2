/**
 * Which month each GRN reader would use, vs the GRN's accounting month. READ-ONLY, aggregates only.
 *   GM_REQ   grn_request: accounting_period vs recognition_period vs raised month (created_at) vs bill month
 *   GM_VPT   vendor_payment_tracking: recognition_period vs linked grn accounting_period vs due month
 *   GM_ALLOC grn_cost_allocation (consumed): recognition_period vs grn accounting_period vs bill month
 *   npx tsx scripts/grn-month-basis-audit.ts
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import type { RowDataPacket } from "mysql2";

const run = async (tag: string, sql: string) => {
  try { const [rows] = await db.execute<RowDataPacket[]>(sql); for (const r of rows) console.log(`${tag} ${JSON.stringify(r)}`); }
  catch (e) { console.log(`${tag} ERROR ${e instanceof Error ? e.message : String(e)}`); }
};
(async () => {
  await run("GM_REQ", `
    SELECT (g.bill_source_id IS NOT NULL) from_dbbill,
           (g.accounting_period IS NULL) acct_null, (g.recognition_period IS NULL) recog_null,
           (g.accounting_period = g.recognition_period) acct_eq_recog,
           (g.accounting_period = DATE_FORMAT(g.created_at,'%Y-%m')) acct_eq_raised,
           (g.accounting_period = DATE_FORMAT(COALESCE(g.service_period_end, g.bill_date),'%Y-%m')) acct_eq_bill,
           COUNT(*) n, ROUND(SUM(COALESCE(g.amount_without_tax, g.amount, 0))) ex_gst
      FROM grn_request g
     WHERE COALESCE(g.accounting_period, g.recognition_period, DATE_FORMAT(g.created_at,'%Y-%m')) BETWEEN '2026-04' AND '2026-09'
     GROUP BY 1,2,3,4,5,6`);
  await run("GM_VPT", `
    SELECT (v.bill_source_id IS NOT NULL) from_dbbill, (v.recognition_period IS NULL) recog_null, (g.id IS NULL) no_grn,
           (v.recognition_period = g.accounting_period) recog_eq_acct,
           (DATE_FORMAT(COALESCE(v.due_date, v.created_at),'%Y-%m') = g.accounting_period) due_eq_acct,
           COUNT(*) n, ROUND(SUM(COALESCE(v.amount_without_tax, v.due_amount, 0))) ex_gst
      FROM vendor_payment_tracking v LEFT JOIN grn_request g ON g.id = v.grn_request_id
     WHERE COALESCE(v.recognition_period, g.accounting_period, DATE_FORMAT(COALESCE(v.due_date, v.created_at),'%Y-%m')) BETWEEN '2026-04' AND '2026-09'
     GROUP BY 1,2,3,4,5`);
  await run("GM_ALLOC", `
    SELECT (g.bill_source_id IS NOT NULL) from_dbbill, (a.recognition_period IS NULL) recog_null,
           (a.recognition_period = g.accounting_period) recog_eq_acct,
           (DATE_FORMAT(COALESCE(g.service_period_end, g.bill_date, g.reviewed_at, g.created_at),'%Y-%m') = g.accounting_period) bill_eq_acct,
           COUNT(*) n, ROUND(SUM(COALESCE(a.amount_without_tax,0))) ex_gst
      FROM grn_cost_allocation a JOIN grn_request g ON g.id = a.grn_request_id
     WHERE a.lifecycle_status = 'consumed'
       AND COALESCE(a.recognition_period, g.accounting_period) BETWEEN '2026-04' AND '2026-09'
     GROUP BY 1,2,3,4`);
  await new Promise((r) => process.stdout.write("GM_DONE\n", r));
  process.exit(0);
})();
