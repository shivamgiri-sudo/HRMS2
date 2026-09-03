import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { tableExists } from "../../shared/dbHelpers.js";
import { getSeatRevenueForecast } from "./pnl-seat-revenue-forecast.service.js";

/**
 * Revenue, cost and operating margin day by day through a month.
 *
 * HONESTY IS THE DESIGN CONSTRAINT HERE. Only two of these four series are real daily measurements;
 * the other two are a monthly figure spread across days. A chart that draws all four identically
 * would present a modelled revenue line with the same authority as a bill that was actually raised,
 * so every series carries a `basis` of "actual" or "estimated" and the UI is required to render
 * them differently (solid versus dashed) with the method stated on the chart itself.
 *
 * What each series really is:
 *
 *   - GRN / vendor cost — ACTUAL. grn_request.bill_date is a real date on a real document.
 *     Measured live for 2026-08: 181 committed GRNs worth Rs 60.57 lakh spread over 26 distinct
 *     days, so the line is genuinely lumpy. That lumpiness is the truth and is not smoothed.
 *     NOTE this deliberately reads bill_date, while the monthly P&L books GRN cost by
 *     accounting_period (pinned by grn-accounting-period.regression.test.ts). The two answer
 *     different questions — "when was this billed" versus "which month does it belong to" — so the
 *     daily total for a month can legitimately differ from the statement's figure for that month,
 *     and the UI must say so rather than inviting the reader to reconcile them.
 *
 *   - Headcount — ACTUAL. attendance_daily_record has one row per employee per day and is
 *     populated same-day (31/31 days for 2026-08, 3/3 for 2026-09 as at the 3rd).
 *
 *   - People cost — ESTIMATED, but attendance-shaped rather than flat. Salary is a monthly rate;
 *     there is no per-day payroll figure anywhere and computing one per day via
 *     computeRunningSalary() costs ~1.4s per employee per day, which no chart can pay. So the
 *     month's people cost is distributed across days in proportion to the payable attendance
 *     actually recorded on each day. A day where half the floor was absent therefore costs less
 *     than the day before it, which a straight line could never show — but the underlying rate is
 *     still monthly, so this remains an estimate and is labelled one.
 *
 *   - Revenue — ESTIMATED, straight-line. Seat billing is a monthly rate per seat; no daily
 *     revenue event exists to measure. Deliberately NOT shaped by daily attendance: the client is
 *     billed for contracted seats, not for who happened to badge in, so shaping it that way would
 *     misstate the commercial arrangement while looking more precise.
 */

const n = (v: unknown): number => {
  const p = Number(v ?? 0);
  return Number.isFinite(p) ? p : 0;
};

export type SeriesBasis = "actual" | "estimated";

export interface DailyTrendPoint {
  date: string;
  /** Straight-line share of the month's seat revenue. Estimated. */
  revenue: number;
  /** Real GRN/vendor spend dated to this day. Actual. */
  grnCost: number;
  /** The month's people cost, shaped by the payable attendance recorded on this day. Estimated. */
  peopleCost: number;
  totalCost: number;
  /** Employees with an attendance record on this day. Actual. */
  headcount: number;
  cumulativeRevenue: number;
  cumulativeCost: number;
  /** Operating margin on the cumulative figures. Null until there is revenue to divide by. */
  cumulativeOpPct: number | null;
}

export interface DailyTrendSeriesMeta {
  key: "revenue" | "grnCost" | "peopleCost" | "headcount";
  label: string;
  basis: SeriesBasis;
  /** Stated on the chart, not buried in a tooltip. */
  method: string;
}

export interface DailyTrend {
  period: string;
  branchId: string | null;
  daysInMonth: number;
  /** Days with any real observation yet — the rest of the month is still to come. */
  daysObserved: number;
  points: DailyTrendPoint[];
  series: DailyTrendSeriesMeta[];
  monthlyRevenueBasis: number;
  monthlyPeopleCostBasis: number;
  /** True when GRN cost here cannot be reconciled to the statement, which is the normal case. */
  grnCostDatedByBillDate: true;
}

const SERIES: DailyTrendSeriesMeta[] = [
  {
    key: "revenue", label: "Revenue", basis: "estimated",
    method: "Month's seat revenue spread evenly across days — seat billing is a monthly rate, so no daily revenue event exists to measure.",
  },
  {
    key: "grnCost", label: "GRN / vendor cost", basis: "actual",
    method: "Real spend, dated by the supplier's bill date. Differs from the monthly statement, which books cost by accounting period.",
  },
  {
    key: "peopleCost", label: "People cost", basis: "estimated",
    method: "Month's people cost distributed by the payable attendance actually recorded each day. The rate is monthly, so this is a shape, not a measurement.",
  },
  {
    key: "headcount", label: "Headcount present", basis: "actual",
    method: "Employees with an attendance record that day.",
  },
];

/**
 * How much of a day's attendance is payable.
 *
 * Mirrors the treatment payroll already applies rather than inventing a second rule:
 * missing_punch pays zero (an unresolved punch is unpaid until corrected, a standing decision),
 * absent pays zero, half_day pays half, and week-offs/holidays/approved leave are paid days.
 */
const PAYABLE_WEIGHT_SQL = `
  CASE a.attendance_status
    WHEN 'present' THEN 1
    WHEN 'half_day' THEN 0.5
    WHEN 'week_off' THEN 1
    WHEN 'week_off_worked' THEN 1
    WHEN 'holiday' THEN 1
    WHEN 'leave_approved' THEN 1
    ELSE 0
  END`;

function dateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The month's people cost: posted payroll when it exists, otherwise the running snapshot. */
async function monthlyPeopleCost(period: string, branchId?: string): Promise<number> {
  const branchSql = branchId ? "AND e.branch_id = ?" : "";
  const params = branchId ? [period, branchId] : [period];
  if (await tableExists("salary_prep_line")) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT SUM(COALESCE(l.gross_salary,0)+COALESCE(l.pf_employer,0)
                 +COALESCE(l.esic_employer,0)+COALESCE(l.gratuity,0)) AS amount
         FROM salary_prep_line l
         JOIN salary_prep_run r ON r.id = l.run_id AND r.run_month = ?
         JOIN employees e ON e.id = l.employee_id
        WHERE 1=1 ${branchSql}`,
      params,
    );
    const posted = n(rows[0]?.amount);
    if (posted > 0) return posted;
  }
  if (await tableExists("pnl_running_salary_snapshot")) {
    const snapBranch = branchId ? "AND s.branch_id = ?" : "";
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT SUM(COALESCE(s.earned_salary_till_date,0)) AS amount
         FROM pnl_running_salary_snapshot s
        WHERE s.period_code = ? ${snapBranch}`,
      branchId ? [period, branchId] : [period],
    );
    return n(rows[0]?.amount);
  }
  return 0;
}

export async function getDailyTrend(
  period: string,
  options: { branchId?: string } = {},
): Promise<DailyTrend> {
  if (!/^\d{4}-\d{2}$/.test(period)) {
    throw Object.assign(new Error("period must be YYYY-MM"), { statusCode: 400 });
  }
  const [year, month] = period.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthStart = `${period}-01`;
  const nextMonth = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);

  const [forecast, peopleCostTotal] = await Promise.all([
    getSeatRevenueForecast(period, options.branchId ? { branchId: options.branchId } : {}),
    monthlyPeopleCost(period, options.branchId),
  ]);
  const monthlyRevenue = forecast.projectedMonthEnd;

  // GRN spend by bill date.
  const grnByDay = new Map<string, number>();
  if (await tableExists("grn_request")) {
    const branchSql = options.branchId ? "AND g.branch_id = ?" : "";
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(g.bill_date, '%Y-%m-%d') AS d,
              SUM(COALESCE(g.pnl_cost_amount, g.amount_with_tax)) AS amount
         FROM grn_request g
        WHERE g.status NOT IN ('draft','rejected','cancelled')
          AND g.bill_date >= ? AND g.bill_date < ?
          ${branchSql}
        GROUP BY d`,
      options.branchId ? [monthStart, nextMonth, options.branchId] : [monthStart, nextMonth],
    );
    for (const r of rows) grnByDay.set(String(r.d), n(r.amount));
  }

  // Attendance: headcount present, and the payable weight that shapes the people-cost curve.
  const attendanceByDay = new Map<string, { headcount: number; payable: number }>();
  let totalPayable = 0;
  if (await tableExists("attendance_daily_record")) {
    const branchSql = options.branchId ? "AND a.branch_id = ?" : "";
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(a.record_date, '%Y-%m-%d') AS d,
              COUNT(DISTINCT a.employee_id) AS headcount,
              SUM(${PAYABLE_WEIGHT_SQL}) AS payable
         FROM attendance_daily_record a
        WHERE a.record_date >= ? AND a.record_date < ?
          ${branchSql}
        GROUP BY d`,
      options.branchId ? [monthStart, nextMonth, options.branchId] : [monthStart, nextMonth],
    );
    for (const r of rows) {
      const payable = n(r.payable);
      attendanceByDay.set(String(r.d), { headcount: n(r.headcount), payable });
      totalPayable += payable;
    }
  }

  const points: DailyTrendPoint[] = [];
  let cumulativeRevenue = 0;
  let cumulativeCost = 0;

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = dateKey(year, month, day);
    const attendance = attendanceByDay.get(date);
    const grnCost = grnByDay.get(date) ?? 0;

    // Revenue: straight line. People cost: shaped by that day's payable attendance, falling back to
    // a straight line only if no attendance was recorded for the month at all.
    const revenue = daysInMonth > 0 ? monthlyRevenue / daysInMonth : 0;
    const peopleCost = totalPayable > 0
      ? (peopleCostTotal * (attendance?.payable ?? 0)) / totalPayable
      : (daysInMonth > 0 ? peopleCostTotal / daysInMonth : 0);

    const totalCost = grnCost + peopleCost;
    cumulativeRevenue += revenue;
    cumulativeCost += totalCost;

    points.push({
      date,
      revenue,
      grnCost,
      peopleCost,
      totalCost,
      headcount: attendance?.headcount ?? 0,
      cumulativeRevenue,
      cumulativeCost,
      cumulativeOpPct: cumulativeRevenue > 0
        ? Number((((cumulativeRevenue - cumulativeCost) / cumulativeRevenue) * 100).toFixed(2))
        : null,
    });
  }

  return {
    period,
    branchId: options.branchId ?? null,
    daysInMonth,
    daysObserved: attendanceByDay.size,
    points,
    series: SERIES,
    monthlyRevenueBasis: monthlyRevenue,
    monthlyPeopleCostBasis: peopleCostTotal,
    grnCostDatedByBillDate: true,
  };
}
