import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { tableExists } from "../../shared/dbHelpers.js";
import { OWN_COMPANY_SQL } from "./pnl-actuals.service.js";

/**
 * Where this month's seat revenue is heading, from seat count times seat rate.
 *
 * INFORMATIONAL ONLY, DELIBERATELY. Nothing here is written anywhere, and no figure produced by
 * this file enters recognizedRevenue, operatingProfit or ebitda. It exists to pre-fill the amount
 * on the existing "Projected Revenue" manual adjustment, which pnl-manual-adjustment.service.ts
 * already keeps out of the reported P&L on purpose (see its doc comment and the regression test
 * that pins it). One forward-looking number, in the one place forward-looking numbers already
 * live, rather than a second competing forecast surface.
 *
 * WHY IT DOES NOT REUSE getSeatRevenueActuals(). That function joins salary_prep_line through
 * salary_prep_run.run_month, so it answers only for a month payroll has already run. Measured
 * 2026-09-03 the latest run is 2026-07, so it returns nothing for the month a forecast is actually
 * wanted for. This computes the forward view from live headcount and the approved rate instead.
 *
 * WHAT IT DELIBERATELY WILL NOT DO. Only cost centres with an approved per_seat rate are
 * forecast. Roughly 70% of active cost centres bill on outcome or volume rather than seats, and no
 * principled seat run-rate exists for them — inventing one (a prior-period average, say) would put
 * an authoritative-looking number against work whose revenue does not behave that way. They are
 * counted and reported as out of scope instead, so the coverage of the forecast is visible rather
 * than implied.
 */

const n = (v: unknown): number => {
  const p = Number(v ?? 0);
  return Number.isFinite(p) ? p : 0;
};

export interface SeatForecastProcess {
  processId: string;
  processName: string | null;
  billableSeats: number;
  projectedMonthEnd: number;
  earnedToDate: number;
}

export interface SeatForecastCostCentre {
  costCentreId: string;
  costCentreName: string;
  /** Resolved by the same modal-process-of-posted-staff rule the P&L actuals use; NULL when the
   *  cost centre's staff carry no process. */
  processId: string | null;
  processName: string | null;
  branchName: string | null;
  seatRateMonthly: number;
  activeHeadcount: number;
  /** Staff classified as agents — the seats a client is billed for. */
  billableSeats: number;
  /** Active staff with no classification row, so neither counted nor silently treated as billable. */
  unclassifiedHeadcount: number;
  projectedMonthEnd: number;
  earnedToDate: number;
}

export interface SeatRevenueForecast {
  period: string;
  asOfDate: string;
  daysElapsed: number;
  daysInMonth: number;
  /** Which snapshot period the agent/support classification was taken from. */
  classificationPeriod: string | null;
  costCentres: SeatForecastCostCentre[];
  /** The same forecast aggregated to process, so a process-scoped Projected Revenue adjustment can
   *  be pre-filled with a figure that belongs to that process rather than the whole company. */
  byProcess: SeatForecastProcess[];
  projectedMonthEnd: number;
  earnedToDate: number;
  billableSeats: number;
  unclassifiedHeadcount: number;
  coverage: {
    seatBilledCostCentres: number;
    notSeatBilledCostCentres: number;
    activeCostCentresWithStaff: number;
    /** Share of staffed, active cost centres this forecast actually covers. */
    coveragePct: number;
  };
  method: "seat_rate_run_rate";
}

/** Days in the month, and how many of them have elapsed as of `asOf` (IST-dated by the caller). */
function monthProgress(period: string, asOf: string): { daysInMonth: number; daysElapsed: number } {
  const [year, month] = period.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const sameMonth = asOf.slice(0, 7) === period;
  const daysElapsed = sameMonth
    ? Math.min(daysInMonth, Number(asOf.slice(8, 10)))
    : asOf.slice(0, 7) > period
      ? daysInMonth // a closed month is fully elapsed
      : 0;          // a month that has not started yet has earned nothing
  return { daysInMonth, daysElapsed };
}

/**
 * The period whose classification snapshot should decide who is an agent.
 *
 * The current month usually has no snapshot yet (refresh runs at rollover), so falling back to the
 * most recent one that exists is what keeps the forecast from reporting zero billable seats on the
 * 1st. Returned to the caller so the UI can say which month the classification came from rather
 * than implying it is current.
 */
async function latestClassificationPeriod(period: string): Promise<string | null> {
  if (!(await tableExists("pnl_running_salary_snapshot"))) return null;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT period_code FROM pnl_running_salary_snapshot
      WHERE period_code <= ?
      GROUP BY period_code
      ORDER BY period_code DESC
      LIMIT 1`,
    [period],
  );
  return rows.length ? String(rows[0].period_code) : null;
}

export async function getSeatRevenueForecast(
  period: string,
  options: { asOfDate?: string; branchId?: string } = {},
): Promise<SeatRevenueForecast> {
  if (!/^\d{4}-\d{2}$/.test(period)) {
    throw Object.assign(new Error("period must be YYYY-MM"), { statusCode: 400 });
  }
  const asOfDate = options.asOfDate ?? new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());

  const { daysInMonth, daysElapsed } = monthProgress(period, asOfDate);
  const classificationPeriod = await latestClassificationPeriod(period);

  const empty: SeatRevenueForecast = {
    period, asOfDate, daysElapsed, daysInMonth, classificationPeriod,
    costCentres: [], byProcess: [], projectedMonthEnd: 0, earnedToDate: 0,
    billableSeats: 0, unclassifiedHeadcount: 0,
    coverage: {
      seatBilledCostCentres: 0, notSeatBilledCostCentres: 0,
      activeCostCentresWithStaff: 0, coveragePct: 0,
    },
    method: "seat_rate_run_rate",
  };
  if (!(await tableExists("cost_centre_seat_rate")) || !(await tableExists("cost_centre_master"))) {
    return empty;
  }

  // Rates are resolved as of the last day of the period, so a rate signed mid-month applies to the
  // month it was signed for — the same rule getSeatRevenueActuals uses.
  const [year, month] = period.split("-").map(Number);
  const periodEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);

  // Bound in the order the placeholders appear: classification snapshot, then the two rate-dating
  // bounds, then the optional branch.
  const branchClause = options.branchId ? "AND ccm.branch_id = ?" : "";
  const params: unknown[] = [classificationPeriod ?? period, periodEnd, periodEnd];
  if (options.branchId) params.push(options.branchId);

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ccm.id AS cost_centre_id, ccm.cost_centre_name, bm.branch_name,
            sr.seat_rate_monthly,
            (SELECT e2.process_id FROM employees e2
              WHERE e2.cost_centre_id = ccm.id AND e2.active_status = 1
                AND e2.process_id IS NOT NULL
              GROUP BY e2.process_id ORDER BY COUNT(*) DESC LIMIT 1) AS process_id,
            COUNT(e.id) AS active_headcount,
            SUM(CASE WHEN snap.pnl_bucket = 'agent_salary' THEN 1 ELSE 0 END) AS billable_seats,
            SUM(CASE WHEN snap.employee_id IS NULL THEN 1 ELSE 0 END) AS unclassified
       FROM cost_centre_seat_rate sr
       JOIN cost_centre_master ccm ON ccm.id = sr.cost_centre_id
       LEFT JOIN branch_master bm ON bm.id = ccm.branch_id
       JOIN employees e ON e.cost_centre_id = sr.cost_centre_id AND e.active_status = 1
       LEFT JOIN pnl_running_salary_snapshot snap
              ON snap.employee_id = e.id AND snap.period_code = ?
      WHERE sr.status = 'approved'
        AND sr.billing_model = 'per_seat'
        AND sr.seat_rate_monthly > 0
        AND sr.designation_id IS NULL
        AND sr.effective_from <= ? AND (sr.effective_to IS NULL OR sr.effective_to >= ?)
        AND ${OWN_COMPANY_SQL}
        ${branchClause}
      GROUP BY ccm.id, ccm.cost_centre_name, bm.branch_name, sr.seat_rate_monthly, process_id
      ORDER BY (SUM(CASE WHEN snap.pnl_bucket = 'agent_salary' THEN 1 ELSE 0 END)
                * sr.seat_rate_monthly) DESC`,
    params,
  );

  const costCentres: SeatForecastCostCentre[] = [];
  let projectedMonthEnd = 0;
  let earnedToDate = 0;
  let billableSeats = 0;
  let unclassifiedHeadcount = 0;

  for (const r of rows) {
    const rate = n(r.seat_rate_monthly);
    const seats = n(r.billable_seats);
    const projected = seats * rate;
    const earned = daysInMonth > 0 ? (projected * daysElapsed) / daysInMonth : 0;
    projectedMonthEnd += projected;
    earnedToDate += earned;
    billableSeats += seats;
    unclassifiedHeadcount += n(r.unclassified);
    costCentres.push({
      costCentreId: String(r.cost_centre_id),
      costCentreName: String(r.cost_centre_name ?? "Unnamed cost centre"),
      processId: r.process_id ? String(r.process_id) : null,
      processName: r.process_name ? String(r.process_name) : null,
      branchName: r.branch_name ? String(r.branch_name) : null,
      seatRateMonthly: rate,
      activeHeadcount: n(r.active_headcount),
      billableSeats: seats,
      unclassifiedHeadcount: n(r.unclassified),
      projectedMonthEnd: projected,
      earnedToDate: earned,
    });
  }

  // Aggregate to process for the pre-fill. Cost centres whose staff carry no process are left out
  // of byProcess rather than lumped into a synthetic bucket — the company total above still counts
  // them, so the two figures differ by exactly the unattributed amount, which is the honest result.
  const processMap = new Map<string, SeatForecastProcess>();
  for (const cc of costCentres) {
    if (!cc.processId) continue;
    const existing = processMap.get(cc.processId) ?? {
      processId: cc.processId, processName: cc.processName,
      billableSeats: 0, projectedMonthEnd: 0, earnedToDate: 0,
    };
    existing.billableSeats += cc.billableSeats;
    existing.projectedMonthEnd += cc.projectedMonthEnd;
    existing.earnedToDate += cc.earnedToDate;
    processMap.set(cc.processId, existing);
  }
  const byProcess = [...processMap.values()].sort((a, b) => b.projectedMonthEnd - a.projectedMonthEnd);

  // Coverage is measured against cost centres that actually have staff — an empty cost centre with
  // no rate is not a gap in the forecast, and counting it would understate coverage.
  const [coverageRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS staffed,
            SUM(CASE WHEN EXISTS (
                  SELECT 1 FROM cost_centre_seat_rate sr
                   WHERE sr.cost_centre_id = ccm.id AND sr.status = 'approved'
                     AND sr.billing_model = 'per_seat' AND sr.seat_rate_monthly > 0
                ) THEN 1 ELSE 0 END) AS seat_billed
       FROM cost_centre_master ccm
      WHERE ccm.active_status = 1
        AND ${OWN_COMPANY_SQL}
        AND EXISTS (SELECT 1 FROM employees e
                     WHERE e.cost_centre_id = ccm.id AND e.active_status = 1)`,
  );
  const staffed = n(coverageRows[0]?.staffed);
  const seatBilled = n(coverageRows[0]?.seat_billed);

  return {
    period, asOfDate, daysElapsed, daysInMonth, classificationPeriod,
    costCentres,
    byProcess,
    projectedMonthEnd,
    earnedToDate,
    billableSeats,
    unclassifiedHeadcount,
    coverage: {
      seatBilledCostCentres: seatBilled,
      notSeatBilledCostCentres: Math.max(0, staffed - seatBilled),
      activeCostCentresWithStaff: staffed,
      coveragePct: staffed > 0 ? Number(((seatBilled / staffed) * 100).toFixed(1)) : 0,
    },
    method: "seat_rate_run_rate",
  };
}
