import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { getDbBillHistory } from "./pnl-trend-history.service.js";

/**
 * Revenue / cost / margin trend, and headcount-vs-revenue trend, per process across the months
 * that actually carry real billing data.
 *
 * WHY "REAL MONTHS" ARE DISCOVERED RATHER THAN HARDCODED. Measured 2026-09-10,
 * billing_invoice_particular_snapshot has ~150 rows/month for 2026-04 through 2026-08, then falls
 * to single digits or low teens for 2026-09 onward (skeleton/placeholder rows, not real invoicing).
 * Hardcoding "2026-04..2026-08" would silently go stale the day a new month's real invoicing
 * lands, so this instead counts rows per period_code and keeps only periods at or above
 * REAL_MONTH_ROW_THRESHOLD. This is the same self-adjusting idea as the rest of this page's
 * dataStatus badges: never assert more precision than the data supports, and never require a code
 * change to recognise new real data.
 *
 * Revenue and cost use the same two join paths already used across this module (see
 * ceo-overview.service.ts / process-pnl.service.ts):
 *   revenue: process_master -> cost_centre_master -> billing_invoice_particular_snapshot
 *            (joined on cost_centre_code, COLLATE-matched — see hrms2-collate-casts-kill-indexes)
 *   cost:    salary_prep_run -> salary_prep_line -> employees -> process_master
 *            (sr.status <> 'draft' only — draft runs are not committed payroll)
 * These are two independent grains (billing period_code vs payroll run_month) that happen to use
 * the same "YYYY-MM" string, exactly as the rest of process-pnl does; they are not reconciled here,
 * only placed on the same monthly axis, same as every other trend chart on this page.
 */

const REAL_MONTH_ROW_THRESHOLD = 30;

const n = (v: unknown): number => {
  const p = Number(v ?? 0);
  return Number.isFinite(p) ? p : 0;
};

export interface PnlTrendMonth {
  period: string;
  revenue: number;
  cost: number;
  margin: number;
  headcount: number;
  source?: "mas_hrms" | "db_bill";
}

export interface PnlTrendProcess {
  processId: string;
  processName: string;
  months: PnlTrendMonth[];
}

export interface PnlTrendYoyYear {
  year: number;
  /** Cumulative margin by calendar month (1-12), only for months actually present in `company`. */
  points: { month: number; cumulativeMargin: number }[];
  /** true only if all 12 months of this year are present in the combined company series. */
  complete: boolean;
  source: "mas_hrms" | "db_bill" | "mixed";
}

export interface PnlTrendResult {
  realMonths: string[];
  dataStatus: {
    revenueSource: "billing_invoice_particular_snapshot";
    costSource: "salary_prep_line";
    note: string;
  };
  processes: PnlTrendProcess[];
  /** Same series summed across all processes, for a company-wide chart (mas_hrms months only). */
  company: PnlTrendMonth[];
  /**
   * Company-wide trend extended back through legacy db_bill history (2018-01 onward where both
   * revenue and cost are real — see pnl-trend-history.service.ts). Each month is tagged `source`
   * so the UI can render the two eras distinctly. Only populated when no branch/process filter is
   * applied (the db_bill mapping isn't reliable enough to filter by branch/process — see
   * historyCaveat).
   */
  companyHistory: PnlTrendMonth[];
  historyDataStatus: {
    available: boolean;
    revenueRealRange: [string, string] | null;
    costRealRange: [string, string] | null;
    overlapRange: [string, string] | null;
    caveat: string;
  };
  /** Year-over-year cumulative profit (margin), built from companyHistory + company combined. */
  yoy: PnlTrendYoyYear[];
}

async function getRealMonths(): Promise<string[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT period_code, COUNT(*) AS n
       FROM billing_invoice_particular_snapshot
      GROUP BY period_code
     HAVING COUNT(*) >= ?
      ORDER BY period_code`,
    [REAL_MONTH_ROW_THRESHOLD]
  );
  return rows.map((r) => String(r.period_code));
}

export async function getPnlTrend(filters: { branchId?: string; processId?: string } = {}): Promise<PnlTrendResult> {
  const realMonths = await getRealMonths();
  if (realMonths.length === 0) {
    return {
      realMonths: [],
      dataStatus: {
        revenueSource: "billing_invoice_particular_snapshot",
        costSource: "salary_prep_line",
        note: "No period has enough real billing rows yet.",
      },
      processes: [],
      company: [],
      companyHistory: [],
      historyDataStatus: {
        available: false,
        revenueRealRange: null,
        costRealRange: null,
        overlapRange: null,
        caveat: "No mas_hrms real month yet; history merge skipped.",
      },
      yoy: [],
    };
  }

  const branchClause = filters.branchId ? "AND ccm.branch_id = ?" : "";
  const processClause = filters.processId ? "AND pm.id = ?" : "";
  const revenueParams: unknown[] = [realMonths];
  if (filters.branchId) revenueParams.push(filters.branchId);
  if (filters.processId) revenueParams.push(filters.processId);

  const [revenueRows] = await db.query<RowDataPacket[]>(
    `SELECT pm.id AS processId, pm.process_name AS processName,
            bips.period_code AS period,
            SUM(bips.amount) AS revenue
       FROM process_master pm
       JOIN cost_centre_master ccm ON ccm.process_id = pm.id
       JOIN billing_invoice_particular_snapshot bips
         ON bips.cost_centre_code COLLATE utf8mb4_unicode_ci = ccm.cost_centre_code COLLATE utf8mb4_unicode_ci
      WHERE bips.period_code IN (?) ${branchClause} ${processClause}
      GROUP BY pm.id, pm.process_name, bips.period_code`,
    revenueParams
  );

  const costParams: unknown[] = [realMonths];
  if (filters.branchId) costParams.push(filters.branchId);
  if (filters.processId) costParams.push(filters.processId);

  const [costRows] = await db.query<RowDataPacket[]>(
    `SELECT pm.id AS processId, pm.process_name AS processName,
            sr.run_month AS period,
            SUM(spl.gross_salary) AS cost,
            COUNT(DISTINCT spl.employee_id) AS headcount
       FROM salary_prep_run sr
       JOIN salary_prep_line spl ON spl.run_id = sr.id
       JOIN employees e ON e.id = spl.employee_id
       JOIN process_master pm ON pm.id = e.process_id
       LEFT JOIN cost_centre_master ccm ON ccm.id = e.cost_centre_id
      WHERE sr.status <> 'draft' AND sr.run_month IN (?) ${branchClause ? "AND ccm.branch_id = ?" : ""} ${processClause}
      GROUP BY pm.id, pm.process_name, sr.run_month`,
    costParams
  );

  type Bucket = Map<string, PnlTrendMonth>;
  const byProcess = new Map<string, { processName: string; months: Bucket }>();

  const ensure = (processId: string, processName: string): Bucket => {
    let entry = byProcess.get(processId);
    if (!entry) {
      entry = { processName, months: new Map() };
      byProcess.set(processId, entry);
    }
    return entry.months;
  };
  const ensureMonth = (bucket: Bucket, period: string): PnlTrendMonth => {
    let m = bucket.get(period);
    if (!m) {
      m = { period, revenue: 0, cost: 0, margin: 0, headcount: 0 };
      bucket.set(period, m);
    }
    return m;
  };

  for (const row of revenueRows) {
    const bucket = ensure(String(row.processId), String(row.processName ?? "Unnamed process"));
    const month = ensureMonth(bucket, String(row.period));
    month.revenue += n(row.revenue);
  }
  for (const row of costRows) {
    const bucket = ensure(String(row.processId), String(row.processName ?? "Unnamed process"));
    const month = ensureMonth(bucket, String(row.period));
    month.cost += n(row.cost);
    month.headcount += n(row.headcount);
  }

  const processes: PnlTrendProcess[] = [];
  const companyMap = new Map<string, PnlTrendMonth>();
  for (const [processId, entry] of byProcess) {
    const months = realMonths.map((period) => {
      const m = entry.months.get(period) ?? { period, revenue: 0, cost: 0, margin: 0, headcount: 0 };
      m.margin = m.revenue - m.cost;
      const c = companyMap.get(period) ?? { period, revenue: 0, cost: 0, margin: 0, headcount: 0 };
      c.revenue += m.revenue;
      c.cost += m.cost;
      c.margin += m.margin;
      c.headcount += m.headcount;
      companyMap.set(period, c);
      return m;
    });
    processes.push({ processId, processName: entry.processName, months });
  }
  processes.sort((a, b) => a.processName.localeCompare(b.processName));

  const company: PnlTrendMonth[] = realMonths.map((p) => {
    const m = companyMap.get(p) ?? { period: p, revenue: 0, cost: 0, margin: 0, headcount: 0 };
    return { ...m, source: "mas_hrms" as const };
  });

  // ── db_bill historical extension (2026-09-10 build) ──────────────────────
  // Only attempted company-wide, unfiltered: db_bill's cost-centre-to-process mapping is too
  // sparse and inconsistent to filter by branch/process (see pnl-trend-history.service.ts).
  let companyHistory: PnlTrendMonth[] = [];
  let historyDataStatus: PnlTrendResult["historyDataStatus"] = {
    available: false,
    revenueRealRange: null,
    costRealRange: null,
    overlapRange: null,
    caveat: "Historical db_bill trend is only available on the unfiltered company view (no branch/process filter).",
  };

  if (!filters.branchId && !filters.processId) {
    try {
      const history = await getDbBillHistory(new Set(realMonths));
      companyHistory = history.months;
      historyDataStatus = {
        available: history.months.length > 0,
        revenueRealRange: history.revenueRealRange,
        costRealRange: history.costRealRange,
        overlapRange: history.overlapRange,
        caveat: history.caveat,
      };
    } catch (error) {
      historyDataStatus = {
        available: false,
        revenueRealRange: null,
        costRealRange: null,
        overlapRange: null,
        caveat: `db_bill history unavailable: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  const yoy = buildYoy([...companyHistory, ...company]);

  return {
    realMonths,
    dataStatus: {
      revenueSource: "billing_invoice_particular_snapshot",
      costSource: "salary_prep_line",
      note: `Real invoicing data covers ${realMonths[0]} through ${realMonths[realMonths.length - 1]} (${realMonths.length} month${realMonths.length === 1 ? "" : "s"}); other periods are sparse placeholder rows and are excluded.`,
    },
    processes,
    company,
    companyHistory,
    historyDataStatus,
    yoy,
  };
}

/**
 * Year-over-year cumulative margin ("profit"), built from the combined (db_bill + mas_hrms)
 * monthly company series. Only years where every month present is contiguous from January are
 * marked `complete`; a year missing months (e.g. the current year, or the very first historical
 * year if it starts mid-year) still gets a partial cumulative line, just flagged incomplete so the
 * UI doesn't compare a partial year to a full one as if they were equivalent.
 */
function buildYoy(monthsIn: PnlTrendMonth[]): PnlTrendYoyYear[] {
  const months = [...monthsIn].sort((a, b) => a.period.localeCompare(b.period));
  const byYear = new Map<number, PnlTrendMonth[]>();
  for (const m of months) {
    const [yStr, moStr] = m.period.split("-");
    const year = Number(yStr);
    const mo = Number(moStr);
    if (!Number.isFinite(year) || !Number.isFinite(mo)) continue;
    const list = byYear.get(year) ?? [];
    list.push(m);
    byYear.set(year, list);
  }

  const years: PnlTrendYoyYear[] = [];
  for (const [year, list] of byYear) {
    list.sort((a, b) => a.period.localeCompare(b.period));
    let cum = 0;
    const points = list.map((m) => {
      cum += m.margin;
      return { month: Number(m.period.split("-")[1]), cumulativeMargin: cum };
    });
    const monthNumbers = new Set(points.map((p) => p.month));
    const complete = monthNumbers.size === 12 && Array.from({ length: 12 }, (_, i) => i + 1).every((mo) => monthNumbers.has(mo));
    const sources = new Set(list.map((m) => m.source));
    const source: "mas_hrms" | "db_bill" | "mixed" = sources.size > 1 ? "mixed" : ((sources.values().next().value as "mas_hrms" | "db_bill" | undefined) ?? "db_bill");
    years.push({ year, points, complete, source });
  }
  years.sort((a, b) => a.year - b.year);
  return years;
}
