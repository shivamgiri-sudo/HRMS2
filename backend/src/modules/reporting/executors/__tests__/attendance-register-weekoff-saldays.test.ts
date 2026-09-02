import { describe, it, expect } from "vitest";
import { findSlabMaxWeekoffs } from "../../../payroll/weekoff-eligibility.service.js";

/**
 * The register's week-off and sal_days arithmetic, pinned against the payroll slab table it
 * must agree with. All three cases are taken from the live August 2026 register.
 */

// Payroll's shipped defaults — the table the register now shares rather than copies.
const SLABS = [
  { from: 0, to: 6, max_weekoffs: 0 },
  { from: 7, to: 11, max_weekoffs: 1 },
  { from: 12, to: 17, max_weekoffs: 2 },
  { from: 18, to: 23, max_weekoffs: 3 },
  { from: 24, to: 25, max_weekoffs: 4 },
  { from: 26, to: 31, max_weekoffs: 5 },
];

// Mirrors calcEligibleWeekoffs in attendance.executor.ts.
function calcEligibleWeekoffs(paidBase: number, actualSundays: number, daysInMonth: number) {
  const availableWorkingDays = daysInMonth - actualSundays;
  if (paidBase >= availableWorkingDays) return actualSundays;
  const slabMax = findSlabMaxWeekoffs(paidBase, SLABS);
  if (slabMax === undefined) return actualSundays;
  return Math.min(slabMax, actualSundays);
}

function salDays(paidBase: number, eligibleWO: number, holiday: number, daysInMonth: number) {
  return Math.round(Math.min(paidBase + eligibleWO + holiday, daysInMonth) * 100) / 100;
}

describe("attendance register — week-off eligibility", () => {
  it("25 present + 1 half-day earns 4 week-offs, not 5", () => {
    // paidBase 25.5. The register's old private table ended at the 24-25 slab, so `25.5 <= 25`
    // failed, nothing matched, and an unmatched value fell through to full eligibility.
    // 10 employees on the live August register carried 5 where payroll pays 4.
    const paidBase = 25 + 1 * 0.5;
    expect(calcEligibleWeekoffs(paidBase, 5, 31)).toBe(4);
  });

  it("agrees with payroll across the boundary the drift opened up", () => {
    for (const [paidBase, expected] of [[23.5, 3], [24, 4], [25, 4], [25.5, 4], [26, 5]] as const) {
      expect({ paidBase, wo: calcEligibleWeekoffs(paidBase, 5, 31) })
        .toEqual({ paidBase, wo: expected });
    }
  });

  it("full attendance still earns every week-off", () => {
    expect(calcEligibleWeekoffs(26, 5, 31)).toBe(5);
  });
});

describe("attendance register — sal_days ceiling", () => {
  it("never exceeds the days in the month", () => {
    // 31 present in a 31-day month, plus the 5 week-offs still earned, summed to 36 on 15 rows
    // of the live August register.
    expect(salDays(31, 5, 0, 31)).toBe(31);
    expect(salDays(26, 5, 1, 31)).toBe(31); // 32 before the cap
    expect(salDays(25, 5, 2.5, 31)).toBe(31); // 32.5 before the cap
  });

  it("leaves a normal month untouched", () => {
    expect(salDays(25.5, 4, 0, 31)).toBe(29.5);
    expect(salDays(20, 3, 1, 30)).toBe(24);
  });

  it("caps to the shorter month too", () => {
    expect(salDays(28, 4, 0, 28)).toBe(28);
  });
});
