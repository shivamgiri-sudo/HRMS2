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
export const PROCESS_BY_COST_CENTRE = `
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
/**
 * Only this company's own trading.
 *
 * cost_centre_master.company_name carries the legal entity and the P&L was consolidating three:
 * MAS Callnet, IDC and Ispark Dataconnect. IDC alone billed Rs 75.23 lakh in June 2026 across 36
 * cost centres with NOT ONE employee — revenue with no cost behind it, which lifted the reported
 * margin from MINUS 1.6% to a plausible-looking 17.8%.
 *
 * The CEO view was filtered first and these surfaces were not, which left the same page showing
 * two different margins on adjacent tabs. That is worse than either number alone, so the same
 * predicate is applied everywhere revenue or spend is read.
 *
 * Matched on a normalised name because the source spells it four ways ("MAS Call Net India Pvt
 * Ltd", "Mas Callnet India Pvt. Ltd.", "Mas Callnet India Pvt Ltd", "MAS CALLNET INDIA PVT LTD.").
 * `ccm` must be the alias of cost_centre_master in the query using it.
 */
export const OWN_COMPANY_SQL =
  `REPLACE(REPLACE(REPLACE(LOWER(COALESCE(ccm.company_name, '')), '.', ''), ' ', ''), ',', '') LIKE '%mascallnet%'`;

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
    //
    // 2026-08-29 FIX: both legs read pnl_cost_amount, not amount_without_tax. They are equal
    // only when GST is 100% recoverable; on any line with a lower recoverable_tax_pct (e.g. an
    // exempt/non_gst budget line, which defaults to 0%) amount_without_tax excludes the
    // non-recoverable tax slice that IS a real P&L expense, understating indirect cost by
    // exactly that amount. pnl_cost_amount is what calculateBudgetLine() computes for precisely
    // this reason (baseAmount + taxAmount - recoverableTaxAmount) and is what every other GRN
    // P&L consumer (vw_process_pnl_grn_allocation, branch-budget.service.ts's own GRN
    // drill-through) already reads. No live row currently has the two differ — confirmed against
    // production on 2026-08-29 — so this changes no number today; it stops the two tabs
    // (P&L Statement here vs the Process Matrix's view) silently disagreeing the day one does.
    `SELECT branch_id, process_id, SUM(amount) AS amount FROM (
       SELECT COALESCE(ccm.branch_id, g.branch_id) AS branch_id,
              COALESCE(a.process_id, ${PROCESS_FROM_EMPLOYEES}) AS process_id,
              a.pnl_cost_amount AS amount
         FROM grn_cost_allocation a
         JOIN grn_request g ON g.id = a.grn_request_id
         LEFT JOIN cost_centre_master ccm ON ccm.id = a.cost_centre_id
        WHERE a.lifecycle_status = 'consumed'
          AND DATE_FORMAT(g.bill_date, '%Y-%m') = ?

       UNION ALL

       SELECT COALESCE(ccm.branch_id, g.branch_id) AS branch_id,
              COALESCE(g.process_id, ${PROCESS_FROM_EMPLOYEES}) AS process_id,
              g.pnl_cost_amount AS amount
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
   * The mirrored GRN from db_bill — fills in GRNs the app has NOT captured yet.
   *
   * RESOLVED 2026-08-29. This comment originally justified the UNION on "the two sources above
   * are mas_hrms's own GRN tables, and in production they are empty: grn_cost_allocation has 0
   * consumed rows and grn_request has 1." That stopped being true well before this was caught:
   * confirmed live, grn_cost_allocation now holds real volume concentrated in exactly the months
   * (2026-04 through 2026-08) this mirror also covers, and matching by GRN NUMBER (grn_no here,
   * grn_number on the app side — the same physical voucher's own identifier, not a fuzzy
   * vendor/amount/date guess) found 1,452 of 1,495 consumed GRNs — 97% — already present in this
   * mirror. Every one of those was being counted TWICE: once from grn_cost_allocation above, once
   * again from here, with nothing between the two blocks stopping it. Measured overstatement on
   * the P&L Statement tab for Apr-Aug 2026: Rs 3,37,46,372.
   *
   * The NOT EXISTS below closes it, mirroring the guard the block above already has for its own
   * second leg (ordinary GRNs the app never wrote an allocation row for). Direction of the fix:
   * the APP'S OWN consumed allocation wins whenever a GRN number appears in both places — it
   * carries pnl_cost_amount (proper non-recoverable-GST treatment, cost-centre attribution),
   * which this mirror's flat l.amount does not. The mirror now only ever contributes a GRN the
   * app has not captured, which is its original, intended job — filling the gap that was empty in
   * production when this block was first written, not re-counting what the app has since taken
   * over.
   *
   * Read at LINE level: grn_entry_line_snapshot carries the cost centre, which the header
   * does not, so this is the only path that can attribute spend below branch.
   *
   * Uses l.amount (net-of-tax) — NOT l.total. l.total = l.amount + l.tax (GST). GST on
   * business purchases is ITC-recoverable and is not a P&L expense; including it overstates
   * IDC by the GST rate (~18%) on each GRN line. grn_request above uses pnl_cost_amount for the
   * same reason (fixed 2026-08-29 from amount_without_tax — see that block's own comment for why
   * the two differ on a partially-recoverable line). See column definitions in migration 1070.
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
              pc.process_id AS process_id, SUM(l.amount) AS amount
         FROM grn_entry_line_snapshot l
         JOIN grn_entry_snapshot g ON g.bill_source_id = l.grn_source_id
         LEFT JOIN cost_centre_master ccm
                ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci
                 = l.cost_centre_code COLLATE utf8mb4_unicode_ci
         LEFT JOIN ${PROCESS_BY_COST_CENTRE} pc ON pc.cost_centre_id = ccm.id
        WHERE g.period_code = ? AND g.is_rejected = 0 AND ${OWN_COMPANY_SQL}
          AND NOT EXISTS (
                SELECT 1
                  FROM grn_request gr
                  JOIN grn_cost_allocation a ON a.grn_request_id = gr.id
                 WHERE gr.grn_number = g.grn_no
                   AND a.lifecycle_status = 'consumed'
              )
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

  // Revenue has two complementary sources that must both contribute:
  //
  // SOURCE A — billing_invoice_particular_snapshot (inv_particulars in db_bill):
  //   Per-invoice line items. Only ~540 rows exist for FY2026-27, covering invoices that have
  //   detailed breakdowns in db_bill. These are authoritative when present, so they take priority
  //   for cost centres that have any particular lines in the period.
  //
  // SOURCE B — billing_provision_snapshot (provision_master in db_bill):
  //   Monthly billing confirmation per cost centre — 7,350 rows covering every actively-billed
  //   cost centre for all historical periods. provision_amt is the estimate; billing_amt is the
  //   confirmed billing (use billing_amt when > 0, otherwise fall back to provision_amt).
  //   Amounts are stored as integer RUPEES (BIGINT). db_bill.provision_master stores rupee
  //   figures; sync-db-bill-snapshot.mjs copies them via safeInt() without conversion.
  //   No /100 division is needed here.
  //   Used only for cost centres that have NO particular lines for the period (NOT EXISTS guard
  //   prevents double-counting).
  //
  // SOURCE C — billing_credit_note_snapshot (credit notes from db_bill):
  //   Negative adjustments. Applied to whichever source contributed the positive amount; netted
  //   at period + cost_centre grain (no reliable per-invoice link available).
  //
  // Result is a net figure: (A or B) minus C, grouped by branch / process / cost centre.

  const hasProvision = await tableExists("billing_provision_snapshot");

  const [rows] = await db.execute<RowDataPacket[]>(
    `${hasProvision ? `
     WITH invoice_actual AS (
       SELECT p.cost_centre_code COLLATE utf8mb4_unicode_ci AS cost_centre_code,
              ccm.branch_id AS branch_id, ccm.id AS cost_centre_id,
              pc.process_id AS process_id, SUM(p.amount) AS invoice_amount
         FROM billing_invoice_particular_snapshot p
         LEFT JOIN cost_centre_master ccm
                ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci
                 = p.cost_centre_code COLLATE utf8mb4_unicode_ci
         LEFT JOIN ${PROCESS_BY_COST_CENTRE} pc ON pc.cost_centre_id = ccm.id
        WHERE p.period_code = ? AND ${OWN_COMPANY_SQL}
        GROUP BY p.cost_centre_code COLLATE utf8mb4_unicode_ci, ccm.branch_id, ccm.id, pc.process_id
     ),
     provision_actual AS (
       SELECT ps.cost_centre_code COLLATE utf8mb4_unicode_ci AS cost_centre_code,
              ccm.branch_id AS branch_id, ccm.id AS cost_centre_id,
              pc.process_id AS process_id,
              SUM(CASE WHEN ps.billing_amt > 0 THEN ps.billing_amt ELSE ps.provision_amt END) AS provision_amount
         FROM billing_provision_snapshot ps
         LEFT JOIN cost_centre_master ccm
                ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci
                 = ps.cost_centre_code COLLATE utf8mb4_unicode_ci
         LEFT JOIN ${PROCESS_BY_COST_CENTRE} pc ON pc.cost_centre_id = ccm.id
        WHERE ps.period_code = ? AND ps.revenue_active = 1 AND ${OWN_COMPANY_SQL}
        GROUP BY ps.cost_centre_code COLLATE utf8mb4_unicode_ci, ccm.branch_id, ccm.id, pc.process_id
     ),
     /*
      * BUG-4 fix: invoice_actual is grouped by (cost_centre_code, branch_id, cost_centre_id,
      * process_id) — a cost centre that PROCESS_BY_COST_CENTRE maps to more than one process_id
      * produces multiple invoice_actual rows for the same cost_centre_code. The old dedup JOIN
      * below matched provision_actual to invoice_actual on all four columns including process_id,
      * so a process_id mismatch (data timing, or a genuinely multi-process cost centre) made the
      * JOIN miss entirely — the provision row then contributed its FULL amount on top of the
      * invoice that already covered the same cost centre, double-counting revenue.
      *
      * Deduplication only needs to happen at cost_centre_code grain (that's the real-world unit
      * a client bills against), so aggregate invoice_actual down to one row per cost_centre_code
      * before joining.
      */
     invoice_by_cc AS (
       SELECT cost_centre_code, SUM(invoice_amount) AS invoice_amount
         FROM invoice_actual
        GROUP BY cost_centre_code
     )
     SELECT branch_id, cost_centre_id, process_id, SUM(amount) AS amount FROM (
        SELECT branch_id, cost_centre_id, process_id, invoice_amount AS amount
          FROM invoice_actual
        UNION ALL
        SELECT p.branch_id, p.cost_centre_id, p.process_id,
               GREATEST(p.provision_amount - COALESCE(i.invoice_amount, 0), 0) AS amount
          FROM provision_actual p
          LEFT JOIN invoice_by_cc i
                 ON i.cost_centre_code = p.cost_centre_code
        UNION ALL
        SELECT ccm.branch_id, ccm.id, pc.process_id, -cn.total_amt
          FROM billing_credit_note_snapshot cn
          LEFT JOIN cost_centre_master ccm
                 ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci
                  = cn.cost_centre_code COLLATE utf8mb4_unicode_ci
          LEFT JOIN ${PROCESS_BY_COST_CENTRE} pc ON pc.cost_centre_id = ccm.id
         WHERE cn.period_code = ? AND cn.is_approved = 1 AND ${OWN_COMPANY_SQL}
     ) netted
      GROUP BY branch_id, cost_centre_id, process_id` : `
     SELECT branch_id, cost_centre_id, process_id, SUM(amount) AS amount FROM (
        SELECT ccm.branch_id AS branch_id, ccm.id AS cost_centre_id,
               pc.process_id AS process_id, p.amount AS amount
          FROM billing_invoice_particular_snapshot p
          LEFT JOIN cost_centre_master ccm
                 ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci
                  = p.cost_centre_code COLLATE utf8mb4_unicode_ci
          LEFT JOIN ${PROCESS_BY_COST_CENTRE} pc ON pc.cost_centre_id = ccm.id
         WHERE p.period_code = ? AND ${OWN_COMPANY_SQL}
        UNION ALL
        SELECT ccm.branch_id, ccm.id, pc.process_id, -cn.total_amt
          FROM billing_credit_note_snapshot cn
          LEFT JOIN cost_centre_master ccm
                 ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci
                  = cn.cost_centre_code COLLATE utf8mb4_unicode_ci
          LEFT JOIN ${PROCESS_BY_COST_CENTRE} pc ON pc.cost_centre_id = ccm.id
         WHERE cn.period_code = ? AND cn.is_approved = 1 AND ${OWN_COMPANY_SQL}
     ) netted
      GROUP BY branch_id, cost_centre_id, process_id`}`,
    hasProvision ? [periodCode, periodCode, periodCode] : [periodCode, periodCode]
  );
  return accumulate(rows);
}

/**
 * Seat revenue actually earned in a period: what the client owes for the people who really
 * worked, as against `planned_headcount x rate`, which is what we hoped to bill.
 *
 * The difference between the two is the seat shortfall — unfilled or part-filled seats — and it
 * is the number the whole billability model exists to expose. A seat budgeted at 30 heads and
 * staffed by 26 for half a month is not a rate problem, and no per-head rate will reveal it.
 *
 * WHY THIS IS ONE QUERY AND NOT resolveSeatRate() IN A LOOP
 * --------------------------------------------------------
 * billability.service.ts resolves one employee at a time and issues up to four queries doing it.
 * Over the ~1,400 people paid in a month that is ~5,600 round trips per period, and the statement
 * asks for several periods at once. The precedence encoded below is the same four levels in the
 * same order; `seat-revenue.precedence.test.ts` drives both paths over identical fixtures so the
 * two cannot drift apart silently.
 *
 * WHAT IS DELIBERATELY EXCLUDED
 * -----------------------------
 * - `billing_model = 'not_seat_billed'` cost centres. Roughly 70% of active cost centres bill on
 *   outcome or volume, not seats (db_bill `cost_master.Billing = 0` on 408 of 579 active). A seat
 *   figure for them would be arithmetic without meaning, so they contribute zero here and their
 *   revenue comes from the invoice mirror instead.
 * - Anyone the classifier cannot place. Billability comes from the approved (process x designation)
 *   matrix, falling back to the period's cost bucket. An employee in neither is `unresolved` and
 *   earns nothing here rather than defaulting to billable — counted in `unresolvedEmployees` so the
 *   gap is reported instead of absorbed.
 *
 * Proration is `final_payable_days / active_calendar_days`, the same basis payroll paid them on, so
 * a mid-month joiner bills a part seat. Capped at 1: overtime does not create extra seats.
 */
export interface SeatRevenueActuals extends ActualsByKey {
  /** Billable people who resolved to a rate, and the seats they add up to. */
  billableEmployees: number;
  /** Billable, but no rate at any level — revenue silently missing until finance sets one. */
  rateMissingEmployees: number;
  /** Neither the matrix nor a cost bucket could classify these. Never assumed billable. */
  unresolvedEmployees: number;
  /** Sits on cost centres billed on outcome/volume, where a seat figure has no meaning. */
  notSeatBilledEmployees: number;
  /**
   * Count of rate-missing billable people per key, not rupees.
   *
   * Carried per key because the seat shortfall is only meaningful where every billable person
   * resolved a rate. Live coverage today is 7 cost centres out of ~95 active, so a global
   * "contracted minus earned" would report roughly Rs 290 lakh of lost revenue that is really
   * just unconfigured rates. A consumer must publish the shortfall only where this is zero.
   */
  rateMissingByKey: ActualsByKey;
}

const emptySeatRevenue = (): SeatRevenueActuals => ({
  ...emptyActuals(),
  billableEmployees: 0,
  rateMissingEmployees: 0,
  unresolvedEmployees: 0,
  notSeatBilledEmployees: 0,
  rateMissingByKey: emptyActuals(),
});

/** Latest approved row per (cost centre, designation) as of the period end, designation-specific
 *  ahead of flat — the same ordering resolveSeatRate applies with its LIMIT 1. */
const SEAT_RATE_RANKED = `(
  SELECT cost_centre_id, designation_id, seat_rate_monthly, billing_model,
         ROW_NUMBER() OVER (
           PARTITION BY cost_centre_id, COALESCE(designation_id, '~flat')
           ORDER BY effective_from DESC
         ) AS rn
    FROM cost_centre_seat_rate
   WHERE status = 'approved'
     AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?)
)`;

/**
 * The same rn = 1 treatment for the other two effective-dated joins in getSeatRevenueActuals.
 *
 * Both were plain LEFT JOINs on an approved-and-in-window predicate with nothing guaranteeing a
 * single match. Two approved rows whose effective_from/effective_to windows overlap for the same
 * key would duplicate the employee row they attach to, doubling that employee's seat revenue and
 * inflating billableEmployees — while the seat-rate joins immediately below, written from the
 * same shape, were already de-duplicated. Three of five were guarded and two were not.
 *
 * Ordering matches SEAT_RATE_RANKED and resolveSeatRate: the most recently effective row wins.
 * Each subquery binds exactly the two parameters its predecessor bound, in the same order, so
 * the caller's parameter list is unchanged.
 *
 * No production data exercises this today — measured: zero overlapping rows in either table —
 * which is why it has never shown up as a wrong number.
 */
const ROLE_BILLABILITY_RANKED = `(
  SELECT process_id, designation_id, is_billable, seat_rate_monthly,
         ROW_NUMBER() OVER (
           PARTITION BY process_id, designation_id
           ORDER BY effective_from DESC
         ) AS rn
    FROM process_role_billability
   WHERE status = 'approved'
     AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?)
)`;

const SEAT_RATE_OVERRIDE_RANKED = `(
  SELECT employee_id, seat_rate_monthly,
         ROW_NUMBER() OVER (
           PARTITION BY employee_id
           ORDER BY effective_from DESC
         ) AS rn
    FROM employee_seat_rate_override
   WHERE status = 'approved'
     AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?)
)`;

export async function getSeatRevenueActuals(periodCode: string): Promise<SeatRevenueActuals> {
  if (!/^\d{4}-\d{2}$/.test(periodCode)) return emptySeatRevenue();
  for (const table of ["cost_centre_seat_rate", "salary_prep_line", "pnl_running_salary_snapshot"]) {
    if (!(await tableExists(table))) return emptySeatRevenue();
  }
  // Rates are resolved as of the last day of the period, so a rate signed mid-month applies to
  // the month it was signed for rather than to whenever this happens to be run.
  const [year, month] = periodCode.split("-").map(Number);
  const periodEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.branch_id AS branch_id, e.process_id AS process_id, e.cost_centre_id AS cost_centre_id,
            COALESCE(m.is_billable, CASE WHEN snap.pnl_bucket = 'agent_salary' THEN 1
                                         WHEN snap.pnl_bucket IS NOT NULL THEN 0 END) AS is_billable,
            COALESCE(ovr.seat_rate_monthly, ccd.seat_rate_monthly, ccf.seat_rate_monthly,
                     m.seat_rate_monthly, drv.revenue_rate_per_head) AS rate,
            COALESCE(ccd.billing_model, ccf.billing_model) AS billing_model,
            LEAST(1, GREATEST(0, COALESCE(l.final_payable_days, 0)
                                 / NULLIF(l.active_calendar_days, 0))) AS proration
       FROM salary_prep_line l
       JOIN salary_prep_run r ON r.id = l.run_id AND r.run_month = ?
       JOIN employees e ON e.id = l.employee_id
       LEFT JOIN pnl_running_salary_snapshot snap
              ON snap.employee_id = e.id AND snap.period_code = ?
       LEFT JOIN ${ROLE_BILLABILITY_RANKED} m
              ON m.process_id = e.process_id AND m.designation_id = e.designation_id
             AND m.rn = 1
       LEFT JOIN ${SEAT_RATE_OVERRIDE_RANKED} ovr
              ON ovr.employee_id = e.id AND ovr.rn = 1
       LEFT JOIN ${SEAT_RATE_RANKED} ccd
              ON ccd.cost_centre_id = e.cost_centre_id
             AND ccd.designation_id = e.designation_id AND ccd.rn = 1
       LEFT JOIN ${SEAT_RATE_RANKED} ccf
              ON ccf.cost_centre_id = e.cost_centre_id
             AND ccf.designation_id IS NULL AND ccf.rn = 1
       LEFT JOIN finance_cost_centre_monthly_driver drv
              ON drv.cost_centre_id = e.cost_centre_id AND drv.period_code = ?
             AND drv.revenue_rate_per_head > 0
       LEFT JOIN cost_centre_master ccm ON ccm.id = e.cost_centre_id
      WHERE ${OWN_COMPANY_SQL}`,
    [periodCode, periodCode, periodEnd, periodEnd, periodEnd, periodEnd,
     periodEnd, periodEnd, periodEnd, periodEnd, periodCode]
  );

  const out = emptySeatRevenue();
  const earned: RowDataPacket[] = [];
  for (const row of rows) {
    if (row.is_billable === null || row.is_billable === undefined) { out.unresolvedEmployees++; continue; }
    if (Number(row.is_billable) !== 1) continue;
    if (row.billing_model === "not_seat_billed") { out.notSeatBilledEmployees++; continue; }
    const rate = Number(row.rate ?? 0);
    if (!(rate > 0)) {
      out.rateMissingEmployees++;
      accumulate([{ ...row, amount: 1 } as RowDataPacket], out.rateMissingByKey);
      continue;
    }
    out.billableEmployees++;
    earned.push({ ...row, amount: rate * Number(row.proration ?? 0) } as RowDataPacket);
  }
  accumulate(earned, out);
  return out;
}

/**
 * Net reward/penalty impact per cost centre for a period.
 * Approved rewards add positive revenue; approved penalties subtract from revenue.
 * Only `approved` entries are counted — drafts and rejections are excluded.
 */
export async function getRewardPenaltyActuals(periodCode: string): Promise<ActualsByKey> {
  if (!/^\d{4}-\d{2}$/.test(periodCode)) return emptyActuals();
  if (!(await tableExists("cost_centre_reward_penalty"))) return emptyActuals();

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ccm.branch_id AS branch_id,
            rp.cost_centre_id AS cost_centre_id,
            pc.process_id AS process_id,
            SUM(CASE WHEN rp.entry_type = 'reward' THEN rp.amount_inr
                     ELSE -rp.amount_inr END) AS amount
       FROM cost_centre_reward_penalty rp
       JOIN cost_centre_master ccm ON ccm.id = rp.cost_centre_id
       LEFT JOIN ${PROCESS_BY_COST_CENTRE} pc ON pc.cost_centre_id = ccm.id
      WHERE rp.period_code = ? AND rp.approval_status = 'approved'
        AND ${OWN_COMPANY_SQL}
      GROUP BY ccm.branch_id, rp.cost_centre_id, pc.process_id`,
    [periodCode]
  );
  return accumulate(rows);
}

export const pnlActualsService = {
  getIndirectCostActuals,
  getDriverRevenueActuals,
  getInvoicedRevenueActuals,
  getSeatRevenueActuals,
  getRewardPenaltyActuals,
};
