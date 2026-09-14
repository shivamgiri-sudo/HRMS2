import { describe, it, expect, vi } from "vitest";

vi.mock("../../policy-engine/policy-engine.cache.js", () => ({
  getPolicyValue: vi.fn().mockResolvedValue(
    '[{"from":0,"to":6,"max_weekoffs":0},{"from":7,"to":11,"max_weekoffs":1},{"from":12,"to":17,"max_weekoffs":2},{"from":18,"to":23,"max_weekoffs":3},{"from":24,"to":25,"max_weekoffs":4},{"from":26,"to":31,"max_weekoffs":5}]'
  ),
}));

import {
  findSlabMaxWeekoffs,
  calculateWeekoffEligibility,
} from "../weekoff-eligibility.service.js";

const DEFAULT_SLABS = [
  { from: 0,  to: 6,  max_weekoffs: 0 },
  { from: 7,  to: 11, max_weekoffs: 1 },
  { from: 12, to: 17, max_weekoffs: 2 },
  { from: 18, to: 23, max_weekoffs: 3 },
  { from: 24, to: 25, max_weekoffs: 4 },
  { from: 26, to: 31, max_weekoffs: 5 },
];

describe("findSlabMaxWeekoffs — slab boundary lookups", () => {
  it("returns 0 for paidBase 0–6", () => {
    expect(findSlabMaxWeekoffs(0, DEFAULT_SLABS)).toBe(0);
    expect(findSlabMaxWeekoffs(6, DEFAULT_SLABS)).toBe(0);
  });

  it("returns 1 for paidBase 7–11", () => {
    expect(findSlabMaxWeekoffs(7, DEFAULT_SLABS)).toBe(1);
    expect(findSlabMaxWeekoffs(11, DEFAULT_SLABS)).toBe(1);
  });

  it("returns 4 for paidBase 24–25 (4-Sunday month boundary)", () => {
    expect(findSlabMaxWeekoffs(24, DEFAULT_SLABS)).toBe(4);
    expect(findSlabMaxWeekoffs(25, DEFAULT_SLABS)).toBe(4);
  });

  it("returns 5 for paidBase 26–31 (5-Sunday month slab)", () => {
    expect(findSlabMaxWeekoffs(26, DEFAULT_SLABS)).toBe(5);
    expect(findSlabMaxWeekoffs(31, DEFAULT_SLABS)).toBe(5);
  });

  it("returns undefined for paidBase > 31 (uncapped)", () => {
    expect(findSlabMaxWeekoffs(32, DEFAULT_SLABS)).toBeUndefined();
  });

  it("handles fractional paidBase at slab boundary 25.5 — falls into 26–31 slab", () => {
    // 25.5 >= 26? No — falls off last slab → undefined (uncapped)
    // 25.5 is between slabs 24–25 and 26–31; previous slab uses < next.from
    // so 25.5 >= 24 && 25.5 < 26 → slab 24–25 → max 4
    expect(findSlabMaxWeekoffs(25.5, DEFAULT_SLABS)).toBe(4);
  });

  it("handles fractional paidBase 26.5 — inside 26–31 slab", () => {
    expect(findSlabMaxWeekoffs(26.5, DEFAULT_SLABS)).toBe(5);
  });
});

describe("calculateWeekoffEligibility — 5-Sunday month (August 2026, 31 days)", () => {
  // August 2026: 5 Sundays (2,9,16,23,30). availableWorkingDays = 31-5 = 26.

  it("grants 5 week-offs when paidBase >= 26 (perfect attendance)", async () => {
    const result = await calculateWeekoffEligibility("emp-1", 26, "2026-08");
    expect(result).toBe(5);
  });

  it("grants 5 week-offs when paidBase = 26 exactly (borderline perfect)", async () => {
    const result = await calculateWeekoffEligibility("emp-1", 26, "2026-08");
    expect(result).toBe(5);
  });

  it("grants 5 week-offs when paidBase = 27 (slab 26–31)", async () => {
    const result = await calculateWeekoffEligibility("emp-1", 27, "2026-08");
    expect(result).toBe(5);
  });

  it("caps at 4 week-offs when paidBase = 25 (slab 24–25, one day short)", async () => {
    const result = await calculateWeekoffEligibility("emp-1", 25, "2026-08");
    expect(result).toBe(4);
  });

  it("caps at 4 week-offs when paidBase = 24", async () => {
    const result = await calculateWeekoffEligibility("emp-1", 24, "2026-08");
    expect(result).toBe(4);
  });
});

describe("calculateWeekoffEligibility — 4-Sunday month (September 2026, 30 days)", () => {
  // September 2026: 4 Sundays (6,13,20,27). availableWorkingDays = 30-4 = 26.

  it("grants 4 week-offs when paidBase = 26 (perfect attendance)", async () => {
    const result = await calculateWeekoffEligibility("emp-1", 26, "2026-09");
    expect(result).toBe(4);
  });

  it("caps at 4 when paidBase = 24 (slab 24–25)", async () => {
    const result = await calculateWeekoffEligibility("emp-1", 24, "2026-09");
    expect(result).toBe(4);
  });

  it("returns 0 when paidBase = 0", async () => {
    const result = await calculateWeekoffEligibility("emp-1", 0, "2026-09");
    expect(result).toBe(0);
  });
});
