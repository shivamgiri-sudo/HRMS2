import { describe, expect, it } from "vitest";
import { calculateBpoCostWaterfall, calculateRevenue } from "../bpo-pnl.calculation.js";

describe("BPO revenue calculation", () => {
  it("calculates a hybrid seat and transaction contract", () => {
    const result = calculateRevenue(
      [
        {
          billingModel: "per_seat",
          metricKey: "billable_seats",
          rateAmount: 30000,
          mandatedSeats: 50,
        },
        {
          billingModel: "per_transaction",
          metricKey: "transactions",
          rateAmount: 12,
          includedUnits: 10000,
          overageRate: 10,
        },
      ],
      [
        { metricKey: "billable_seats", plannedUnits: 50, deliveredUnits: 48, acceptedUnits: 48, billableUnits: 48 },
        { metricKey: "transactions", plannedUnits: 15000, deliveredUnits: 14000, acceptedUnits: 13500, billableUnits: 13500 },
      ],
      [
        { type: "incentive", direction: "increase", amountInr: 50000 },
        { type: "sla_deduction", direction: "decrease", amountInr: 20000 },
      ]
    );

    expect(result.baseRevenue).toBe(1595000);
    expect(result.earnedRevenue).toBe(1625000);
    expect(result.deliveryAttainmentPct).toBeCloseTo((14048 / 15050) * 100, 5);
  });

  it("tops up revenue to the monthly minimum commitment", () => {
    const result = calculateRevenue(
      [{
        billingModel: "per_productive_hour",
        metricKey: "productive_hours",
        rateAmount: 500,
        monthlyMinimumCommitment: 1000000,
      }],
      [{ metricKey: "productive_hours", plannedUnits: 2200, productiveHours: 1600, billableUnits: 1600 }]
    );

    expect(result.baseRevenue).toBe(800000);
    expect(result.minimumCommitmentTopUp).toBe(200000);
    expect(result.earnedRevenue).toBe(1000000);
  });
});

describe("BPO P&L cost waterfall", () => {
  it("separates Agent Salary, DSC, BMC and calculates EBITDA through PAT", () => {
    const result = calculateBpoCostWaterfall({
      revenue: 5000000,
      agentSalary: 1800000,
      dscPeople: 300000,
      dscNonPeople: 250000,
      bmcPeople: 200000,
      bmcNonPeople: 350000,
      otherOperatingCost: 100000,
      depreciation: 150000,
      amortization: 50000,
      financeCost: 75000,
      tax: 500000,
      agentHeadcount: 60,
      activeHeadcount: 68,
      contractedSeats: 65,
      billableSeats: 62,
    });

    expect(result.dsc).toBe(550000);
    expect(result.bmc).toBe(550000);
    expect(result.ebitda).toBe(2000000);
    expect(result.ebit).toBe(1800000);
    expect(result.pbt).toBe(1725000);
    expect(result.pat).toBe(1225000);
    expect(result.agentSalaryPctRevenue).toBe(36);
    expect(result.averageAgentSalary).toBe(30000);
  });
});
