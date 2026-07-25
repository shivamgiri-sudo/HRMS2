import { describe, expect, it } from "vitest";
import { shiftPeriod } from "../canonical-pnl.service.js";
import { allocateAmountByWeights } from "../process-lob.service.js";

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
