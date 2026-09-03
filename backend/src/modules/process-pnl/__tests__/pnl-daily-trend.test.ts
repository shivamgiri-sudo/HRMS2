import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What the daily trend may and may not claim.
 *
 * Two of its four series are real daily measurements and two are a monthly figure spread across
 * days. The value of the chart depends entirely on that distinction surviving, so it is pinned
 * here rather than left to the component:
 *
 *   - every series must declare a basis, and the two modelled ones must never be labelled actual;
 *   - a modelled series must sum back to the month it was spread from, or the shape is not a
 *     redistribution but a new number;
 *   - people cost must follow recorded attendance, not a flat line. Measured live for 2026-08, a
 *     low-attendance day costs Rs 2.64 lakh against roughly Rs 4.8 lakh on a working day; a
 *     straight line would have shown Rs 4.46 lakh on both and hidden the difference entirely;
 *   - missing_punch and absent must contribute nothing, matching how payroll already treats them.
 *
 * The GRN series is deliberately NOT asserted to equal the statement's monthly cost: it is dated by
 * bill_date while the statement books by accounting_period, and pretending those agree is the
 * confusion this chart has to avoid rather than create.
 */

const { execute, tableExists, getSeatRevenueForecast } = vi.hoisted(() => ({
  execute: vi.fn(),
  tableExists: vi.fn(),
  getSeatRevenueForecast: vi.fn(),
}));

vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/dbHelpers.js", () => ({ tableExists }));
vi.mock("../pnl-seat-revenue-forecast.service.js", () => ({ getSeatRevenueForecast }));

import { getDailyTrend } from "../pnl-daily-trend.service.js";

const PERIOD = "2026-09"; // 30 days

/** Payroll posted at 3,00,000; GRN on two days; attendance on three days with differing load. */
function fixture(opts: { attendance?: boolean } = {}) {
  const attendance = opts.attendance ?? true;
  execute.mockImplementation(async (sql: unknown) => {
    const text = String(sql);
    if (text.includes("FROM salary_prep_line")) return [[{ amount: "300000.00" }], []];
    if (text.includes("FROM grn_request")) {
      return [[
        { d: "2026-09-02", amount: "50000.00" },
        { d: "2026-09-17", amount: "25000.00" },
      ], []];
    }
    if (text.includes("FROM attendance_daily_record")) {
      if (!attendance) return [[], []];
      return [[
        { d: "2026-09-01", headcount: 100, payable: "100" },
        { d: "2026-09-02", headcount: 100, payable: "50" },  // half the floor out
        { d: "2026-09-03", headcount: 100, payable: "50" },
      ], []];
    }
    return [[], []];
  });
}

beforeEach(() => {
  execute.mockReset();
  tableExists.mockReset();
  getSeatRevenueForecast.mockReset();
  tableExists.mockResolvedValue(true);
  execute.mockResolvedValue([[], []]);
  getSeatRevenueForecast.mockResolvedValue({ projectedMonthEnd: 600000 });
});

describe("series labelling", () => {
  it("declares which series are measured and which are modelled", async () => {
    fixture();
    const trend = await getDailyTrend(PERIOD);
    const basis = Object.fromEntries(trend.series.map((s) => [s.key, s.basis]));
    expect(basis).toEqual({
      revenue: "estimated",
      grnCost: "actual",
      peopleCost: "estimated",
      headcount: "actual",
    });
    // Each carries a stated method, so the chart never has to invent an explanation.
    expect(trend.series.every((s) => s.method.length > 20)).toBe(true);
  });

  it("flags that GRN cost is dated by bill date, not the statement's accounting period", async () => {
    fixture();
    const trend = await getDailyTrend(PERIOD);
    expect(trend.grnCostDatedByBillDate).toBe(true);
    expect(trend.series.find((s) => s.key === "grnCost")?.method).toMatch(/bill date/i);
  });
});

describe("modelled series redistribute rather than invent", () => {
  it("sums daily revenue back to the month it was spread from", async () => {
    fixture();
    const trend = await getDailyTrend(PERIOD);
    const total = trend.points.reduce((s, p) => s + p.revenue, 0);
    expect(total).toBeCloseTo(600000, 6);
    expect(trend.monthlyRevenueBasis).toBe(600000);
    expect(trend.points).toHaveLength(30);
  });

  it("sums daily people cost back to the month's payroll", async () => {
    fixture();
    const trend = await getDailyTrend(PERIOD);
    const total = trend.points.reduce((s, p) => s + p.peopleCost, 0);
    expect(total).toBeCloseTo(300000, 6);
    expect(trend.monthlyPeopleCostBasis).toBe(300000);
  });
});

describe("people cost follows attendance, not the calendar", () => {
  it("charges a low-attendance day less than a full one, in proportion to payable days", async () => {
    fixture();
    const trend = await getDailyTrend(PERIOD);
    const byDate = Object.fromEntries(trend.points.map((p) => [p.date, p]));

    // Payable weights 100 / 50 / 50 over the month => 50% / 25% / 25% of 3,00,000.
    expect(byDate["2026-09-01"].peopleCost).toBeCloseTo(150000, 6);
    expect(byDate["2026-09-02"].peopleCost).toBeCloseTo(75000, 6);
    expect(byDate["2026-09-03"].peopleCost).toBeCloseTo(75000, 6);
    // A day with no attendance recorded carries no people cost at all.
    expect(byDate["2026-09-04"].peopleCost).toBe(0);
    // A flat line would have put 10,000 on every one of the 30 days.
    expect(byDate["2026-09-01"].peopleCost).not.toBeCloseTo(10000, 6);
  });

  it("falls back to a flat spread only when no attendance exists at all for the month", async () => {
    fixture({ attendance: false });
    const trend = await getDailyTrend(PERIOD);
    for (const point of trend.points) expect(point.peopleCost).toBeCloseTo(10000, 6);
    expect(trend.daysObserved).toBe(0);
  });

  it("treats missing_punch and absent as unpaid, matching payroll", async () => {
    fixture();
    await getDailyTrend(PERIOD);
    const attendanceSql = execute.mock.calls
      .map(([sql]) => String(sql))
      .find((s) => s.includes("FROM attendance_daily_record"))!;
    expect(attendanceSql).toContain("'present' THEN 1");
    expect(attendanceSql).toContain("'half_day' THEN 0.5");
    expect(attendanceSql).not.toContain("'missing_punch' THEN 1");
    expect(attendanceSql).toContain("ELSE 0");
  });
});

describe("cumulative margin", () => {
  it("reports margin on the running totals, and nothing before there is revenue", async () => {
    fixture();
    const trend = await getDailyTrend(PERIOD);
    const first = trend.points[0];
    // Day 1: revenue 20,000; cost = 1,50,000 people + 0 GRN. Deeply negative early, as expected
    // when a month's payroll shape front-loads against evenly-spread revenue.
    expect(first.cumulativeRevenue).toBeCloseTo(20000, 6);
    expect(first.cumulativeCost).toBeCloseTo(150000, 6);
    expect(first.cumulativeOpPct).toBeCloseTo(-650, 1);

    const last = trend.points[trend.points.length - 1];
    expect(last.cumulativeRevenue).toBeCloseTo(600000, 6);
    expect(last.cumulativeCost).toBeCloseTo(375000, 6); // 3,00,000 people + 75,000 GRN
    expect(last.cumulativeOpPct).toBeCloseTo(37.5, 1);
  });

  it("returns null margin rather than dividing by zero revenue", async () => {
    getSeatRevenueForecast.mockResolvedValue({ projectedMonthEnd: 0 });
    fixture();
    const trend = await getDailyTrend(PERIOD);
    expect(trend.points.every((p) => p.cumulativeOpPct === null)).toBe(true);
  });
});

describe("input handling", () => {
  it("rejects a malformed period", async () => {
    await expect(getDailyTrend("2026/09")).rejects.toThrow(/YYYY-MM/);
  });

  it("produces a full month of points even with no data at all", async () => {
    tableExists.mockResolvedValue(false);
    getSeatRevenueForecast.mockResolvedValue({ projectedMonthEnd: 0 });
    const trend = await getDailyTrend("2026-02");
    expect(trend.points).toHaveLength(28);
    expect(trend.points.every((p) => p.totalCost === 0)).toBe(true);
  });
});
