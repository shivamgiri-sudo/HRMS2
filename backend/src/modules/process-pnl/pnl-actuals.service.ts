import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { tableExists } from "../../shared/dbHelpers.js";
import { grnAllocationExGstSql, grnRequestExGstSql } from "./pnl-ex-gst.js";

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
 * employees posted to it (PROCESS_BY_COST_CENTRE), falling back to cost_centre_master.process_id
 * only when no employee is posted there at all -- pure client-billing cost centres with zero
 * headcount are otherwise permanently invisible to every process-level P&L query below, no matter
 * how much real invoice/GRN revenue they carry. cost_centre_master.process_id is populated by
 * cost-centre-process-resolver.service.ts (name-matched against process_master, DialDesk/Ispark
 * branches hard-excluded, ambiguous/generic matches refused) and stays NULL for anything it can't
 * resolve with confidence, so this fallback only ever adds coverage, never overrides the
 * employee-derived signal where one exists.
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
 * Approved per-employee cost-centre splits for the period, resolved to PROCESSES.
 *
 * Support staff who serve several cost centres are pooled at branch level today and spread by
 * the allocation driver, which is a reasonable guess and nothing more. Where finance has
 * recorded what someone actually splits across, the guess should not be used at all.
 *
 * The cost centre is mapped to a process by the same modal-employee rule the actuals use
 * (cost_centre_master.process_id is NULL on all 927 rows, so there is no FK to follow). A share
 * pointing at a cost centre with no derivable process is dropped HERE and left to the caller's
 * own fallback, because posting it nowhere would quietly delete salary.
 *
 * Moved here from bpo-pnl.service.ts (2026-09-12) so process-pnl.service.ts can share the exact
 * same resolution rather than reimplementing it — this file has no dependency on either of the
 * two callers, so both can import it without a circular import.
 */
export async function getApprovedCostCentreSplits(
  period: string
): Promise<Map<string, { processId: string; pct: number }[]>> {
  const splits = new Map<string, { processId: string; pct: number }[]>();
  if (!(await tableExists("employee_cost_centre_allocation"))) return splits;
  const [year, month] = period.split("-").map(Number);
  if (!year || !month) return splits;
  const periodEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT a.employee_id, a.allocation_pct, pc.process_id
       FROM employee_cost_centre_allocation a
       LEFT JOIN ${PROCESS_BY_COST_CENTRE} pc ON pc.cost_centre_id = a.cost_centre_id
      WHERE a.status = 'approved'
        AND a.effective_from <= ? AND (a.effective_to IS NULL OR a.effective_to >= ?)`,
    [periodEnd, periodEnd]
  );
  for (const row of rows) {
    if (!row.process_id) continue;
    const key = String(row.employee_id);
    const list = splits.get(key) ?? [];
    list.push({ processId: String(row.process_id), pct: Number(row.allocation_pct) || 0 });
    splits.set(key, list);
  }
  return splits;
}

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

/* ------------------------------------------------------------------------------------------------
 * THE ONE GRN READER (2026-09-23).
 *
 * Until now four P&L surfaces each ran their own copy of "GRN spend for a month" and they had
 * drifted apart:
 *   - P&L Statement (getIndirectCostActuals, below): app allocations + ordinary GRNs + mirror, but
 *     no company filter on the two app legs, so Ispark/IDC cost-centre GRN was counted as MAS IDC.
 *   - CEO Overview (ceo-overview spendByBranch): app allocations + mirror, company-filtered, but
 *     never counted ordinary (non-Smart) GRNs that have no allocation rows.
 *   - Live P&L (pnl-reconciliation readGrn/readGrnCommitted): app allocations + mirror, no company
 *     filter on the app leg, no ordinary-GRN leg.
 *   - CEO buildFocus' branch-overhead heuristic: its own copy, mirror leg not company-filtered.
 * All of them now read readGrnSpend(), so they can only disagree on grouping, never on the rows:
 *   - period: grn_request.accounting_period (app legs), grn_entry_snapshot.period_code (mirror).
 *   - company: OWN_COMPANY_SQL on EVERY leg — a GRN counts as MAS indirect cost only when it is
 *     booked to a MAS Callnet cost centre (the rule the CEO view and every mirror leg already used).
 *   - amount: EX-GST on every leg (owner rule 2026-09-24: "Revenue and GRN — all components —
 *     must be NON-GST amounts"). App legs read amount_without_tax (via pnl-ex-gst.ts, which guards
 *     legacy rows whose ex-GST column is still the 0 default); the mirror's net-of-tax l.amount,
 *     never l.total, for a GRN the app has not captured (the NOT EXISTS dedup guard on grn_number).
 *     This replaced pnl_cost_amount, which carried non-recoverable GST — see the history below.
 *   - 'consumed' = allocation rows with lifecycle_status 'consumed' + ordinary GRNs (budget line,
 *     no allocation rows, not draft/rejected/cancelled) + mirror gap-fill.
 *     'reserved' = allocation rows with lifecycle_status 'reserved' only (an in-app approval state
 *     the mirror never holds; ordinary GRNs have no reserved stage). Whether reserved spend is
 *     shown at all is the caller's rule (the estimate window) — this only reads it.
 *
 * Deliberately NOT routed here, and why:
 *   - process-pnl.service.ts's indirect pool (vendor_payment_tracking by due_date) — a different
 *     question (vendor payments falling due), see the comment there.
 *   - pnl-daily-trend.service.ts — a per-DAY chart keyed on bill_date, see the comment there.
 * ---------------------------------------------------------------------------------------------- */
export type GrnSpendKind = "consumed" | "reserved";

export interface GrnSpendRow {
  branchId: string | null;
  costCentreId: string | null;
  /** Only resolved when `withProcess` is asked for (it costs a PROCESS_BY_COST_CENTRE join). */
  processId: string | null;
  amount: number;
  /** Only populated when `withDetail` is asked for (the drilldown): which leg the row came from,
   *  the GRN's own number, a human label and the bill date. Null otherwise. */
  source?: "app_allocation" | "app_grn" | "db_bill_mirror" | null;
  grnRef?: string | null;
  label?: string | null;
  billDate?: string | null;
}

export interface GrnSpendOptions {
  /** Restrict to these cost centre ids. */
  costCentreIds?: string[];
  /** Restrict to cost centres that have staff posted to these processes (CEO Overview scope). */
  processIds?: string[];
  /** Resolve process_id per row (the Statement's process view needs it; others do not). */
  withProcess?: boolean;
  /**
   * One row per GRN (per leg) instead of per branch/cost centre/process — for the drilldown, so
   * its rows are the SAME rows the summary tiles sum (audit item 17a). Grouping keys only get
   * finer; the rows and amounts read are identical, so the totals cannot differ.
   */
  withDetail?: boolean;
}

const inMarks = (list: string[]) => list.map(() => "?").join(",");

/** Scope predicates on `ccm`, shared by every leg so the legs cannot scope differently. */
function grnScope(opts: GrnSpendOptions): { sql: string; params: unknown[] } {
  const parts: string[] = [OWN_COMPANY_SQL];
  const params: unknown[] = [];
  if (opts.costCentreIds?.length) {
    parts.push(`ccm.id IN (${inMarks(opts.costCentreIds)})`);
    params.push(...opts.costCentreIds);
  }
  if (opts.processIds?.length) {
    parts.push(`ccm.id IN (SELECT DISTINCT e.cost_centre_id FROM employees e
                            WHERE e.process_id IN (${inMarks(opts.processIds)}) AND e.cost_centre_id IS NOT NULL)`);
    params.push(...opts.processIds);
  }
  return { sql: parts.join(" AND "), params };
}

export async function readGrnSpend(
  periodCode: string,
  kind: GrnSpendKind,
  opts: GrnSpendOptions = {},
): Promise<GrnSpendRow[]> {
  if (!/^\d{4}-\d{2}$/.test(periodCode)) return [];
  // Inlined as a literal (not a bind parameter) so the SQL states which lifecycle it reads; the
  // value is re-checked against the closed set here, so nothing caller-supplied reaches the SQL.
  const lifecycle = kind === "reserved" ? "reserved" : "consumed";
  const scope = grnScope(opts);
  const withProcess = opts.withProcess === true;
  const processJoin = (alias: string) => (withProcess ? `LEFT JOIN ${PROCESS_BY_COST_CENTRE} ${alias} ON ${alias}.cost_centre_id = ccm.id` : "");
  const processCol = (first: string | null, alias: string) =>
    withProcess ? `COALESCE(${first ? `${first}, ` : ""}${alias}.process_id, ccm.process_id)` : "NULL";
  // Detail columns are normalised to one collation so the UNION of an app table and a mirror
  // table can never raise "Illegal mix of collations"; NULL when detail is not asked for, which
  // leaves the grouping exactly as it was.
  const withDetail = opts.withDetail === true;
  const str = (expr: string) => `CONVERT(${expr} USING utf8mb4) COLLATE utf8mb4_unicode_ci`;
  const detailCols = (source: string, ref: string, label: string, billDate: string) =>
    withDetail
      ? `${str(`'${source}'`)} AS source, ${str(ref)} AS grn_ref, ${str(label)} AS label,
         DATE_FORMAT(${billDate}, '%Y-%m-%d') AS bill_date`
      : "NULL AS source, NULL AS grn_ref, NULL AS label, NULL AS bill_date";
  const appLabel = "CONCAT_WS(' — ', NULLIF(TRIM(gr.vendor_name), ''), NULLIF(TRIM(gr.head), ''), NULLIF(TRIM(gr.sub_head), ''))";

  const legs: string[] = [];
  const params: unknown[] = [];

  // Leg 1 — Smart GRN per-cost-centre allocation rows.
  legs.push(
    `SELECT COALESCE(ccm.branch_id, gr.branch_id) AS branch_id, ccm.id AS cost_centre_id,
            ${processCol("a.process_id", "pc1")} AS process_id, ${grnAllocationExGstSql("a")} AS amount,
            ${detailCols("app_allocation", "COALESCE(gr.grn_number, gr.id)", appLabel, "gr.bill_date")}
       FROM grn_cost_allocation a
       JOIN grn_request gr ON gr.id = a.grn_request_id
       LEFT JOIN cost_centre_master ccm ON ccm.id = a.cost_centre_id
       ${processJoin("pc1")}
      WHERE a.lifecycle_status = '${lifecycle}' AND gr.accounting_period = ? AND ${scope.sql}`,
  );
  params.push(periodCode, ...scope.params);

  if (kind === "consumed") {
    // Leg 2 — ordinary GRN: amount on grn_request itself, no allocation rows (so a Smart GRN is
    // never counted twice).
    legs.push(
      `SELECT COALESCE(ccm.branch_id, gr.branch_id) AS branch_id, ccm.id AS cost_centre_id,
              ${processCol("gr.process_id", "pc2")} AS process_id, ${grnRequestExGstSql("gr")} AS amount,
              ${detailCols("app_grn", "COALESCE(gr.grn_number, gr.id)", appLabel, "gr.bill_date")}
         FROM grn_request gr
         LEFT JOIN cost_centre_master ccm ON ccm.id = gr.cost_centre_id
         ${processJoin("pc2")}
        WHERE gr.budget_line_id IS NOT NULL
          AND gr.status NOT IN ('draft', 'rejected', 'cancelled')
          AND gr.accounting_period = ?
          AND NOT EXISTS (SELECT 1 FROM grn_cost_allocation x WHERE x.grn_request_id = gr.id)
          AND ${scope.sql}`,
    );
    params.push(periodCode, ...scope.params);

    // Leg 3 — db_bill mirror, only for a GRN number the app has not consumed itself. Line level,
    // because only the line carries the cost centre; branch from the cost centre because the
    // mirror's branch ids are db_bill's, not branch_master's.
    if (await tableExists("grn_entry_line_snapshot")) {
      legs.push(
        `SELECT ccm.branch_id AS branch_id, ccm.id AS cost_centre_id,
                ${processCol(null, "pc3")} AS process_id, l.amount AS amount,
                ${detailCols(
                  "db_bill_mirror",
                  "COALESCE(ge.grn_no, l.bill_source_id)",
                  "CONCAT_WS(' — ', NULLIF(TRIM(ge.vendor), ''), NULLIF(TRIM(l.particular), ''))",
                  "ge.bill_date",
                )}
           FROM grn_entry_line_snapshot l
           JOIN grn_entry_snapshot ge ON ge.bill_source_id = l.grn_source_id
           LEFT JOIN cost_centre_master ccm
                  ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci
                   = l.cost_centre_code COLLATE utf8mb4_unicode_ci
           ${processJoin("pc3")}
          WHERE ge.period_code = ? AND ge.is_rejected = 0 AND ${scope.sql}
            AND NOT EXISTS (
                  SELECT 1
                    FROM grn_request gr2
                    JOIN grn_cost_allocation a2 ON a2.grn_request_id = gr2.id
                   WHERE gr2.grn_number = ge.grn_no
                     AND a2.lifecycle_status = 'consumed'
                )`,
      );
      params.push(periodCode, ...scope.params);
    }
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT branch_id, cost_centre_id, process_id, source, grn_ref, label, bill_date, SUM(amount) AS amount
       FROM (${legs.join("\n UNION ALL \n")}) t
      GROUP BY branch_id, cost_centre_id, process_id, source, grn_ref, label, bill_date`,
    params,
  );
  const text = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));
  return rows
    .map((row) => ({
      branchId: row.branch_id ? String(row.branch_id) : null,
      costCentreId: row.cost_centre_id ? String(row.cost_centre_id) : null,
      processId: row.process_id ? String(row.process_id) : null,
      amount: Number(row.amount ?? 0),
      ...(withDetail
        ? {
            source: (text(row.source) as GrnSpendRow["source"]) ?? null,
            grnRef: text(row.grn_ref),
            label: text(row.label),
            billDate: text(row.bill_date),
          }
        : {}),
    }))
    .filter((row) => Number.isFinite(row.amount) && row.amount !== 0);
}

export async function getIndirectCostActuals(periodCode: string): Promise<ActualsByKey> {
  if (!/^\d{4}-\d{2}$/.test(periodCode)) return emptyActuals();
  // 2026-09-23: now a thin grouping over readGrnSpend() — the single GRN reader shared with CEO
  // Overview and Live P&L (see its banner). The history below is kept because it explains why the
  // shared reader looks the way it does.
  const spend = await readGrnSpend(periodCode, "consumed", { withProcess: true });
  return accumulate(spend.map((row) => ({
    branch_id: row.branchId,
    cost_centre_id: row.costCentreId,
    process_id: row.processId,
    amount: row.amount,
  }) as unknown as RowDataPacket));
}

/*
 * History of the GRN reader above (it used to be the body of getIndirectCostActuals):
 *
 * - Two app GRN paths write spend: the Smart GRN writes per-line rows to grn_cost_allocation,
 *   the ordinary GRN keeps budget_line_id and the amount on grn_request itself. Counting only one
 *   reported zero cost against a budget that had genuinely consumed, so both are union'd, and the
 *   ordinary leg only takes GRNs with NO allocation rows, so a Smart GRN is never counted twice.
 * - 2026-08-29: both app legs read pnl_cost_amount, not amount_without_tax. They are equal only
 *   when GST is 100% recoverable; on a line with a lower recoverable_tax_pct (e.g. an exempt /
 *   non_gst budget line, default 0%) amount_without_tax drops the non-recoverable tax slice that
 *   IS a real P&L expense. pnl_cost_amount is what calculateBudgetLine() computes for exactly this
 *   (baseAmount + taxAmount - recoverableTaxAmount) and what vw_process_pnl_grn_allocation and
 *   branch-budget.service.ts's GRN drill-through read.
 * - 2026-09-24: OVERRIDDEN BY THE OWNER. "Revenue and GRN — all components — must be NON-GST
 *   amounts." P&L GRN is now ex-GST: both app legs read amount_without_tax (pnl-ex-gst.ts), so the
 *   non-recoverable tax slice no longer counts as P&L cost. The budget side the P&L compares GRN
 *   against (pnl-budget-source.ts) moved to base_amount in the same change, so budget vs GRN stays
 *   on one basis. pnl_cost_amount is still what the GRN gate / budget consumption enforce against;
 *   that enforcement path was left unchanged (owner decision pending).
 * - 2026-08-29: the db_bill mirror (grn_entry_line_snapshot) was double-counting — 1,452 of 1,495
 *   consumed app GRNs (97%) were also in the mirror under the same GRN number, overstating the
 *   Statement's IDC by Rs 3,37,46,372 for Apr-Aug 2026. The NOT EXISTS guard on
 *   grn_number = grn_no makes the app's own consumed allocation win; the mirror only fills a GRN
 *   the app has not captured. Mirror read at LINE level (only the line carries the cost centre),
 *   branch taken from the cost centre (the mirror's branch ids are db_bill's), and l.amount
 *   (net of tax) — never l.total, whose GST is ITC-recoverable and not a P&L expense.
 * - 2026-09-02 PERF: process attribution via the precomputed PROCESS_BY_COST_CENTRE join, not the
 *   per-row PROCESS_FROM_EMPLOYEES correlated subquery (30-46s+ per call -> ~1.7s, identical rows).
 * - 2026-09-23: OWN_COMPANY_SQL now applies to the two app legs too (it was mirror-only here), and
 *   the whole thing moved into readGrnSpend() so CEO Overview and Live P&L read the same rows.
 */

/**
 * Process each cost centre resolves to, by the SAME rule getInvoicedRevenueActuals attributes
 * invoice revenue with (modal employee process, else cost_centre_master.process_id) — so a
 * per-cost-centre figure from elsewhere (e.g. Live P&L's seat-rate estimate) lands on the same
 * process column as that cost centre's invoices.
 */
export async function getCostCentreProcessIds(costCentreIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (costCentreIds.length === 0) return out;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ccm.id AS cost_centre_id, COALESCE(pc.process_id, ccm.process_id) AS process_id
       FROM cost_centre_master ccm
       LEFT JOIN ${PROCESS_BY_COST_CENTRE} pc ON pc.cost_centre_id = ccm.id
      WHERE ccm.id IN (${inMarks(costCentreIds)})`,
    costCentreIds,
  );
  for (const row of rows) if (row.process_id) out.set(String(row.cost_centre_id), String(row.process_id));
  return out;
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
  //   GST BASIS UNVERIFIED (2026-09-24). The owner rule is that P&L revenue is ex-GST. Invoice
  //   particulars (SOURCE A) are taxable values, but provision_master carries no tax split and no
  //   stated basis, so provision_amt / billing_amt may or may not include GST. Read as-is; not
  //   guessed. To verify, compare them with the same cost centre + month's invoice taxable value
  //   (billing_invoice_snapshot.total_amt) vs its GST-inclusive grand_total — see the report of
  //   the 2026-09-24 ex-GST change for the exact read-only SQL.
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
              COALESCE(pc.process_id, ccm.process_id) AS process_id, SUM(p.amount) AS invoice_amount
         FROM billing_invoice_particular_snapshot p
         LEFT JOIN cost_centre_master ccm
                ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci
                 = p.cost_centre_code COLLATE utf8mb4_unicode_ci
         LEFT JOIN ${PROCESS_BY_COST_CENTRE} pc ON pc.cost_centre_id = ccm.id
        WHERE p.period_code = ? AND ${OWN_COMPANY_SQL}
        GROUP BY p.cost_centre_code COLLATE utf8mb4_unicode_ci, ccm.branch_id, ccm.id, COALESCE(pc.process_id, ccm.process_id)
     ),
     provision_actual AS (
       SELECT ps.cost_centre_code COLLATE utf8mb4_unicode_ci AS cost_centre_code,
              ccm.branch_id AS branch_id, ccm.id AS cost_centre_id,
              COALESCE(pc.process_id, ccm.process_id) AS process_id,
              SUM(CASE WHEN ps.billing_amt > 0 THEN ps.billing_amt ELSE ps.provision_amt END) AS provision_amount
         FROM billing_provision_snapshot ps
         LEFT JOIN cost_centre_master ccm
                ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci
                 = ps.cost_centre_code COLLATE utf8mb4_unicode_ci
         LEFT JOIN ${PROCESS_BY_COST_CENTRE} pc ON pc.cost_centre_id = ccm.id
        WHERE ps.period_code = ? AND ps.revenue_active = 1 AND ${OWN_COMPANY_SQL}
        GROUP BY ps.cost_centre_code COLLATE utf8mb4_unicode_ci, ccm.branch_id, ccm.id, COALESCE(pc.process_id, ccm.process_id)
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
        SELECT ccm.branch_id, ccm.id, COALESCE(pc.process_id, ccm.process_id), -cn.total_amt
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
               COALESCE(pc.process_id, ccm.process_id) AS process_id, p.amount AS amount
          FROM billing_invoice_particular_snapshot p
          LEFT JOIN cost_centre_master ccm
                 ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci
                  = p.cost_centre_code COLLATE utf8mb4_unicode_ci
          LEFT JOIN ${PROCESS_BY_COST_CENTRE} pc ON pc.cost_centre_id = ccm.id
         WHERE p.period_code = ? AND ${OWN_COMPANY_SQL}
        UNION ALL
        SELECT ccm.branch_id, ccm.id, COALESCE(pc.process_id, ccm.process_id), -cn.total_amt
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
  //
  // GST BASIS UNVERIFIED (2026-09-24, owner rule: P&L revenue is ex-GST). None of the rate
  // sources below — cost_centre_seat_rate / employee_seat_rate_override /
  // process_role_billability .seat_rate_monthly, nor finance_cost_centre_monthly_driver
  // .revenue_rate_per_head — records whether the rate includes GST. Used as entered; not
  // adjusted by a guessed 18%. Verify against the invoiced per-seat rate
  // (billing_invoice_particular_snapshot.rate on is_seat_line = 1, a taxable value) before
  // treating these as ex-GST.
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
            COALESCE(pc.process_id, ccm.process_id) AS process_id,
            SUM(CASE WHEN rp.entry_type = 'reward' THEN rp.amount_inr
                     ELSE -rp.amount_inr END) AS amount
       FROM cost_centre_reward_penalty rp
       JOIN cost_centre_master ccm ON ccm.id = rp.cost_centre_id
       LEFT JOIN ${PROCESS_BY_COST_CENTRE} pc ON pc.cost_centre_id = ccm.id
      WHERE rp.period_code = ? AND rp.approval_status = 'approved'
        AND ${OWN_COMPANY_SQL}
      GROUP BY ccm.branch_id, rp.cost_centre_id, COALESCE(pc.process_id, ccm.process_id)`,
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
