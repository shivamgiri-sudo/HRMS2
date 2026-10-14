/**
 * Does legacy (db_bill-migrated) GRN spend sit on HRMS budget lines? READ-ONLY.
 *
 *   npx tsx scripts/legacy-grn-in-budget.ts [YYYY-MM] [branch-name-like]
 *
 * "Legacy" = the same test the app uses (legacyGrnSql): bill_source_id IS NOT NULL, or created_by
 * LIKE '00000000-%'. For the period it prints, per budget line, the reserved/consumed figures the
 * Variance tab shows, split into HRMS-raised vs legacy allocations; then totals for every
 * period of the FY so a remediation backfill (April..) is visible too.
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import type { RowDataPacket } from "mysql2";

const PERIOD = process.argv[2] ?? "2026-10";
const BRANCH = process.argv[3] ?? "%head office%";
const q = async (sql: string, p: unknown[] = []) => (await db.execute<RowDataPacket[]>(sql, p))[0];
const LEGACY = `(g.bill_source_id IS NOT NULL OR COALESCE(g.created_by, '') LIKE '00000000-%')`;

(async () => {
  console.log(`\n== ${BRANCH} ${PERIOD}: per line, HRMS vs legacy allocations (reserved/consumed, ex-GST pnl basis) ==`);
  console.table(await q(
    `SELECT l.head, l.sub_head, l.gross_amount, l.reserved_amount line_reserved, l.consumed_amount line_consumed,
            SUM(CASE WHEN ${LEGACY} THEN 0 ELSE 1 END) hrms_allocs,
            SUM(CASE WHEN ${LEGACY} THEN 1 ELSE 0 END) legacy_allocs,
            ROUND(SUM(CASE WHEN ${LEGACY} OR ca.lifecycle_status <> 'consumed' THEN 0 ELSE ca.amount_with_tax END),2) hrms_consumed_gross,
            ROUND(SUM(CASE WHEN ${LEGACY} AND ca.lifecycle_status = 'consumed' THEN ca.amount_with_tax ELSE 0 END),2) legacy_consumed_gross,
            ROUND(SUM(CASE WHEN ${LEGACY} AND ca.lifecycle_status = 'reserved' THEN ca.amount_with_tax ELSE 0 END),2) legacy_reserved_gross
       FROM finance_budget_header h
       JOIN branch_master bm ON bm.id = h.branch_id
       JOIN finance_budget_line l ON l.budget_id = h.id
       LEFT JOIN grn_cost_allocation ca ON ca.budget_line_id = l.id
       LEFT JOIN grn_request g ON g.id = ca.grn_request_id
      WHERE h.period_code = ? AND bm.branch_name LIKE ? AND h.status IN ('active','closed')
      GROUP BY l.id, l.head, l.sub_head, l.gross_amount, l.reserved_amount, l.consumed_amount
      ORDER BY l.head, l.sub_head`, [PERIOD, BRANCH]));

  console.log(`\n== whole company, FY 2026-27: legacy allocations sitting on HRMS budget lines, by period ==`);
  console.table(await q(
    `SELECT h.period_code,
            COUNT(DISTINCT h.id) headers,
            SUM(CASE WHEN ${LEGACY} THEN 1 ELSE 0 END) legacy_allocs,
            SUM(CASE WHEN ${LEGACY} THEN 0 ELSE 1 END) hrms_allocs,
            ROUND(SUM(CASE WHEN ${LEGACY} THEN ca.amount_with_tax ELSE 0 END),2) legacy_gross,
            ROUND(SUM(CASE WHEN ${LEGACY} THEN 0 ELSE ca.amount_with_tax END),2) hrms_gross,
            COUNT(DISTINCT CASE WHEN ${LEGACY} THEN ca.created_by END) legacy_alloc_creators
       FROM finance_budget_header h
       JOIN finance_budget_line l ON l.budget_id = h.id
       JOIN grn_cost_allocation ca ON ca.budget_line_id = l.id
       JOIN grn_request g ON g.id = ca.grn_request_id
      WHERE h.period_code >= '2026-04' AND h.status IN ('active','closed')
      GROUP BY h.period_code ORDER BY h.period_code`));

  console.log(`\n== allocation creators behind legacy rows ==`);
  console.table(await q(
    `SELECT ca.created_by, COUNT(*) n, ROUND(SUM(ca.amount_with_tax),2) gross, MIN(ca.created_at) first_at, MAX(ca.created_at) last_at
       FROM grn_cost_allocation ca JOIN grn_request g ON g.id = ca.grn_request_id
       JOIN finance_budget_line l ON l.id = ca.budget_line_id
      WHERE ${LEGACY} GROUP BY ca.created_by ORDER BY n DESC LIMIT 10`));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
