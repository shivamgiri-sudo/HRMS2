import { describe, expect, it } from "vitest";
import { deriveStatus, hasIncompleteCost, reviewFigures } from "../pnl-branch-review.service.js";

describe("pnl branch review figures", () => {
  it("cost is revenue minus operating profit so it cannot disagree with the P&L", () => {
    expect(reviewFigures({ revenue: 1000.004, operatingProfit: 250.5, marginPct: 25 })).toEqual({ revenue: 1000, operatingProfit: 250.5, cost: 749.5, marginPct: 25 });
  });
  it("handles a loss", () => {
    expect(reviewFigures({ revenue: 100, operatingProfit: -40, marginPct: null }).cost).toBe(140);
  });
});

describe("pnl branch review status", () => {
  const now = { revenue: 1000, cost: 800, operatingProfit: 200 };
  it("pending with no acknowledgement", () => expect(deriveStatus(0, null, now)).toBe("pending"));
  it("open queries win over an acknowledgement", () => expect(deriveStatus(2, now, now)).toBe("queried"));
  it("acknowledged when the figures still match", () => expect(deriveStatus(0, { ...now }, { ...now, revenue: 1000.5 })).toBe("acknowledged"));
  it("flags a month whose figures moved after acknowledgement", () =>
    expect(deriveStatus(0, now, { revenue: 1100, cost: 800, operatingProfit: 300 })).toBe("changed_after_acknowledgement"));
});

describe("cost-incomplete detection", () => {
  it("payroll gaps make cost incomplete", () => {
    expect(hasIncompleteCost(["PAYROLL_NOT_POSTED_FOR_PERIOD"])).toBe(true);
    expect(hasIncompleteCost(["PAYROLL_ACCRUED_NOT_FINAL", "GRN_ESTIMATED_FROM_RESERVED"])).toBe(true);
  });
  it("revenue with no payroll on one cost centre does not make a finalized month 'not final'", () => {
    expect(hasIncompleteCost(["REVENUE_WITH_NO_PAYROLL"])).toBe(false);
  });
  it("other flags do not", () => {
    expect(hasIncompleteCost(["BRANCH_BUDGET_MISSING"])).toBe(false);
    expect(hasIncompleteCost([])).toBe(false);
  });
});
