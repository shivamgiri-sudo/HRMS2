/**
 * Head Office budget diagnose. READ-ONLY.
 *
 * Why does a branch's budget for a month show lines as fully used (e.g. Fees & Subscription)
 * when no GRN was raised IN that month? Lists, for every branch matching the name pattern and
 * the period: budget headers (who created, status), lines with reserved/consumed, and every
 * grn_cost_allocation drawing on those lines with the GRN's bill_date / accounting_period /
 * creator, so remediation-script rows and multi-month recognition splits are visible.
 *
 *   npx tsx scripts/head-office-budget-diagnose.ts [YYYY-MM] [branch-name-like]
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import type { RowDataPacket } from "mysql2";

const PERIOD = process.argv[2] ?? "2026-10";
const BRANCH = process.argv[3] ?? "%head office%";

const q = async (sql: string, p: unknown[] = []) => (await db.execute<RowDataPacket[]>(sql, p))[0];

(async () => {
  console.log(`\n== branch_master rows matching ${BRANCH} ==`);
  console.table(await q(`SELECT id, branch_name FROM branch_master WHERE branch_name LIKE ?`, [BRANCH]));

  console.log(`\n== budget headers, period ${PERIOD} ==`);
  const headers = await q(
    `SELECT h.id, bm.branch_name, h.period_code, h.status, h.gross_budget_amount, h.created_by, h.created_at
       FROM finance_budget_header h JOIN branch_master bm ON bm.id = h.branch_id
      WHERE h.period_code = ? AND bm.branch_name LIKE ?`, [PERIOD, BRANCH]);
  console.table(headers);
  const ids = (headers as any[]).map((h) => h.id);
  if (!ids.length) { console.log("No header for this branch+period."); process.exit(0); }
  const ph = ids.map(() => "?").join(",");

  console.log(`\n== lines ==`);
  console.table(await q(
    `SELECT l.budget_id, l.id line_id, l.head, l.sub_head, l.item_name, l.gross_amount, l.reserved_amount, l.consumed_amount
       FROM finance_budget_line l WHERE l.budget_id IN (${ph}) ORDER BY l.head, l.sub_head`, ids));

  console.log(`\n== allocations drawing on these lines ==`);
  console.table(await q(
    `SELECT l.head, l.sub_head, gr.grn_number, DATE_FORMAT(gr.bill_date,'%Y-%m-%d') bill_date, gr.accounting_period,
            gr.status grn_status, ca.lifecycle_status, ca.amount_with_tax, ca.created_by alloc_created_by,
            ca.created_at alloc_created_at, ccm.cost_centre_name incurred_cc
       FROM grn_cost_allocation ca
       JOIN finance_budget_line l ON l.id = ca.budget_line_id
       JOIN grn_request gr ON gr.id = ca.grn_request_id
       LEFT JOIN cost_centre_master ccm ON ccm.id = ca.cost_centre_id
      WHERE l.budget_id IN (${ph})
      ORDER BY l.head, l.sub_head, gr.bill_date`, ids));

  console.log(`\n== GRNs actually raised in ${PERIOD} for matching branches (bill_date or created_at in month) ==`);
  console.table(await q(
    `SELECT gr.grn_number, DATE_FORMAT(gr.bill_date,'%Y-%m-%d') bill_date, gr.accounting_period, gr.status, gr.created_at
       FROM grn_request gr JOIN branch_master bm ON bm.id = gr.branch_id
      WHERE bm.branch_name LIKE ? AND (gr.accounting_period = ? OR DATE_FORMAT(gr.bill_date,'%Y-%m') = ?)
      ORDER BY gr.bill_date`, [BRANCH, PERIOD, PERIOD]));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
