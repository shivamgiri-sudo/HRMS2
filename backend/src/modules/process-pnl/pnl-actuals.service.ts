import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { tableExists } from "../../shared/dbHelpers.js";

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
  /** Populated only by sources that carry a cost centre at the line level. */
  byCostCentre: Map<string, number>;
}

const emptyActuals = (): ActualsByKey => ({
  byBranch: new Map(), byProcess: new Map(), byCostCentre: new Map(),
});

function accumulate(rows: RowDataPacket[], into: ActualsByKey = emptyActuals()): ActualsByKey {
  for (const row of rows) {
    const amount = Number(row.amount ?? 0);
    if (!Number.isFinite(amount) || amount === 0) continue;
    const branchId = row.branch_id ? String(row.branch_id) : null;
    const processId = row.process_id ? String(row.process_id) : null;
    const costCentreId = row.cost_centre_id ? String(row.cost_centre_id) : null;
    if (branchId) into.byBranch.set(branchId, (into.byBranch.get(branchId) ?? 0) + amount);
    if (processId) into.byProcess.set(processId, (into.byProcess.get(processId) ?? 0) + amount);
    if (costCentreId) into.byCostCentre.set(costCentreId, (into.byCostCentre.get(costCentreId) ?? 0) + amount);
  }
  return into;
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
 * The same modal-process derivation, precomputed once PER COST CENTRE instead of per row.
 *
 * PROCESS_FROM_EMPLOYEES above is a correlated subquery: inside a derived table over invoice
 * or GRN lines it re-runs for every line. Against the mirrored data — 1,563 GRN lines and 540
 * invoice lines — a single period took over two minutes, which is not a page anyone can load.
 * There are only ~35 cost centres with staff, so resolving it once each and joining turns a
 * per-row scan into a small lookup.
 *
 * Identical result: same GROUP BY, same ORDER BY COUNT(*) DESC, same tie-break by LIMIT 1.
 */
const PROCESS_BY_COST_CENTRE = `
  (SELECT x.cost_centre_id, x.process_id FROM (
     SELECT e.cost_centre_id, e.process_id,
            ROW_NUMBER() OVER (PARTITION BY e.cost_centre_id ORDER BY COUNT(*) DESC) rn
       FROM employees e
      WHERE e.active_status = 1 AND e.process_id IS NOT NULL AND e.cost_centre_id IS NOT NULL
      GROUP BY e.cost_centre_id, e.process_id
   ) x WHERE x.rn = 1)`;

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
  const actuals = accumulate(rows);

  /*
   * The mirrored GRN from db_bill.
   *
   * The two sources above are mas_hrms's own GRN tables, and in production they are empty:
   * grn_cost_allocation has 0 consumed rows and grn_request has 1. Meanwhile db_bill — the
   * system finance actually raises GRNs in — held 417 approved entries for June alone. The
   * P&L was reporting near-zero indirect cost against real spend of tens of lakhs a month,
   * and looked correct while doing it because zero is a plausible-looking number.
   *
   * Read at LINE level: grn_entry_line_snapshot carries the cost centre, which the header
   * does not, so this is the only path that can attribute spend below branch. Its `total`
   * includes tax, matching amount_without_tax semantics above closely enough for indirect
   * cost — the net/gross difference is noted rather than silently mixed, see `total` vs
   * `amount` in 1070.
   *
   * Guarded by tableExists so an installation without the mirror keeps its previous
   * behaviour rather than throwing.
   */
  if (await tableExists("grn_entry_line_snapshot")) {
    // Resolved per row in a derived table before aggregating, for the same reason the query
    // above does it: PROCESS_FROM_EMPLOYEES correlates on ccm.id, and ONLY_FULL_GROUP_BY
    // rejects a correlated subquery beside a GROUP BY.
    const [mirrored] = await db.execute<RowDataPacket[]>(
      // The branch comes from the COST CENTRE, not the GRN row: grn_entry_snapshot carries
      // branch_source_id (db_bill's integer id) and a branch_name the sync leaves null, and
      // neither is a mas_hrms branch_master id, which is what every other P&L key is.
      `SELECT ccm.branch_id AS branch_id, ccm.id AS cost_centre_id,
              pc.process_id AS process_id, SUM(l.total) AS amount
         FROM grn_entry_line_snapshot l
         JOIN grn_entry_snapshot g ON g.bill_source_id = l.grn_source_id
         LEFT JOIN cost_centre_master ccm
                ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci
                 = l.cost_centre_code COLLATE utf8mb4_unicode_ci
         LEFT JOIN ${PROCESS_BY_COST_CENTRE} pc ON pc.cost_centre_id = ccm.id
        WHERE g.period_code = ? AND g.is_rejected = 0
        GROUP BY ccm.branch_id, ccm.id, pc.process_id`,
      [periodCode]
    );
    accumulate(mirrored, actuals);
  }
  return actuals;
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

/**
 * Revenue actually invoiced to the client for a period.
 *
 * Deliberately separate from getDriverRevenueActuals rather than replacing it. The driver
 * figure is planned_headcount x rate — a budgeting number, and in production it exists for
 * only three periods (2026-07/08/09) while real invoicing runs from April. Reporting one as
 * the other would silently change what "revenue" means on every existing surface.
 *
 * Sourced from the invoice LINES rather than the invoice header, because only the lines carry
 * the cost centre. `amount` is net of tax, matching the header's total_amt.
 *
 * Callers should present both and show the gap: contracted-vs-earned is the seat shortfall
 * the P&L exists to surface.
 */
export async function getInvoicedRevenueActuals(periodCode: string): Promise<ActualsByKey> {
  if (!/^\d{4}-\d{2}$/.test(periodCode)) return emptyActuals();
  if (!(await tableExists("billing_invoice_particular_snapshot"))) return emptyActuals();

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ccm.branch_id AS branch_id, ccm.id AS cost_centre_id,
            pc.process_id AS process_id, SUM(p.amount) AS amount
       FROM billing_invoice_particular_snapshot p
       LEFT JOIN cost_centre_master ccm
              ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci
               = p.cost_centre_code COLLATE utf8mb4_unicode_ci
       LEFT JOIN ${PROCESS_BY_COST_CENTRE} pc ON pc.cost_centre_id = ccm.id
      WHERE p.period_code = ?
      GROUP BY ccm.branch_id, ccm.id, pc.process_id`,
    [periodCode]
  );
  return accumulate(rows);
}

export const pnlActualsService = {
  getIndirectCostActuals,
  getDriverRevenueActuals,
  getInvoicedRevenueActuals,
};
