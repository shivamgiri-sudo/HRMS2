import { describe, expect, it } from "vitest";
import { shiftPeriod } from "../canonical-pnl.service.js";
import { allocateAmountByWeights, deliveryDataStatus } from "../process-lob.service.js";

describe("Process LOB shared-cost allocation", () => {
  it("allocates a pool using contracted-seat weights and preserves the total", () => {
    const result = allocateAmountByWeights(
      100000,
      new Map([
        ["lob-a", 60],
        ["lob-b", 40],
      ])
    );

    expect(result.allocated.get("lob-a")).toBeCloseTo(60000, 2);
    expect(result.allocated.get("lob-b")).toBeCloseTo(40000, 2);
    expect(result.unallocated).toBeCloseTo(0, 5);
    expect([...result.allocated.values()].reduce((sum, amount) => sum + amount, 0)).toBeCloseTo(100000, 5);
  });

  it("retains the complete pool as an explicit exception when no driver evidence exists", () => {
    const result = allocateAmountByWeights(
      75000,
      new Map([
        ["lob-a", 0],
        ["lob-b", 0],
      ])
    );

    expect(result.allocated.size).toBe(0);
    expect(result.unallocated).toBe(75000);
  });

  it("ignores negative driver evidence rather than creating negative allocations", () => {
    const result = allocateAmountByWeights(
      90000,
      new Map([
        ["lob-a", -10],
        ["lob-b", 30],
      ])
    );

    expect(result.allocated.get("lob-a")).toBe(0);
    expect(result.allocated.get("lob-b")).toBe(90000);
    expect(result.unallocated).toBeCloseTo(0, 5);
  });

  it("allocates negative accounting adjustments without losing the sign", () => {
    const result = allocateAmountByWeights(
      -5000,
      new Map([
        ["lob-a", 1],
        ["lob-b", 1],
      ])
    );

    expect(result.allocated.get("lob-a")).toBe(-2500);
    expect(result.allocated.get("lob-b")).toBe(-2500);
    expect(result.unallocated).toBeCloseTo(0, 5);
  });
});

describe("deliveryDataStatus", () => {
  /**
   * Pins the exact bug this was extracted to fix: process-lob.service.ts's
   * recognizedRevenue can be a computed zero for a LOB with zero delivery
   * rows (calculateRevenue's metricUnits() falls back to 0 units with no
   * delivery data), and the old dataStatus.delivery check
   * (`deliveredUnits || billableUnits` truthy) got this specific case wrong
   * two different ways -- see the two "wrong under the old rule" cases below.
   */

  it("reports 'available' when the LOB has real delivery rows this period", () => {
    expect(deliveryDataStatus(true, [{ billingModel: "per_seat" }])).toBe("available");
  });

  it("reports 'missing' for a volume-billed LOB with zero delivery rows -- recognizedRevenue may be an unverified zero", () => {
    // Wrong under the old rule when the LOB's own units genuinely summed to 0
    // that period (a real validated zero-delivery day): deliveredUnits=0 AND
    // billableUnits=0 read as falsy just the same as "no rows exist at all",
    // so a real recorded zero and a missing feed were indistinguishable.
    expect(deliveryDataStatus(false, [{ billingModel: "per_seat" }])).toBe("missing");
    expect(deliveryDataStatus(false, [{ billingModel: "per_productive_hour" }])).toBe("missing");
  });

  it("reports 'not_required' for a fixed_monthly-only LOB with zero delivery rows -- its revenue does not depend on delivery data", () => {
    // Wrong under the old rule in the opposite direction: metricUnits() returns a
    // constant 1 for fixed_monthly regardless of delivery data, so billableUnits
    // was always truthy and the old check said "available" -- implying delivery
    // data existed when none does, for a LOB that never needed any.
    expect(deliveryDataStatus(false, [{ billingModel: "fixed_monthly" }])).toBe("not_required");
  });

  it("reports 'missing' when a LOB mixes fixed_monthly with a volume-based rule and has no delivery rows", () => {
    // The volume-based rule still can't be verified even though the fixed portion can.
    expect(deliveryDataStatus(false, [
      { billingModel: "fixed_monthly" },
      { billingModel: "per_seat" },
    ])).toBe("missing");
  });

  it("reports 'not_required' when a LOB has no revenue rules at all -- dataStatus.revenue separately says 'missing_rule'", () => {
    expect(deliveryDataStatus(false, [])).toBe("not_required");
  });
});

describe("Canonical P&L period shifting", () => {
  it("crosses calendar years correctly", () => {
    expect(shiftPeriod("2026-01", -1)).toBe("2025-12");
    expect(shiftPeriod("2026-12", 1)).toBe("2027-01");
  });

  it("supports multi-month trend windows", () => {
    expect(shiftPeriod("2026-07", -5)).toBe("2026-02");
    expect(shiftPeriod("2026-07", 0)).toBe("2026-07");
  });
});
