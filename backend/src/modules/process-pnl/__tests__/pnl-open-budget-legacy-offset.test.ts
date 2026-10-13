import { describe, expect, it } from "vitest";
import { offsetReserveByLegacySpend } from "../pnl-open-budget.js";

const reserve = (cc: Record<string, number>, pooled: Record<string, number> = {}) => ({ byCostCentre: new Map(Object.entries(cc)), unallocatedByBranch: new Map(Object.entries(pooled)) });

describe("legacy spend uses up open budget headroom (no double count)", () => {
  it("takes the legacy spend of a cost centre off its own headroom", () => {
    const r = offsetReserveByLegacySpend(reserve({ cc1: 100 }), [{ branchId: "b", costCentreId: "cc1", amount: 40 }]);
    expect(r.byCostCentre.get("cc1")).toBe(60);
  });
  it("never goes below zero, and the excess uses up the branch's pooled headroom", () => {
    const r = offsetReserveByLegacySpend(reserve({ cc1: 30 }, { b: 50 }), [{ branchId: "b", costCentreId: "cc1", amount: 70 }]);
    expect(r.byCostCentre.has("cc1")).toBe(false);
    expect(r.unallocatedByBranch.get("b")).toBe(10);
  });
  it("a cost centre with no open headroom leaves its legacy spend for the branch pool", () => {
    const r = offsetReserveByLegacySpend(reserve({}, { b: 25 }), [{ branchId: "b", costCentreId: "ccX", amount: 10 }]);
    expect(r.unallocatedByBranch.get("b")).toBe(15);
  });
  it("adds nothing and ignores non-positive amounts", () => {
    const r = offsetReserveByLegacySpend(reserve({ cc1: 5 }, { b: 5 }), [{ branchId: "b", costCentreId: "cc1", amount: -3 }, { branchId: "b", costCentreId: null, amount: 0 }]);
    expect(r.byCostCentre.get("cc1")).toBe(5);
    expect(r.unallocatedByBranch.get("b")).toBe(5);
  });
  it("does not mutate the input", () => {
    const input = reserve({ cc1: 100 });
    offsetReserveByLegacySpend(input, [{ branchId: "b", costCentreId: "cc1", amount: 40 }]);
    expect(input.byCostCentre.get("cc1")).toBe(100);
  });
});
