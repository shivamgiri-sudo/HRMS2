/**
 * computePaidBase() must agree with the engine that actually pays people.
 *
 * payrollCalculate.service.ts derives its paid_base in SQL as
 *   present 1.0 | late 1.0 | half_day 0.5 | leave_approved 1.0 | else 0
 * and computePaidBase() feeds the two surfaces that claim to show what payroll will pay:
 * the cost-centre attendance sign-off grid (payroll-cc-attendance.service.ts) and the
 * attendance register (reporting/executors/attendance.executor.ts).
 *
 * Leave used to be missing here, which understated both reports twice over: a lower paid base
 * drops the employee down calculateWeekoffEligibility()'s slab table (fewer week-offs than
 * payroll grants), and the leave days were absent from sal_days too. Live August-2026 case:
 * the sign-off grid showed 20 salary days where payroll pays 30.
 */
import { describe, it, expect } from "vitest";
import { computePaidBase, computeSalDays, type DayCounts } from "../attendanceDayCounts.js";
import { findSlabMaxWeekoffs } from "../../modules/payroll/weekoff-eligibility.service.js";

const counts = (o: Partial<DayCounts>): DayCounts =>
  ({ absent: 0, present: 0, od: 0, hd: 0, leave: 0, holiday: 0, ...o });

/** The payroll engine's own weighting, transcribed from payrollCalculate.service.ts. */
const enginePaidBase = (c: DayCounts) => c.present * 1.0 + c.hd * 0.5 + c.leave * 1.0 + c.od;

describe("computePaidBase agrees with the payroll engine", () => {
  it("counts approved leave as a full day", () => {
    expect(computePaidBase(counts({ present: 22, leave: 2 }))).toBe(24);
  });

  it("still counts a half-day as half and absence as nothing", () => {
    expect(computePaidBase(counts({ present: 20, hd: 2, leave: 1, absent: 5 }))).toBe(22);
  });

  it("matches the engine's weighting across representative months", () => {
    const cases: Array<Partial<DayCounts>> = [
      { present: 22, leave: 2, holiday: 2 },          // the live HEAD OFFICE row
      { present: 16, leave: 8, holiday: 2 },          // heavy-leave month
      { present: 26 },                                 // no leave at all
      { present: 20, hd: 3, leave: 1, od: 1 },         // fractional base
      { absent: 31 },                                  // nothing worked
    ];
    for (const c of cases) {
      expect(computePaidBase(counts(c))).toBe(enginePaidBase(counts(c)));
    }
  });

  it("holidays are NOT in the paid base — they are added separately by computeSalDays", () => {
    // The engine's SQL scores holiday as `else 0` and adds eligibleHolidays afterwards.
    // Counting them here would pay them twice.
    expect(computePaidBase(counts({ present: 22, holiday: 2 }))).toBe(22);
    expect(computeSalDays(22, 3, 2, 31)).toBe(27);
  });
});

describe("the live August-2026 regression", () => {
  // 31-day month, 5 Sundays. Slabs: 18-23 -> 3 week-offs, 24-25 -> 4.
  const SLABS = [
    { from: 0, to: 6, max_weekoffs: 0 }, { from: 7, to: 11, max_weekoffs: 1 },
    { from: 12, to: 17, max_weekoffs: 2 }, { from: 18, to: 23, max_weekoffs: 3 },
    { from: 24, to: 25, max_weekoffs: 4 }, { from: 26, to: 31, max_weekoffs: 5 },
  ];

  it("MAS00176 (22 present, 2 leave, 2 holiday) reaches payroll's 4 week-offs, not 3", () => {
    const base = computePaidBase(counts({ present: 22, leave: 2, holiday: 2 }));
    expect(base).toBe(24);
    expect(findSlabMaxWeekoffs(base, SLABS)).toBe(4);
    expect(computeSalDays(base, 4, 2, 31)).toBe(30);
  });

  it("MAS00175 (16 present, 8 leave, 2 holiday) closes the ten-day gap", () => {
    const base = computePaidBase(counts({ present: 16, leave: 8, holiday: 2 }));
    expect(base).toBe(24);
    expect(findSlabMaxWeekoffs(base, SLABS)).toBe(4);
    // Was 20 salary days on the live grid while payroll pays 30.
    expect(computeSalDays(base, 4, 2, 31)).toBe(30);
  });
});
