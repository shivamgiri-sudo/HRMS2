/** What each GRN source holds per accounting month. READ-ONLY, counts and totals only. */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";

const show = async (tag: string, sql: string) => {
  try { const [rows] = await db.execute<RowDataPacket[]>(sql); for (const r of rows) console.log(`${tag} ${JSON.stringify(r)}`); if (!rows.length) console.log(`${tag} (no rows)`); }
  catch (e) { console.log(`${tag} ERROR ${e instanceof Error ? e.message : String(e)}`); }
};
(async () => {
  await show("DIAG_TABLES", `SELECT table_name t, table_rows r FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN ('grn_entry_snapshot','grn_entry_line_snapshot','grn_request','grn_cost_allocation','vendor_payment_tracking')`);
  await show("DIAG_MIRROR_LINES", `SELECT ge.period_code p, ge.is_rejected rej, COUNT(*) n, ROUND(SUM(l.amount)) amt FROM grn_entry_line_snapshot l JOIN grn_entry_snapshot ge ON ge.bill_source_id = l.grn_source_id GROUP BY ge.period_code, ge.is_rejected ORDER BY 1,2`);
  await show("DIAG_MIRROR_HEADERS", `SELECT period_code p, COUNT(*) n, MIN(bill_date) d1, MAX(bill_date) d2 FROM grn_entry_snapshot GROUP BY period_code ORDER BY 1`);
  await show("DIAG_MIRROR_CC", `SELECT ge.period_code p, COUNT(*) lines_n, SUM(ccm.id IS NULL) unmapped_cc, SUM(ccm.id IS NOT NULL AND NOT (REPLACE(REPLACE(REPLACE(LOWER(COALESCE(ccm.company_name,'')),'.',''),' ',''),',','') LIKE '%mascallnet%')) other_company
              FROM grn_entry_line_snapshot l JOIN grn_entry_snapshot ge ON ge.bill_source_id = l.grn_source_id
              LEFT JOIN cost_centre_master ccm ON ccm.cost_centre_code = l.cost_centre_code COLLATE utf8mb4_unicode_ci GROUP BY ge.period_code ORDER BY 1`);
  await show("DIAG_GRN_REQUEST", `SELECT accounting_period p, (bill_source_id IS NOT NULL) imported, status, COUNT(*) n, ROUND(SUM(COALESCE(NULLIF(amount_without_tax,0), amount_with_tax - COALESCE(tax_amount,0), amount, 0))) amt FROM grn_request WHERE accounting_period BETWEEN '2026-04' AND '2026-09' GROUP BY 1,2,3 ORDER BY 1,2,3`);
  await new Promise((resolve) => process.stdout.write("DIAG_DONE\n", resolve));
  process.exit(0);
})();
