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

const state: ProcessPnlViewState = {
  preset: "summary",
  status: "all",
  issue: "all",
  density: "comfortable",
  sortKey: "processName",
  sortDirection: "asc",
  search: "",
};

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

  it("defines all presets and makes broad presets wider than summary", () => {
    const summaryWidth = getPresetColumns("summary").length;

    for (const preset of ["revenue", "cost", "full"] as const) {
      expect(getPresetColumns(preset).length).toBeGreaterThan(summaryWidth);
    }
    expect(getPresetColumns("profitability").length).toBeGreaterThan(0);
    expect(getPresetColumns("budget-risk").length).toBeGreaterThan(0);
    expect(getPresetColumns("full").length).toBeGreaterThanOrEqual(
      getPresetColumns("revenue").length,
    );
  });
});
