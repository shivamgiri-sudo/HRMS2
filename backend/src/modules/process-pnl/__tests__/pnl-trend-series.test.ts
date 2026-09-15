import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute, tableExists, getPnlReconciliation } = vi.hoisted(() => ({
  execute: vi.fn(), tableExists: vi.fn(), getPnlReconciliation: vi.fn(),
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/dbHelpers.js", () => ({ tableExists }));
vi.mock("../pnl-reconciliation.service.js", () => ({ getPnlReconciliation }));

import { clearTrendCache, distribute, getPnlTrendSeries, weekStart } from "../pnl-trend-series.service.js";

const L = (x: number) => x * 100000;

/** Company-level Live P&L per month; September has no people cost yet. */
function rec(period: string) {
  const byMonth: Record<string, { rev: number; est: number; pay: number; grn: number }> = {
    "2026-06": { rev: L(250), est: 0, pay: L(200), grn: L(40) },
    "2026-07": { rev: L(280), est: 0, pay: L(198), grn: L(42) },
    "2026-08": { rev: L(274), est: L(10), pay: L(196), grn: L(43) },
    "2026-09": { rev: L(123), est: L(123), pay: 0, grn: L(1.4) },
  };
  const m = byMonth[period] ?? { rev: 0, est: 0, pay: 0, grn: 0 };
  return {
    period, company: "MAS Callnet India Pvt Ltd",
    totals: { revenue: m.rev, revenueEstimated: m.est, payrollCost: m.pay, grnActual: m.grn },
    branches: [{ branchId: "b-noida", branchName: "NOIDA" }],
    rows: [
      { costCentreId: "cc-1", costCentreCode: "BSS/IB/Noida/647", costCentreName: "IDAM", branchId: "b-noida", branchName: "NOIDA",
        recognisedRevenue: m.rev / 2, revenueEstimated: m.est / 2, payrollCost: m.pay / 2, grnActual: m.grn / 2 },
    ],
  };
}

beforeEach(() => {
  clearTrendCache();
  vi.clearAllMocks();
  tableExists.mockResolvedValue(true);
  getPnlReconciliation.mockImplementation(async (period: string) => rec(period));
  // Attendance: weekdays weigh 100, Sundays 20. GRN: all on the 5th.
  execute.mockImplementation(async (sql: string, params: unknown[]) => {
    const from = String(params.find((p) => /^\d{4}-\d{2}-01$/.test(String(p))) ?? "");
    const period = from.slice(0, 7);
    if (!period) return [[], []];
    const days = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).getUTCDate();
    if (String(sql).includes("attendance_daily_record")) {
      return [Array.from({ length: days }, (_, i) => {
        const d = `${period}-${String(i + 1).padStart(2, "0")}`;
        return { d, w: new Date(`${d}T00:00:00Z`).getUTCDay() === 0 ? 20 : 100 };
      }), []];
    }
    if (String(sql).includes("grn_request")) return [[{ d: `${period}-05`, w: 1000 }], []];
    return [[], []];
  });
});

describe("helpers", () => {
  it("spreads a total by weights, evenly when there are none, and always sums back", () => {
    const days = ["a", "b", "c", "d"];
    const byW = distribute(100, days, new Map([["a", 1], ["b", 3]]));
    expect([...byW.values()]).toEqual([25, 75, 0, 0]);
    const even = distribute(100, days, new Map());
    expect([...even.values()].reduce((t, v) => t + v, 0)).toBeCloseTo(100, 9);
  });

  it("finds the Monday of the week", () => {
    expect(weekStart("2026-09-15")).toBe("2026-09-14"); // Tuesday -> Monday
    expect(weekStart("2026-09-14")).toBe("2026-09-14");
    expect(weekStart("2026-09-20")).toBe("2026-09-14"); // Sunday belongs to the week before
  });
});

describe("getPnlTrendSeries", () => {
  it("monthly points are the Live P&L totals, and a month with no salary has no OP%", async () => {
    const out = await getPnlTrendSeries({ grain: "month", scopeType: "company", anchor: "2026-09", count: 4, asOfDate: "2026-09-15" });
    expect(out.points.map((p) => p.key)).toEqual(["2026-06", "2026-07", "2026-08", "2026-09"]);
    const jul = out.points[1];
    expect(jul.revenue).toBe(L(280));
    expect(jul.op).toBe(L(280) - L(198) - L(42));
    expect(jul.opPct).toBeCloseTo(((L(280) - L(240)) / L(280)) * 100, 2);
    const sep = out.points[3];
    expect(sep.salaryMissing).toBe(true);
    expect(sep.opPct).toBeNull();
    expect(sep.revenueEstimated).toBe(L(123));
    expect(sep.isPartial).toBe(true);
    expect(out.totals.salary).toBeNull(); // not every month has salary
  });

  it("daily points for a closed month add back to the month exactly, salary shaped by attendance", async () => {
    const out = await getPnlTrendSeries({ grain: "day", scopeType: "company", anchor: "2026-08", asOfDate: "2026-09-15" });
    expect(out.points).toHaveLength(31);
    expect(out.totals.revenue).toBeCloseTo(L(274), 0);
    expect(out.totals.salary).toBeCloseTo(L(196), 0);
    expect(out.totals.idc).toBeCloseTo(L(43), 0);
    const sunday = out.points.find((p) => p.key === "2026-08-02")!; // a Sunday
    const monday = out.points.find((p) => p.key === "2026-08-03")!;
    expect(monday.salary!).toBeGreaterThan(sunday.salary!);
    expect(out.points.find((p) => p.key === "2026-08-05")!.idc).toBeCloseTo(L(43), 0); // GRN on its bill date
  });

  it("the open month stops at today", async () => {
    const out = await getPnlTrendSeries({ grain: "day", scopeType: "company", anchor: "2026-09", asOfDate: "2026-09-15" });
    expect(out.points).toHaveLength(15);
    expect(out.points.every((p) => p.salaryMissing && p.opPct === null)).toBe(true);
  });

  it("weekly points are Monday-Sunday buckets of the same daily spread", async () => {
    const out = await getPnlTrendSeries({ grain: "week", scopeType: "company", anchor: "2026-08", count: 6, asOfDate: "2026-09-15" });
    expect(out.points.every((p) => weekStart(p.start) === p.start)).toBe(true);
    const last = out.points[out.points.length - 1];
    expect(last.end >= "2026-08-31").toBe(true);
    // The week of 27 Jul straddles Jul/Aug and draws from both months' totals.
    const straddle = out.points.find((p) => p.start === "2026-07-27")!;
    expect(straddle.revenue).toBeCloseTo((L(280) / 31) * 5 + (L(274) / 31) * 2, 0);
  });

  it("cost centre scope uses that row and its branch", async () => {
    const out = await getPnlTrendSeries({ grain: "month", scopeType: "cost_centre", scopeId: "cc-1", costCentreBranchId: "b-noida", anchor: "2026-08", count: 2, asOfDate: "2026-09-15" });
    expect(out.points[1].revenue).toBe(L(137));
    expect(out.scope.label).toContain("BSS/IB/Noida/647");
    expect(getPnlReconciliation).toHaveBeenCalledWith("2026-08", expect.objectContaining({ branchIds: ["b-noida"] }));
  });

  it("rejects bad input", async () => {
    await expect(getPnlTrendSeries({ grain: "year", scopeType: "company", anchor: "2026-08" })).rejects.toMatchObject({ statusCode: 400 });
    await expect(getPnlTrendSeries({ grain: "month", scopeType: "branch", anchor: "2026-08" })).rejects.toMatchObject({ statusCode: 400 });
    await expect(getPnlTrendSeries({ grain: "month", scopeType: "company", anchor: "2026-13" })).rejects.toMatchObject({ statusCode: 400 });
  });
});
