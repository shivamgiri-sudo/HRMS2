/** Neelakanth rent raised in HRMS (read-only): GRNs and vendor payables mentioning rent on Neelakanth cost centres, by accounting period. */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";

const show = async (tag: string, sql: string) => {
  try { const [rows] = await db.execute<RowDataPacket[]>(sql); for (const r of rows) console.log(`${tag} ${JSON.stringify(r)}`); if (!rows.length) console.log(`${tag} (no rows)`); }
  catch (e) { console.log(`${tag} ERROR ${e instanceof Error ? e.message : String(e)}`); }
};
(async () => {
  const NK = `(UPPER(COALESCE(bm.branch_name,'')) LIKE '%NEELAKANTH%' OR UPPER(ccm.cost_centre_code) LIKE '%NEELA%')`;
  await show("NKH_GRN", `SELECT gr.accounting_period p, gr.status, (gr.bill_source_id IS NOT NULL) imported, gr.head, gr.sub_head, COUNT(*) n, ROUND(SUM(COALESCE(NULLIF(gr.amount_without_tax,0), gr.amount_with_tax - COALESCE(gr.tax_amount,0), gr.amount, 0))) amt
     FROM grn_request gr JOIN cost_centre_master ccm ON ccm.id = gr.cost_centre_id LEFT JOIN branch_master bm ON bm.id = ccm.branch_id
    WHERE ${NK} AND gr.accounting_period >= '2026-04' AND (LOWER(COALESCE(gr.head,'')) LIKE '%rent%' OR LOWER(COALESCE(gr.sub_head,'')) LIKE '%rent%' OR LOWER(COALESCE(gr.vendor_name,'')) LIKE '%rent%')
    GROUP BY 1,2,3,4,5 ORDER BY 1,2`);
  await show("NKH_ANY_SPEND", `SELECT gr.accounting_period p, COUNT(*) n, ROUND(SUM(COALESCE(NULLIF(gr.amount_without_tax,0), gr.amount_with_tax - COALESCE(gr.tax_amount,0), gr.amount, 0))) amt
     FROM grn_request gr JOIN cost_centre_master ccm ON ccm.id = gr.cost_centre_id LEFT JOIN branch_master bm ON bm.id = ccm.branch_id
    WHERE ${NK} AND gr.accounting_period >= '2026-04' AND gr.status NOT IN ('draft','cancelled','rejected') GROUP BY 1 ORDER BY 1`);
  await show("NKH_CC_STATE", `SELECT ccm.cost_centre_code code, ccm.active_status active, ccm.close_date, bm.branch_name branch, bm.active_status branch_active FROM cost_centre_master ccm LEFT JOIN branch_master bm ON bm.id = ccm.branch_id WHERE ${NK}`);
  await new Promise((resolve) => process.stdout.write("NKH_DONE\n", resolve));
  process.exit(0);
})();
