import { billQuery } from "../../db/billDb.js";

/**
 * Historical (pre-2026-04) company-wide revenue/cost/margin/headcount trend, sourced from the
 * legacy db_bill database — extends pnl-trend.service.ts's mas_hrms-only 5-month trend back to
 * 2018.
 *
 * WHY THIS EXISTS. A prior pass concluded db_bill had no usable revenue data and left the trend at
 * 5 months. That was wrong: it missed `db_bill.tbl_invoice`, which has 11,130 rows from
 * 2014-10-15 to 2026-09-10, most months from ~2016 onward carrying 60-150+ real invoices — far
 * from sparse. Verified 2026-09-10 (see report accompanying this build).
 *
 * REVENUE FIELD AND STATUS DECISION (evidence).
 *   - `total` + `tax` = `grnd` exactly on every sampled row (e.g. id=1: 48580 + 6004 = 54584 =
 *     grnd). So `total` is the GST-NET base amount and `grnd` is GST-inclusive. mas_hrms's own
 *     revenue convention (billing_invoice_particular_snapshot.amount, used by pnl-trend.service.ts)
 *     is GST-net, so this uses `total`, never `grnd`, to avoid silently mixing conventions across
 *     the 2026-03/2026-04 boundary.
 *   - `status`: 0 = 10,896 rows (98.0%) spanning 2014-2026, `total` sum ₹354.3 Cr; 1 = 234 rows
 *     (2.0%), scattered thinly across most years (never more than 56 rows/year), `total` sum
 *     ₹5.0 Cr, and every single status=1 row has both `approve_po` and `approve_grn` blank
 *     (unapproved) vs status=0 which includes both approved and pending rows. There is no
 *     InvoiceRejectRequest/InvoiceDeleteRemarks data at all (0 rows across the whole table — this
 *     legacy system apparently never recorded a reject/delete through those columns), so those
 *     columns provide no additional exclusion signal. Given status=1 is a thin, unapproved,
 *     scattered minority with no year showing it as anything but a small exception bucket, this
 *     treats status=0 as the normal/countable invoice population and excludes status=1 (same
 *     spirit as excluding drafts elsewhere in this module).
 *
 * PROCESS MAPPING (evidence, and why this is COMPANY-GRAIN ONLY).
 *   `cost_center` (tbl_invoice) / `CostCenter` (salary_data) match `cost_centre_master.cost_centre_code`
 *   at a 98%+ code level (824/836 distinct invoice cost centres, 292/297 distinct salary cost
 *   centres). BUT `cost_centre_master.process_id` is populated for only 47/941 rows overall, and the
 *   month-by-month share of revenue/cost actually reachable through that mapping swings wildly
 *   (12% of invoices in 2018-06 vs 46% in 2026-03) — restricting to mapped cost centres would not
 *   yield a stable, comparable company total across years, it would manufacture fake "growth" that
 *   is really just mapping coverage improving over time. This is why this module deliberately does
 *   NOT attempt a per-process historical breakdown and returns COMPANY-WIDE totals only (full sums,
 *   every cost centre, mapped or not) for the db_bill era. Note this is a different basis than the
 *   live mas_hrms company total in pnl-trend.service.ts, which (by that service's existing,
 *   unmodified logic) only sums cost centres that DO resolve to a process_id — so the two series
 *   are not perfectly apples-to-apples at the company grain either; both limitations are surfaced
 *   via dataStatus/caveat, not hidden.
 *
 * DATE RANGE (evidence). Monthly invoice counts (status=0) are consistently >=20/month from
 * 2015-09 onward (thin/zero before that — e.g. a single row in 2014-10, low single/double digits
 * through mid-2015). Monthly salary_data row counts are consistently >=600/month (typically
 * 1300-2200) for every month from 2018-01 through 2026-08, with zero NULL SalayDate rows. Because
 * a combined revenue/cost/margin trend requires BOTH sides to be real for the same month, the
 * usable overlap is 2018-01 through 2026-03 (the last full db_bill month before mas_hrms's own real
 * months begin at 2026-04) — that is the range this module returns.
 */

const REAL_REVENUE_MONTH_INVOICE_THRESHOLD = 20;
const REAL_COST_MONTH_ROW_THRESHOLD = 100;

/** First month mas_hrms carries real billing data (see pnl-trend.service.ts REAL_MONTH_ROW_THRESHOLD
 *  discovery) — db_bill history must stop strictly before this to avoid double-counting the
 *  boundary month. Kept as a constant here (rather than re-deriving it) because the two sources
 *  cannot be joined in one query (separate DB servers); pnl-trend.service.ts's own getRealMonths()
 *  remains the actual source of truth for where mas_hrms starts, and merge() below defends the
 *  boundary by simply excluding any db_bill period that also appears in the live realMonths list.
 */
export const MAS_HRMS_ERA_STARTS_AT = "2026-04";

const n = (v: unknown): number => {
  const p = Number(v ?? 0);
  return Number.isFinite(p) ? p : 0;
};

export interface PnlTrendHistoryMonth {
  period: string;
  revenue: number;
  cost: number;
  margin: number;
  headcount: number;
  source: "db_bill";
}

/** Revenue-only, per-process historical series (no cost side — see getDbBillHistoryByProcess). */
export interface PnlTrendHistoryProcessMonth {
  period: string;
  revenue: number;
}

export interface PnlTrendHistoryProcess {
  processName: string;
  months: PnlTrendHistoryProcessMonth[];
}

export interface PnlTrendHistoryResult {
  months: PnlTrendHistoryMonth[];
  revenueRealRange: [string, string] | null;
  costRealRange: [string, string] | null;
  overlapRange: [string, string] | null;
  caveat: string;
}

interface RevRow { period: string; revenue: string | number; n: number }
interface CostRow { period: string; cost: string | number; headcount: number; n: number }

export async function getDbBillHistory(excludePeriods: Set<string> = new Set()): Promise<PnlTrendHistoryResult> {
  const revRows = await billQuery<RevRow>(
    `SELECT DATE_FORMAT(invoiceDate, '%Y-%m') AS period, SUM(total) AS revenue, COUNT(*) AS n
       FROM tbl_invoice
      WHERE status = 0 AND invoiceDate IS NOT NULL
      GROUP BY period
     HAVING n >= ${REAL_REVENUE_MONTH_INVOICE_THRESHOLD}
      ORDER BY period`
  );
  const costRows = await billQuery<CostRow>(
    `SELECT DATE_FORMAT(SalayDate, '%Y-%m') AS period,
            SUM(CAST(Gross AS DECIMAL(14,2))) AS cost,
            COUNT(DISTINCT EmpCode) AS headcount,
            COUNT(*) AS n
       FROM salary_data
      WHERE SalayDate IS NOT NULL
      GROUP BY period
     HAVING n >= ${REAL_COST_MONTH_ROW_THRESHOLD}
      ORDER BY period`
  );

  if (revRows.length === 0 || costRows.length === 0) {
    return {
      months: [],
      revenueRealRange: null,
      costRealRange: null,
      overlapRange: null,
      caveat: "db_bill historical revenue or cost data is not available (no month met the row-count threshold).",
    };
  }

  const revenueRealRange: [string, string] = [revRows[0].period, revRows[revRows.length - 1].period];
  const costRealRange: [string, string] = [costRows[0].period, costRows[costRows.length - 1].period];

  const revMap = new Map(revRows.map((r) => [r.period, n(r.revenue)]));
  const costMap = new Map(costRows.map((r) => [r.period, { cost: n(r.cost), headcount: n(r.headcount) }]));

  const overlapPeriods = revRows
    .map((r) => r.period)
    .filter((p) => costMap.has(p) && p < MAS_HRMS_ERA_STARTS_AT && !excludePeriods.has(p))
    .sort();

  const months: PnlTrendHistoryMonth[] = overlapPeriods.map((period) => {
    const revenue = revMap.get(period) ?? 0;
    const costEntry = costMap.get(period)!;
    return {
      period,
      revenue,
      cost: costEntry.cost,
      margin: revenue - costEntry.cost,
      headcount: costEntry.headcount,
      source: "db_bill",
    };
  });

  const overlapRange: [string, string] | null =
    months.length > 0 ? [months[0].period, months[months.length - 1].period] : null;

  return {
    months,
    revenueRealRange,
    costRealRange,
    overlapRange,
    caveat:
      "Historical data from legacy db_bill system; revenue and cost definitions may differ slightly " +
      "from the current live (mas_hrms) system. Company-wide COST totals only (full sums across all " +
      "cost centres, via cost_centre_master.process_id, which is too sparse to break cost down by " +
      "process for this era). REVENUE, however, is available per process — see " +
      "getDbBillHistoryByProcess() below, which uses tbl_invoice.cost_process directly.",
  };
}

const REAL_REVENUE_MONTH_PROCESS_INVOICE_THRESHOLD = 5;

/**
 * Per-process historical REVENUE (not cost/margin — db_bill's cost side has no per-process
 * attribution, see getDbBillHistory's caveat above), sourced from tbl_invoice.cost_process
 * directly — never from cost_centre_master.process_id.
 *
 * WHY THIS EXISTS AND WHY IT IS DIFFERENT FROM THE PRIOR (COMPANY-ONLY) CONCLUSION. The prior pass
 * only tried cost_centre_master.process_id (populated for 47/941 rows — too sparse) and concluded no
 * reliable per-process db_bill breakdown was possible. That check never looked at tbl_invoice's own
 * cost_process column, which sits directly on the invoice row (no join needed) and is far more
 * complete: 9,581/11,130 rows (86%) carry a non-blank cost_process, verified 2026-09-11 via
 * `SELECT COUNT(*) FROM tbl_invoice WHERE cost_process IS NOT NULL AND cost_process <> ''`.
 *
 * VALUE MATCH (evidence). cost_process values are process names, not client names — e.g.
 * "UPSELLING & CROSSELLING", "DIALDESK", "CS-OTHERS", "INBOUND CUSTOMER SERVICES", "BACK OFFICE",
 * "background verification" — and 34 distinct values were checked one-by-one against
 * `mas_hrms.process_master.process_name` on 2026-09-11: every one of the top-30-by-revenue
 * cost_process values has an exact (case/whitespace-normalized) match in process_master, e.g.
 * "background verification" -> Rs 96.43 Cr across 380 invoices, 2018-08 to 2026-08;
 * "UPSELLING & CROSSELLING" -> Rs 46.18 Cr across 1,084 invoices, 2015-07 to 2026-09;
 * "DIALDESK" -> Rs 12.42 Cr across 2,521 invoices, 2016-12 to 2026-09.
 * This is matched here by UPPER(TRIM(...)) against process_master.process_name at query time in
 * pnl-trend.service.ts (which has access to the mas_hrms process_master table); this function only
 * returns the raw db_bill-side series keyed by the literal cost_process string.
 *
 * WHAT THIS DOES NOT FIX. `cost_process` still has no COST counterpart on the salary_data side
 * (salary_data has no process/cost_process column at all), so a true per-process P&L (revenue AND
 * cost) for the pre-2026-04 era remains not buildable — only the revenue half is real here. This is
 * the same distinction process_master.process_name-matched revenue always required: never presented
 * as a full per-process margin trend for this era.
 */
export async function getDbBillHistoryByProcess(): Promise<PnlTrendHistoryProcess[]> {
  const rows = await billQuery<{ cost_process: string; period: string; revenue: string | number; n: number }>(
    `SELECT TRIM(cost_process) AS cost_process, DATE_FORMAT(invoiceDate, '%Y-%m') AS period,
            SUM(total) AS revenue, COUNT(*) AS n
       FROM tbl_invoice
      WHERE status = 0 AND invoiceDate IS NOT NULL AND cost_process IS NOT NULL AND TRIM(cost_process) <> ''
      GROUP BY TRIM(cost_process), period
     HAVING n >= ${REAL_REVENUE_MONTH_PROCESS_INVOICE_THRESHOLD}
      ORDER BY cost_process, period`
  );

  const byProcess = new Map<string, PnlTrendHistoryProcessMonth[]>();
  for (const row of rows) {
    const key = row.cost_process;
    const list = byProcess.get(key) ?? [];
    list.push({ period: row.period, revenue: n(row.revenue) });
    byProcess.set(key, list);
  }
  return Array.from(byProcess.entries()).map(([processName, months]) => ({ processName, months }));
}
