import { describe, expect, it } from "vitest";
import {
  buildLiveBasis,
  buildProcessBasis,
  buildStatementBasis,
  type HeaderKpiBasis,
} from "@/components/finance/pnl/headerKpiBasis";
import type { PnlLiveReconciliation } from "@/hooks/usePnlLiveReconciliation";
import type { BpoPnlSummary } from "@/hooks/useBpoProcessPnl";

const addsUp = (b: HeaderKpiBasis) =>
  b.revenue - b.costLines.reduce((total, line) => total + line.value, 0) - b.operatingProfit;

function liveTotals(overrides: Partial<PnlLiveReconciliation["totals"]> = {}): PnlLiveReconciliation["totals"] {
  return {
    activeCostCentres: 10, revenue: 1_000_000, revenueInvoice: 900_000, revenueAccrual: 0, creditNote: 0,
    revenueEstimated: 100_000, estimatedCostCentres: 2, perDayRevenue: 30_000,
    grnActual: 100_000, grnEstimated: 50_000, allocatedBudget: 0, branchBudget: 0,
    payrollCost: 600_000, staffPaid: 400, operatingProfit: 250_000, marginPct: 25,
    ...overrides,
  };
}

describe("header KPI basis (audit item 7)", () => {
  it("Live basis shows GRN committed as its own line, and the lines add up to Live OP", () => {
    const b = buildLiveBasis(liveTotals());
    expect(b.source).toBe("live");
    expect(b.costLines.map((l) => l.key)).toEqual(["people", "grnConsumed", "grnCommitted"]);
    expect(b.costLines.find((l) => l.key === "grnCommitted")?.value).toBe(50_000);
    expect(b.operatingProfit).toBe(250_000);
    expect(addsUp(b)).toBe(0);
    expect(b.peopleSplit).toBeNull();
  });

  it("Live basis keeps a zero GRN committed line visible and flags missing people cost", () => {
    const b = buildLiveBasis(liveTotals({ grnEstimated: 0, payrollCost: 0, operatingProfit: 900_000, marginPct: null }));
    expect(b.costLines.find((l) => l.key === "grnCommitted")?.value).toBe(0);
    expect(b.peopleCostMissing).toBe(true);
    expect(b.marginPct).toBeNull();
    expect(addsUp(b)).toBe(0);
  });

  it("Statement basis derives People Cost as Total Cost − Indirect so the tiles add up", () => {
    const values: Record<string, number> = {
      recognized_revenue: 1_000_000, agent_salary: 400_000, total_dsc: 120_000, total_bmc: 80_000,
      total_idc: 150_000, total_cost: 750_000,
    };
    const b = buildStatementBasis((key) => (key in values ? values[key] : null));
    expect(b.costLines).toEqual([
      { key: "people", value: 600_000 },
      { key: "indirect", value: 150_000 },
    ]);
    expect(b.operatingProfit).toBe(250_000);
    expect(b.marginPct).toBe(25);
    expect(addsUp(b)).toBe(0);
    expect(b.peopleSplit).toEqual({ agentSalary: 400_000, dsc: 120_000, bmc: 80_000 });
  });

  // Owner rule 2026-09-24: Revenue − People − GRN Consumed − GRN Committed = Operating Profit on
  // EVERY basis. Fixture: consumed 100, reserved 40.
  it("Statement basis splits Indirect Cost into GRN Consumed + GRN Committed and still adds up", () => {
    const values: Record<string, number> = {
      recognized_revenue: 1000, agent_salary: 500, total_idc: 140, grn_consumed: 100, grn_committed: 40,
      total_cost: 640,
    };
    const b = buildStatementBasis((key) => (key in values ? values[key] : null));
    expect(b.costLines).toEqual([
      { key: "people", value: 500 },
      { key: "grnConsumed", value: 100 },
      { key: "grnCommitted", value: 40 },
    ]);
    expect(b.operatingProfit).toBe(360);
    expect(addsUp(b)).toBe(0);
  });

  it("process basis splits grnVendorActual into GRN Consumed + GRN Committed and still adds up", () => {
    const kpis = {
      recognizedRevenue: 1000, totalPeopleCost: 500, grnVendorActual: 140, grnCommitted: 40, operatingProfit: 360,
      agentSalary: 500, dsc: 0, bmc: 0,
    } as unknown as BpoPnlSummary["kpis"];
    const b = buildProcessBasis(kpis);
    expect(b.costLines).toEqual([
      { key: "people", value: 500 },
      { key: "grnConsumed", value: 100 },
      { key: "grnCommitted", value: 40 },
    ]);
    expect(addsUp(b)).toBe(0);
  });

  it("Live basis: consumed 100 + committed 40 for a closed month add up to OP", () => {
    const b = buildLiveBasis(liveTotals({ revenue: 1000, payrollCost: 500, grnActual: 100, grnEstimated: 40, operatingProfit: 360 }));
    expect(b.costLines.map((l) => [l.key, l.value])).toEqual([["people", 500], ["grnConsumed", 100], ["grnCommitted", 40]]);
    expect(addsUp(b)).toBe(0);
  });

  it("process basis surfaces an engine residual instead of hiding it", () => {
    const kpis = {
      recognizedRevenue: 1_000_000, totalPeopleCost: 600_000, grnVendorActual: 100_000, operatingProfit: 200_000,
      agentSalary: 400_000, dsc: 120_000, bmc: 80_000,
    } as unknown as BpoPnlSummary["kpis"];
    const b = buildProcessBasis(kpis);
    expect(b.costLines.find((l) => l.key === "other")?.value).toBe(100_000);
    expect(addsUp(b)).toBe(0);
    expect(b.marginPct).toBe(20);
  });

  it("process basis adds no residual line when the engine is already additive", () => {
    const kpis = {
      recognizedRevenue: 1_000_000, totalPeopleCost: 600_000, grnVendorActual: 100_000, operatingProfit: 300_000,
      agentSalary: 0, dsc: 0, bmc: 0,
    } as unknown as BpoPnlSummary["kpis"];
    expect(buildProcessBasis(kpis).costLines.map((l) => l.key)).toEqual(["people", "indirect"]);
  });
});
