import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute, tableExists, getPnlReconciliation } = vi.hoisted(() => ({
  execute: vi.fn(), tableExists: vi.fn(), getPnlReconciliation: vi.fn(),
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/dbHelpers.js", () => ({ tableExists }));
vi.mock("../pnl-reconciliation.service.js", () => ({ getPnlReconciliation }));

import { getPnlInsights } from "../pnl-insights.service.js";
import { clearTrendCache } from "../pnl-trend-series.service.js";

const L = (x: number) => x * 100000;

interface R { cc: string; branch: string; inv?: number; acc?: number; est?: number; cn?: number; pay?: number; grn?: number; staff?: number }
const row = (r: R) => {
  const rev = (r.inv ?? 0) + (r.acc ?? 0) + (r.est ?? 0) - (r.cn ?? 0);
  return {
    costCentreId: r.cc, costCentreCode: `CC/${r.cc}`, costCentreName: `Name ${r.cc}`,
    costCentreProcess: r.cc === "c" ? null : `Process ${r.cc}`,
    branchId: r.branch, branchName: r.branch.toUpperCase(),
    revenueInvoice: r.inv ?? 0, revenueAccrual: r.acc ?? 0, revenueEstimated: r.est ?? 0, creditNote: r.cn ?? 0,
    recognisedRevenue: rev, payrollCost: r.pay ?? 0, grnActual: r.grn ?? 0, staffPaid: r.staff ?? 0,
    operatingProfit: rev - (r.pay ?? 0) - (r.grn ?? 0),
  };
};
const recOf = (period: string, rows: R[]) => {
  const built = rows.map(row);
  const sum = (k: keyof ReturnType<typeof row>) => built.reduce((t, x) => t + Number(x[k]), 0);
  return {
    period, rows: built,
    totals: { payrollCost: sum("payrollCost"), revenueEstimated: sum("revenueEstimated"), estimatedCostCentres: built.filter((x) => x.revenueEstimated > 0).length },
  };
};

const MONTHS: Record<string, R[]> = {
  "2026-07": [
    { cc: "a", branch: "noida", inv: L(100), pay: L(70), grn: L(10), staff: 200 },
    { cc: "b", branch: "noida", inv: L(20), pay: L(25), grn: L(2), staff: 60 },
  ],
  "2026-08": [
    { cc: "a", branch: "noida", inv: L(90), est: 0, pay: L(70), grn: L(10), staff: 200 },
    { cc: "b", branch: "noida", est: L(22), pay: L(25), grn: L(2), staff: 60 },
    { cc: "c", branch: "ahd", inv: L(30), cn: L(1), acc: L(3), pay: L(20), grn: L(4), staff: 50 },
    { cc: "idle", branch: "ahd" },
  ],
  // Payroll has not run: every margin would read ~90%.
  "2026-09": [
    { cc: "a", branch: "noida", est: L(95) },
    { cc: "b", branch: "noida", est: L(22), grn: L(1) },
  ],
};

beforeEach(() => {
  clearTrendCache();
  vi.clearAllMocks();
  getPnlReconciliation.mockImplementation(async (period: string) => recOf(period, MONTHS[period] ?? []));
});

describe("P&L insights", () => {
  it("heatmap: one cell per month per cost centre, OP% from the Live P&L row, gaps explicit", async () => {
    const out = await getPnlInsights({ period: "2026-08", months: 3, asOfDate: "2026-09-15" });
    expect(out.months.map((m) => m.period)).toEqual(["2026-06", "2026-07", "2026-08"]);
    const a = out.heatmap.find((h) => h.costCentreId === "a")!;
    expect(a.cells.map((c) => c.period)).toEqual(["2026-06", "2026-07", "2026-08"]);
    expect(a.cells[0]).toMatchObject({ revenue: 0, opPct: null });
    expect(a.cells[1].opPct).toBe(20);            // (100-70-10)/100
    expect(a.cells[2].opPct).toBeCloseTo(11.1, 1); // (90-70-10)/90
    expect(out.heatmap.map((h) => h.costCentreId), "sorted by window revenue, idle rows left out").toEqual(["a", "b", "c"]); // b: 20 + 22 = 42 L beats c: 32 L
    const b = out.heatmap.find((h) => h.costCentreId === "b")!;
    expect(b.cells[2].estimated).toBe(true);
    // The process travels with the cost centre into every view; unknown stays null, never guessed.
    expect(b.processName).toBe("Process b");
    expect(out.heatmap.find((h) => h.costCentreId === "c")!.processName).toBeNull();
    expect(out.contribution.find((x) => x.costCentreId === "a")!.processName).toBe("Process a");
    expect(out.unitEconomics.find((x) => x.costCentreId === "a")!.processName).toBe("Process a");
  });

  it("a month with no payroll carries no margin anywhere, and no unit economics", async () => {
    const out = await getPnlInsights({ period: "2026-09", months: 2, asOfDate: "2026-09-15" });
    expect(out.salaryMissing).toBe(true);
    expect(out.months.find((m) => m.period === "2026-09")?.salaryMissing).toBe(true);
    expect(out.heatmap.every((h) => h.cells.find((c) => c.period === "2026-09")?.opPct === null)).toBe(true);
    expect(out.contribution.every((c) => c.opPct === null)).toBe(true);
    expect(out.unitEconomics).toEqual([]);
    expect(out.notes.join(" ")).toMatch(/has not run/);
    // The window figure only counts months that have a cost line.
    const a = out.heatmap.find((h) => h.costCentreId === "a")!;
    expect(a.windowRevenue).toBe(L(90));
  });

  it("contribution: ranked by OP, loss-makers last, equal to the Live P&L row", async () => {
    const out = await getPnlInsights({ period: "2026-08", asOfDate: "2026-09-15" });
    expect(out.contribution.map((c) => c.costCentreId)).toEqual(["a", "c", "b"]); // OP +10, +8, -5 L
    const b = out.contribution.find((c) => c.costCentreId === "b")!;
    expect(b).toMatchObject({ revenue: L(22), payroll: L(25), idc: L(2), op: L(-5), estimated: true });
    expect(out.contribution.some((c) => c.costCentreId === "idle")).toBe(false);
  });

  it("unit economics: full cost per head, only where a cost centre both bills and pays people", async () => {
    const out = await getPnlInsights({ period: "2026-08", asOfDate: "2026-09-15" });
    const c = out.unitEconomics.find((u) => u.costCentreId === "c")!;
    expect(c.revenuePerHead).toBe(L(32) / 50);
    expect(c.costPerHead).toBe(L(24) / 50);
    expect(out.unitEconomics.every((u) => u.staff > 0)).toBe(true);
  });

  it("revenue mix: invoiced + accrual + estimate - credit notes = revenue, per branch and in total", async () => {
    const out = await getPnlInsights({ period: "2026-08", asOfDate: "2026-09-15" });
    const { totals, branches } = out.revenueMix;
    expect(totals.invoiced + totals.accrual + totals.estimated - totals.creditNote).toBeCloseTo(totals.revenue, 2);
    expect(branches.map((b) => b.branchName)).toEqual(["NOIDA", "AHD"]);
    expect(branches[1]).toMatchObject({ invoiced: L(30), accrual: L(3), creditNote: L(1), revenue: L(32) });
  });

  it("holds a branch-scoped caller to their branch and never reads a future month", async () => {
    await getPnlInsights({ period: "2027-01", months: 2, branchScope: "noida", asOfDate: "2026-09-15" });
    const calls = getPnlReconciliation.mock.calls.map((c) => [c[0], c[1].branchIds]);
    expect(calls).toEqual([["2026-08", ["noida"]], ["2026-09", ["noida"]]]);
  });

  it("rejects a malformed period and clamps the window to 2-12 months", async () => {
    await expect(getPnlInsights({ period: "2026-13" })).rejects.toMatchObject({ statusCode: 400 });
    const wide = await getPnlInsights({ period: "2026-08", months: 40, asOfDate: "2026-09-15" });
    expect(wide.months).toHaveLength(12);
    const narrow = await getPnlInsights({ period: "2026-08", months: 1, asOfDate: "2026-09-15" });
    expect(narrow.months).toHaveLength(2);
  });
});

describe("attribution gaps are labelled, not scored", () => {
  it("revenue with no salary booked gets no margin; a cost-only centre counts as no revenue, not as a loser", async () => {
    getPnlReconciliation.mockImplementation(async (period: string) => recOf(period, period === "2026-08" ? [
      { cc: "paid", branch: "noida", inv: L(50), pay: L(40), grn: L(2), staff: 100 },
      { cc: "unpaid", branch: "ahd", inv: L(30), grn: L(1) },
      { cc: "corp", branch: "ho", pay: L(8), grn: L(3), staff: 12 },
    ] : []));
    const out = await getPnlInsights({ period: "2026-08", months: 2, asOfDate: "2026-09-15" });
    const kinds = Object.fromEntries(out.contribution.map((c) => [c.costCentreId, c.kind]));
    expect(kinds).toEqual({ paid: "trading", unpaid: "no_payroll", corp: "no_revenue" });
    expect(out.contribution.find((c) => c.costCentreId === "unpaid")!.opPct).toBeNull();
    const cell = out.heatmap.find((h) => h.costCentreId === "unpaid")!.cells[1];
    expect(cell).toMatchObject({ noPayroll: true, opPct: null, revenue: L(30) });
    // Still ranked by what it bills, not dropped for lacking a margin.
    expect(out.heatmap.map((h) => h.costCentreId).slice(0, 2)).toEqual(["paid", "unpaid"]);
    expect(out.heatmap.find((h) => h.costCentreId === "unpaid")!.windowOpPct).toBeNull();
    expect(out.notes.join(" ")).toMatch(/1 cost centre\(s\) bill Rs 30\.00 L .* no salary booked/);
  });
});

describe("OP% scope rules carried into Insights", () => {
  it("a month with no GRN anywhere has no margin; unmapped payroll is its own bar so bars add to company OP", async () => {
    getPnlReconciliation.mockImplementation(async (period: string) => {
      const rec = recOf(period, MONTHS[period] ?? []);
      if (period === "2026-07") return { ...rec, idcMissing: true };
      if (period === "2026-08") return { ...rec, totals: { ...rec.totals, unallocatedPayroll: L(1.11), unallocatedStaff: 7 } };
      return rec;
    });
    const out = await getPnlInsights({ period: "2026-08", months: 3, asOfDate: "2026-09-15" });
    expect(out.months.find((m) => m.period === "2026-07")).toMatchObject({ idcMissing: true });
    expect(out.heatmap.every((h) => h.cells.find((c) => c.period === "2026-07")!.opPct === null)).toBe(true);
    const bar = out.contribution.find((c) => c.costCentreId === "unallocated-payroll")!;
    expect(bar).toMatchObject({ kind: "no_revenue", op: -111000, payroll: 111000 });
    const rowsOp = MONTHS["2026-08"].reduce((t, r) => t + ((r.inv ?? 0) + (r.acc ?? 0) + (r.est ?? 0) - (r.cn ?? 0) - (r.pay ?? 0) - (r.grn ?? 0)), 0);
    expect(out.contribution.reduce((t, c) => t + c.op, 0)).toBeCloseTo(rowsOp - L(1.11), 2);
    expect(out.notes.join(" ")).toMatch(/no indirect cost maps to any cost centre for Jul-26/i);
    const jul = await getPnlInsights({ period: "2026-07", months: 2, asOfDate: "2026-09-15" });
    expect(jul.salaryMissing).toBe(true);
    expect(jul.unitEconomics).toEqual([]);
    expect(jul.contribution.every((c) => c.opPct === null)).toBe(true);
  });
});
