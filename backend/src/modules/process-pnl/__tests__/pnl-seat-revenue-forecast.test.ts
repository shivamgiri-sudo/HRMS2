import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What the seat forecast is allowed to claim.
 *
 * The forecast's whole safety property is that it is a suggestion which cannot move a reported
 * number. Two things have to hold for that to stay true in practice:
 *
 *   1. It must never overstate its own reach. Only cost centres with an approved per_seat rate can
 *      be projected; the rest bill on outcome or volume, and a seat run-rate invented for them
 *      would read as authoritative. Measured live 2026-09-03, 16 of 28 staffed own-company cost
 *      centres are seat-billed — so a reader shown Rs 2.75 crore without the 57.1% coverage beside
 *      it would take it for the whole business.
 *   2. Staff with no classification row must be excluded and counted, never assumed billable.
 *      62 active staff were in that state on the same date; silently treating them as agents would
 *      have added roughly Rs 20 lakh of revenue nobody is contracted to pay.
 *
 * The month-progress arithmetic is pinned separately because it is the one place an off-by-one
 * turns a forecast into a wrong number rather than a missing one.
 */

const { execute, tableExists } = vi.hoisted(() => ({
  execute: vi.fn(),
  tableExists: vi.fn(),
}));

vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/dbHelpers.js", () => ({ tableExists }));
vi.mock("../pnl-actuals.service.js", () => ({ OWN_COMPANY_SQL: "1=1" }));

import { getSeatRevenueForecast } from "../pnl-seat-revenue-forecast.service.js";

/** One seat-billed cost centre: 10 agents at 30,000, 2 staff not yet classified. */
function fixture() {
  execute.mockImplementation(async (sql: unknown) => {
    const text = String(sql);
    if (text.includes("FROM pnl_running_salary_snapshot")) return [[{ period_code: "2026-08" }], []];
    // Checked before the seat-rate branch: the coverage query mentions cost_centre_seat_rate inside
    // an EXISTS subquery, so a looser match order hands it the per-cost-centre fixture instead.
    if (text.includes("AS staffed")) return [[{ staffed: 4, seat_billed: 1 }], []];
    if (text.includes("FROM cost_centre_seat_rate")) {
      return [[{
        cost_centre_id: "cc-1", cost_centre_name: "Noida OB", branch_name: "NOIDA",
        process_id: "proc-1", process_name: null, seat_rate_monthly: "30000.00",
        active_headcount: 12, billable_seats: 10, unclassified: 2,
      }], []];
    }
    return [[], []];
  });
}

beforeEach(() => {
  execute.mockReset();
  tableExists.mockReset();
  tableExists.mockResolvedValue(true);
  execute.mockResolvedValue([[], []]);
});

describe("projection arithmetic", () => {
  it("projects billable seats at their rate, and earns it pro rata through the month", async () => {
    fixture();
    const result = await getSeatRevenueForecast("2026-09", { asOfDate: "2026-09-03" });

    expect(result.daysInMonth).toBe(30);
    expect(result.daysElapsed).toBe(3);
    // 10 seats x 30,000 = 3,00,000 for the month; 3 of 30 days earned = 30,000.
    expect(result.projectedMonthEnd).toBe(300000);
    expect(result.earnedToDate).toBe(30000);
    expect(result.billableSeats).toBe(10);
  });

  it("treats a month already past as fully earned, and one not yet begun as nothing earned", async () => {
    fixture();
    const past = await getSeatRevenueForecast("2026-08", { asOfDate: "2026-09-03" });
    expect(past.daysElapsed).toBe(past.daysInMonth);
    expect(past.earnedToDate).toBe(past.projectedMonthEnd);

    fixture();
    const future = await getSeatRevenueForecast("2026-11", { asOfDate: "2026-09-03" });
    expect(future.daysElapsed).toBe(0);
    expect(future.earnedToDate).toBe(0);
    // The month-end projection still stands — it is what the month would bill if staffed as today.
    expect(future.projectedMonthEnd).toBe(300000);
  });

  it("never earns more than the month, even if the as-of date runs past its end", async () => {
    fixture();
    const result = await getSeatRevenueForecast("2026-09", { asOfDate: "2026-09-30" });
    expect(result.daysElapsed).toBe(30);
    expect(result.earnedToDate).toBe(result.projectedMonthEnd);
  });
});

describe("honesty about reach", () => {
  it("excludes unclassified staff from seats and reports them separately", async () => {
    fixture();
    const result = await getSeatRevenueForecast("2026-09", { asOfDate: "2026-09-03" });
    // 12 active, 10 billable — the 2 unclassified are not quietly billed.
    expect(result.costCentres[0].activeHeadcount).toBe(12);
    expect(result.billableSeats).toBe(10);
    expect(result.unclassifiedHeadcount).toBe(2);
    expect(result.projectedMonthEnd).toBe(300000);
  });

  it("reports what share of staffed cost centres it can actually speak for", async () => {
    fixture();
    const result = await getSeatRevenueForecast("2026-09", { asOfDate: "2026-09-03" });
    expect(result.coverage).toEqual({
      seatBilledCostCentres: 1,
      notSeatBilledCostCentres: 3,
      activeCostCentresWithStaff: 4,
      coveragePct: 25,
    });
  });

  it("names the period the agent classification came from rather than implying it is current", async () => {
    fixture();
    const result = await getSeatRevenueForecast("2026-09", { asOfDate: "2026-09-03" });
    // September has no snapshot yet; the classification is August's and must say so.
    expect(result.classificationPeriod).toBe("2026-08");
  });

  it("aggregates to process so a process-scoped adjustment is not pre-filled with company totals", async () => {
    fixture();
    const result = await getSeatRevenueForecast("2026-09", { asOfDate: "2026-09-03" });
    expect(result.byProcess).toEqual([
      { processId: "proc-1", processName: null, billableSeats: 10, projectedMonthEnd: 300000, earnedToDate: 30000 },
    ]);
  });
});

describe("degrades safely", () => {
  it("returns an empty forecast, not an error, when seat rates are not configured", async () => {
    tableExists.mockImplementation(async (t: string) => t !== "cost_centre_seat_rate");
    const result = await getSeatRevenueForecast("2026-09", { asOfDate: "2026-09-03" });
    expect(result.projectedMonthEnd).toBe(0);
    expect(result.costCentres).toEqual([]);
    expect(result.coverage.seatBilledCostCentres).toBe(0);
  });

  it("rejects a malformed period", async () => {
    await expect(getSeatRevenueForecast("Sep-2026")).rejects.toThrow(/YYYY-MM/);
  });
});
