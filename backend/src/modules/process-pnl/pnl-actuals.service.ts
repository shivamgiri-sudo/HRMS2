import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * The two P&L lines that already exist as data but were never read by the statement.
 *
 * Indirect cost: a GRN consumes against an approved budget line and updates
 * finance_budget_line.consumed_amount — and stopped there. An end-to-end test on NOIDA-2 Aug-2026
 * approved a GRN worth Rs 66,500 and the P&L still reported zero cost. Every rupee of GRN spend is
 * IDC (the workbook's IDC sheet is the branch-budget expense master), so it is summed here per
 * branch and per process.
 *
 * Revenue: planned_headcount x revenue_rate_per_head, already computed as calculatedPlannedRevenue
 * in getMonthlyDrivers() and likewise never read. Headcount-based, not seat-based — revenue tracks
 * who is deployed rather than contracted capacity.
 *
 * Both are keyed by cost centre in the source, and cost centre -> process is derived through the
 * employees posted to it, NOT cost_centre_master.process_id, which is NULL on every live row.
 */

export interface ActualsByKey {
  byBranch: Map<string, number>;
  byProcess: Map<string, number>;
}

const emptyActuals = (): ActualsByKey => ({ byBranch: new Map(), byProcess: new Map() });

function accumulate(rows: RowDataPacket[]): ActualsByKey {
  const out = emptyActuals();
  for (const row of rows) {
    const amount = Number(row.amount ?? 0);
    if (!Number.isFinite(amount) || amount === 0) continue;
    const branchId = row.branch_id ? String(row.branch_id) : null;
    const processId = row.process_id ? String(row.process_id) : null;
    if (branchId) out.byBranch.set(branchId, (out.byBranch.get(branchId) ?? 0) + amount);
    if (processId) out.byProcess.set(processId, (out.byProcess.get(processId) ?? 0) + amount);
  }
  return out;
}

/** Process a cost centre serves, from the employees posted to it. Same derivation as
 *  /api/org/cost-centres and listActiveCostCentres(), so every surface agrees. */
const PROCESS_FROM_EMPLOYEES = `
  (SELECT e.process_id
     FROM employees e
    WHERE e.cost_centre_id = ccm.id AND e.active_status = 1 AND e.process_id IS NOT NULL
    GROUP BY e.process_id
    ORDER BY COUNT(*) DESC
    LIMIT 1)`;

/**
 * Indirect cost for a period: approved GRN spend, accrued on approval rather than on payment, so
 * it lands in the month the goods or services were received — the same month the GRN consumed its
 * budget. Net of tax, matching how a non-taxable budget line is consumed.
 */
export async function getIndirectCostActuals(periodCode: string): Promise<ActualsByKey> {
  if (!/^\d{4}-\d{2}$/.test(periodCode)) return emptyActuals();
  const [rows] = await db.execute<RowDataPacket[]>(
    // The process subquery is correlated on ccm.id, which ONLY_FULL_GROUP_BY refuses beside a
    // GROUP BY. Resolved per row in a derived table first, then aggregated.
    // Two GRN paths write spend, and only counting one of them reported zero cost against a
    // budget that had genuinely consumed: the Smart GRN writes per-line rows to
    // grn_cost_allocation, while the ordinary GRN keeps budget_line_id and the amount on
    // grn_request itself. Both are union'd, and the union is over allocation rows plus the
    // ordinary GRNs that have NO allocation rows, so a Smart GRN is never counted twice.
    `SELECT branch_id, process_id, SUM(amount) AS amount FROM (
       SELECT COALESCE(ccm.branch_id, g.branch_id) AS branch_id,
              COALESCE(a.process_id, ${PROCESS_FROM_EMPLOYEES}) AS process_id,
              a.amount_without_tax AS amount
         FROM grn_cost_allocation a
         JOIN grn_request g ON g.id = a.grn_request_id
         LEFT JOIN cost_centre_master ccm ON ccm.id = a.cost_centre_id
        WHERE a.lifecycle_status = 'consumed'
          AND DATE_FORMAT(g.bill_date, '%Y-%m') = ?

       UNION ALL

       SELECT COALESCE(ccm.branch_id, g.branch_id) AS branch_id,
              COALESCE(g.process_id, ${PROCESS_FROM_EMPLOYEES}) AS process_id,
              g.amount_without_tax AS amount
         FROM grn_request g
         LEFT JOIN cost_centre_master ccm ON ccm.id = g.cost_centre_id
        WHERE g.budget_line_id IS NOT NULL
          AND g.status NOT IN ('draft', 'rejected', 'cancelled')
          AND DATE_FORMAT(g.bill_date, '%Y-%m') = ?
          AND NOT EXISTS (SELECT 1 FROM grn_cost_allocation x WHERE x.grn_request_id = g.id)
     ) t
      GROUP BY branch_id, process_id`,
    [periodCode, periodCode]
  );
  return accumulate(rows);
}

/** Recognised revenue for a period, from the budget's own monthly drivers. */
export async function getDriverRevenueActuals(periodCode: string): Promise<ActualsByKey> {
  if (!/^\d{4}-\d{2}$/.test(periodCode)) return emptyActuals();
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT branch_id, process_id, SUM(amount) AS amount FROM (
       SELECT d.branch_id AS branch_id,
              ${PROCESS_FROM_EMPLOYEES} AS process_id,
              d.planned_headcount * d.revenue_rate_per_head AS amount
         FROM finance_cost_centre_monthly_driver d
         JOIN cost_centre_master ccm ON ccm.id = d.cost_centre_id
        WHERE d.period_code = ?
     ) t
      GROUP BY branch_id, process_id`,
    [periodCode]
  );
  return accumulate(rows);
}

export const pnlActualsService = { getIndirectCostActuals, getDriverRevenueActuals };
