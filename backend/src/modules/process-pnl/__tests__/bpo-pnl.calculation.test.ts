import { describe, expect, it } from "vitest";
import { allocatePoolAmount, calculateBpoCostWaterfall, calculateRevenue } from "../bpo-pnl.calculation.js";

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

describe("shared allocation primitive (allocatePoolAmount)", () => {
  it("splits a weighted (driver-proportional) pool with an exact reconciling sum — meter example", () => {
    // Mandatory spec example: rate = INR 10; CC1 = 7,500 units, CC2 = 5,000 units, CC3 = 4,000
    // units; branch units = 16,500; branch amount = INR 165,000.
    const outcome = allocatePoolAmount(
      165000,
      [
        { key: "cc1", weight: 7500 },
        { key: "cc2", weight: 5000 },
        { key: "cc3", weight: 4000 },
      ],
      "weighted"
    );

    expect(outcome.amounts.get("cc1")).toBe(75000);
    expect(outcome.amounts.get("cc2")).toBe(50000);
    expect(outcome.amounts.get("cc3")).toBe(40000);
    const sum = [...outcome.amounts.values()].reduce((total, value) => total + value, 0);
    expect(sum).toBe(165000);
    expect(outcome.balanced).toBe(true);
  });

  it("reconciles exactly even when the proportional split produces repeating decimals", () => {
    // 100000 split 1:1:1 -> naive float division gives 33333.333... per share, which does not
    // sum back to exactly 100000. The largest-remainder method must still reconcile exactly.
    const outcome = allocatePoolAmount(
      100000,
      [
        { key: "a", weight: 1 },
        { key: "b", weight: 1 },
        { key: "c", weight: 1 },
      ],
      "weighted"
    );
    const sum = [...outcome.amounts.values()].reduce((total, value) => total + value, 0);
    expect(sum).toBe(100000);
    // Each share should be within 1 paisa of the naive even split.
    for (const value of outcome.amounts.values()) {
      expect(Math.abs(value - 100000 / 3)).toBeLessThan(0.01);
    }
  });

  it("splits an equal-mode pool evenly with an exact reconciling sum", () => {
    const outcome = allocatePoolAmount(
      10000,
      [{ key: "a", weight: 0 }, { key: "b", weight: 0 }, { key: "c", weight: 0 }],
      "equal"
    );
    const sum = [...outcome.amounts.values()].reduce((total, value) => total + value, 0);
    expect(sum).toBe(10000);
    expect(outcome.amounts.get("a")).toBeCloseTo(3333.34, 2);
  });

  it("falls back to an equal split when all weighted driver values are zero, still reconciling exactly", () => {
    const outcome = allocatePoolAmount(
      9999,
      [{ key: "a", weight: 0 }, { key: "b", weight: 0 }, { key: "c", weight: 0 }],
      "weighted"
    );
    const sum = [...outcome.amounts.values()].reduce((total, value) => total + value, 0);
    expect(sum).toBe(9999);
  });

  it("applies configured manual percentages as-is without silently renormalizing them", () => {
    const outcome = allocatePoolAmount(
      100000,
      [
        { key: "a", weight: 40 },
        { key: "b", weight: 30 },
      ],
      "manual_percentage"
    );
    // Percentages sum to 70, not 100 — amounts must reflect that (under-allocated), not be
    // silently rebalanced to sum to the pool amount.
    expect(outcome.amounts.get("a")).toBe(40000);
    expect(outcome.amounts.get("b")).toBe(30000);
    expect(outcome.balanced).toBe(false);
    expect(outcome.percentTotal).toBe(70);
  });

  it("reports balanced=true when manual percentages sum to 100 within tolerance", () => {
    const outcome = allocatePoolAmount(
      100000,
      [
        { key: "a", weight: 60 },
        { key: "b", weight: 40 },
      ],
      "manual_percentage"
    );
    expect(outcome.balanced).toBe(true);
    expect(outcome.percentTotal).toBe(100);
  });
});
