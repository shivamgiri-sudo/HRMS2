import { describe, expect, it } from "vitest";

import type { BpoPnlRow } from "@/hooks/useBpoProcessPnl";
import {
  filterMatrixRows,
  getDefaultSort,
  getIssueCounts,
  getPresetColumns,
  sortMatrixRows,
  type ProcessPnlViewState,
} from "@/components/finance/pnl/processPnlMatrixConfig";

const baseRow: BpoPnlRow = {
  processId: "p-1",
  processName: "Claims Operations",
  clientId: "client-1",
  clientName: "Acme Health",
  branchId: "branch-1",
  branchName: "Bengaluru",
  costCentreId: "cc-1",
  costCentreCode: "CC-001",
  billingModels: ["per_unit"],
  primaryBillingModel: "per_unit",
  revenueDataStatus: "configured",
  mandatedSeats: 20,
  contractedSeats: 20,
  requiredProductiveHc: 18,
  requiredRosterHc: 20,
  activeHc: 19,
  agentHeadcount: 18,
  supportHeadcount: 1,
  billableHc: 18,
  seatFillPct: 95,
  billableSeatUtilizationPct: 90,
  plannedDeliveryUnits: 1000,
  deliveredUnits: 980,
  acceptedUnits: 970,
  rejectedUnits: 10,
  billableUnits: 970,
  productiveHours: 100,
  loginHours: 110,
  talkMinutes: 4000,
  qualityScore: 95,
  slaScore: 98,
  deliveryAttainmentPct: 98,
  acceptancePct: 99,
  grossPotentialRevenue: 100000,
  baseEarnedRevenue: 90000,
  minimumCommitmentTopUp: 0,
  incentiveRevenue: 5000,
  rewardRevenue: 0,
  trainingRevenue: 0,
  otherRevenueIncrease: 0,
  penalty: 0,
  slaDeduction: 0,
  creditNote: 0,
  otherRevenueDecrease: 0,
  earnedRevenue: 95000,
  recognizedRevenue: 95000,
  invoicedRevenue: 90000,
  collectedRevenue: 85000,
  outstandingReceivable: 5000,
  unbilledRevenue: 0,
  deferredRevenue: 0,
  revenueLeakage: 0,
  revenueAtRisk: 1000,
  revenueBudget: 100000,
  revenueVariance: -5000,
  agentSalary: 40000,
  averageAgentSalary: 2222,
  agentSalaryPctRevenue: 42,
  dscPeople: 5000,
  dscNonPeople: 1000,
  dsc: 6000,
  dscPctRevenue: 6,
  bmcPeople: 4000,
  bmcNonPeople: 1000,
  bmc: 5000,
  bmcPctRevenue: 5,
  grnVendorActual: 2000,
  totalPeopleCost: 49000,
  peopleCostPctRevenue: 52,
  contribution: 44000,
  contributionMarginPct: 46,
  ebitda: 30000,
  ebitdaMarginPct: 32,
  depreciation: 1000,
  amortization: 0,
  ebit: 29000,
  operatingProfit: 29000,
  operatingProfitPct: 31,
  financeCost: 500,
  pbt: 28500,
  tax: 7000,
  pat: 21500,
  totalOperatingCost: 65000,
  totalCostPctRevenue: 68,
  revenuePerAgent: 5278,
  revenuePerActiveEmployee: 5000,
  revenuePerContractedSeat: 4750,
  loadedCostPerBillableSeat: 3611,
  approvedBudget: 100000,
  reservedBudget: 10000,
  consumedBudget: 80000,
  availableBudget: 10000,
  budgetUtilizationPct: 80,
  ebitdaBudget: 28000,
  ebitdaVariance: 2000,
  processStatus: "profitable",
  freshness: "2026-07-28T00:00:00.000Z",
};

const row2: BpoPnlRow = {
  ...baseRow,
  processId: "p-2",
  processName: "Customer Support",
  clientName: "Beta Retail",
  branchName: "Pune",
  costCentreCode: "CC-002",
  revenueDataStatus: "configured_no_delivery",
  revenueAtRisk: 0,
  outstandingReceivable: 0,
  budgetUtilizationPct: 125,
  ebitda: -10000,
  processStatus: "loss-making",
};

const accountingFallbackRow: BpoPnlRow = {
  ...baseRow,
  processId: "p-3",
  revenueDataStatus: "accounting_fallback",
  outstandingReceivable: 0,
  revenueAtRisk: 0,
};

const state: ProcessPnlViewState = {
  preset: "summary",
  status: "all",
  issue: "all",
  density: "comfortable",
  sortKey: "processName",
  sortDirection: "asc",
  search: "",
};

const formatCompactCurrency = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);

describe("process P&L matrix config", () => {
  it("returns the exact summary column order", () => {
    expect(getPresetColumns("summary").map((column) => column.key)).toEqual([
      "processName",
      "clientName",
      "branchName",
      "processStatus",
      "recognizedRevenue",
      "agentSalaryPctRevenue",
      "dscPctRevenue",
      "bmcPctRevenue",
      "ebitda",
      "ebitdaMarginPct",
      "budgetUtilizationPct",
      "revenueAtRisk",
      "revenueDataStatus",
    ]);
  });

  it("filters by status, issue, and search", () => {
    const filtered = filterMatrixRows([baseRow, row2], {
      ...state,
      status: "loss-making",
      issue: "delivery-missing",
      search: "Pune",
    });

    expect(filtered).toEqual([row2]);
  });

  it("defaults summary sorting to negative EBITDA first", () => {
    expect(getDefaultSort("summary")).toEqual({ sortKey: "ebitda", sortDirection: "asc" });
    expect(sortMatrixRows([baseRow, row2], { ...state, ...getDefaultSort("summary") })).toEqual([
      row2,
      baseRow,
    ]);
  });

  it("counts budget and delivery issues", () => {
    expect(getIssueCounts([baseRow, row2])).toMatchObject({
      "budget-exceeded": 1,
      "delivery-missing": 1,
    });
  });

  it("uses outstanding receivable for high-receivable filtering", () => {
    expect(
      filterMatrixRows([baseRow, row2], { ...state, issue: "high-receivable" }),
    ).toEqual([baseRow]);
  });

  it("filters and counts accounting-fallback rows", () => {
    expect(
      filterMatrixRows([baseRow, accountingFallbackRow], {
        ...state,
        issue: "accounting-fallback",
      }),
    ).toEqual([accountingFallbackRow]);
    expect(getIssueCounts([baseRow, accountingFallbackRow])["accounting-fallback"]).toBe(1);
  });

  it("only exposes meaningful totals and uses weighted percentage totals", () => {
    const summary = getPresetColumns("summary");
    const totalFor = (key: (typeof summary)[number]["key"]) =>
      summary.find((column) => column.key === key)?.total;

    expect(totalFor("processName")).toBeUndefined();
    expect(totalFor("processStatus")).toBeUndefined();
    expect(totalFor("revenueDataStatus")).toBeUndefined();
    expect(totalFor("recognizedRevenue")?.([baseRow, row2])).toBe(formatCompactCurrency(190000));
    expect(totalFor("ebitdaMarginPct")?.([baseRow, row2])).toBe(`${((20000 / 190000) * 100).toFixed(1)}%`);
    expect(summary.find((column) => column.key === "recognizedRevenue")?.render(baseRow)).toBe(
      formatCompactCurrency(95000),
    );
    expect(summary.find((column) => column.key === "agentSalaryPctRevenue")?.render(baseRow)).toBe("42.0%");
    expect(getPresetColumns("full").find((column) => column.key === "plannedDeliveryUnits")?.render(baseRow)).toBe("1,000");
  });

  it("totals average agent salary as a currency ratio, not a percentage", () => {
    const cost = getPresetColumns("cost");
    const averageAgentSalary = cost.find((column) => column.key === "averageAgentSalary");

    expect(averageAgentSalary?.total?.([baseRow, row2])).toBe(formatCompactCurrency(80000 / 36));
  });

  it("matches the approved preset column designs", () => {
    expect(getPresetColumns("revenue").map((column) => column.key)).toEqual([
      "processName",
      "clientName",
      "branchName",
      "processStatus",
      "billingModels",
      "mandatedSeats",
      "deliveredUnits",
      "billableUnits",
      "earnedRevenue",
      "recognizedRevenue",
      "invoicedRevenue",
      "collectedRevenue",
      "outstandingReceivable",
      "unbilledRevenue",
      "revenueAtRisk",
      "revenueVariance",
    ]);

    expect(getPresetColumns("cost").map((column) => column.key)).toEqual([
      "processName",
      "clientName",
      "branchName",
      "processStatus",
      "agentSalary",
      "averageAgentSalary",
      "agentSalaryPctRevenue",
      "dscPeople",
      "dscNonPeople",
      "dsc",
      "bmcPeople",
      "bmcNonPeople",
      "bmc",
      "grnVendorActual",
      "peopleCostPctRevenue",
    ]);

    expect(getPresetColumns("profitability").map((column) => column.key)).toEqual([
      "processName",
      "clientName",
      "branchName",
      "processStatus",
      "recognizedRevenue",
      "contribution",
      "contributionMarginPct",
      "ebitda",
      "ebitdaMarginPct",
      "ebit",
      "operatingProfitPct",
      "pbt",
      "pat",
    ]);

    expect(getPresetColumns("budget-risk").map((column) => column.key)).toEqual([
      "processName",
      "clientName",
      "branchName",
      "processStatus",
      "approvedBudget",
      "reservedBudget",
      "consumedBudget",
      "availableBudget",
      "budgetUtilizationPct",
      "revenueAtRisk",
      "outstandingReceivable",
      "unbilledRevenue",
      "revenueDataStatus",
    ]);
  });

  it("uses the approved default sort for every preset", () => {
    expect(getDefaultSort("summary")).toEqual({ sortKey: "ebitda", sortDirection: "asc" });
    expect(getDefaultSort("revenue")).toEqual({ sortKey: "revenueAtRisk", sortDirection: "desc" });
    expect(getDefaultSort("cost")).toEqual({ sortKey: "agentSalaryPctRevenue", sortDirection: "desc" });
    expect(getDefaultSort("profitability")).toEqual({ sortKey: "ebitda", sortDirection: "asc" });
    expect(getDefaultSort("budget-risk")).toEqual({ sortKey: "budgetUtilizationPct", sortDirection: "desc" });
  });

  it("keeps status visible in the full matrix identity columns", () => {
    expect(getPresetColumns("full").slice(0, 4).map((column) => column.key)).toEqual([
      "processName",
      "clientName",
      "branchName",
      "processStatus",
    ]);
  });

  it("defines all required presets and makes full wider than summary", () => {
    const summaryWidth = getPresetColumns("summary").length;

    for (const preset of ["revenue", "cost", "profitability", "budget-risk", "full"] as const) {
      expect(getPresetColumns(preset).length).toBeGreaterThan(0);
    }
    expect(getPresetColumns("full").length).toBeGreaterThan(summaryWidth);
  });

  it("keeps composite incentive and penalty fields complete in the full matrix", () => {
    const full = getPresetColumns("full");
    const incentive = full.find((column) => column.key === "incentiveRevenue");
    const penalty = full.find((column) => column.key === "penalty");
    const rowWithComposites = {
      ...baseRow,
      incentiveRevenue: 5000,
      rewardRevenue: 2000,
      penalty: 300,
      slaDeduction: 200,
    };

    expect(incentive?.label).toBe("Incentive/reward");
    expect(incentive?.render(rowWithComposites)).toBe(formatCompactCurrency(7000));
    expect(incentive?.total?.([rowWithComposites, row2])).toBe(formatCompactCurrency(12000));
    expect(penalty?.label).toBe("Penalty/SLA");
    expect(penalty?.render(rowWithComposites)).toBe(formatCompactCurrency(500));
    expect(penalty?.total?.([rowWithComposites, row2])).toBe(formatCompactCurrency(500));
  });

  it("renders status and source enums as readable labels", () => {
    const summary = getPresetColumns("summary");

    expect(summary.find((column) => column.key === "processStatus")?.render(row2)).toBe("Loss Making");
    expect(summary.find((column) => column.key === "revenueDataStatus")?.render(row2)).toBe("Delivery Missing");
    expect(getPresetColumns("revenue").find((column) => column.key === "billingModels")?.render(baseRow)).toBe("Per Unit");
  });
});
