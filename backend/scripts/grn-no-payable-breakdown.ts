/**
 * Read-only: approved GRNs with no vendor payable, by accounting month, branch, origin and GRN type, ex-GST.
 *   NP_ROW  aggregates;  NP_TOP  largest 15 for one month (employee_codes input = YYYY-MM)
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import type { RowDataPacket } from "mysql2";
const ST = `LOWER(REPLACE(COALESCE(g.status, ''), '_', ' ')) IN ('approved','finance head approved','pending accounts payment','payment scheduled','partially paid','paid','posted')`;
(async () => {
  const m = process.argv[2] ?? "2026-08";
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT g.accounting_period p, bm.branch_name br, (g.bill_source_id IS NOT NULL) from_dbbill, g.grn_type t, g.status st, COALESCE(g.cost_class,'-') cls,
            COUNT(*) n, ROUND(SUM(COALESCE(g.amount_without_tax, g.amount, 0))) ex
       FROM grn_request g LEFT JOIN branch_master bm ON bm.id = g.branch_id
      WHERE g.accounting_period BETWEEN '2026-04' AND '2026-09' AND ${ST}
        AND NOT EXISTS (SELECT 1 FROM vendor_payment_tracking vx WHERE vx.grn_request_id = g.id)
      GROUP BY 1,2,3,4,5,6 ORDER BY 1,2`);
  for (const r of rows) console.log("NP_ROW " + JSON.stringify(r));
  const [top] = await db.execute<RowDataPacket[]>(
    `SELECT g.grn_number, bm.branch_name br, g.grn_type t, g.status st, (g.bill_source_id IS NOT NULL) from_dbbill, g.head, ROUND(COALESCE(g.amount_without_tax, g.amount, 0)) ex
       FROM grn_request g LEFT JOIN branch_master bm ON bm.id = g.branch_id
      WHERE g.accounting_period = ? AND ${ST} AND NOT EXISTS (SELECT 1 FROM vendor_payment_tracking vx WHERE vx.grn_request_id = g.id)
      ORDER BY ex DESC LIMIT 15`, [m]);
  for (const r of top) console.log("NP_TOP " + JSON.stringify(r));
  process.exit(0);
})();
