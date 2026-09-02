/**
 * A company holiday must not count against "did you work every available working day".
 *
 * calculateWeekoffEligibility grants all week-offs when paidBase reaches availableWorkingDays,
 * otherwise it falls to the slab table. availableWorkingDays used to be (daysInMonth - weekoffs),
 * ignoring holidays — but paidBase scores present/late/half/leave and never holidays, so in a
 * month with H holidays the highest paid base attainable is (daysInMonth - weekoffs - H). The
 * full-attendance branch was therefore unreachable whenever the company closed for a day, and
 * employees with a perfect record silently dropped a slab.
 *
 * Live August 2026: 31 days, 5 Sundays, 2 holidays. A perfect record capped at paidBase 24
 * against a threshold of 26 -> 4 week-offs instead of 5. Six of seventeen HEAD OFFICE employees
 * lost a day, one of them present every single working day.
 */
import { describe, it, expect, vi } from "vitest";
import { calculateWeekoffEligibility } from "../weekoff-eligibility.service.js";

vi.mock("../../policy-engine/policy-engine.cache.js", () => ({
  // Force the documented default slab table, independent of live policy rows.
  getPolicyValue: async (_d: string, _k: string, _s: string, fallback: string) => fallback,
}));

const AUG = "2026-08"; // 31 days, 5 Sundays -> 26 working days
const NOV = "2026-11"; // 30 days, 5 Sundays -> 25 working days

describe("holidays do not count against full-attendance week-off eligibility", () => {
  it("August: a perfect record with 2 holidays earns all 5 week-offs, not 4", async () => {
    // 26 working days - 2 holidays = 24 available; the employee worked all 24.
    expect(await calculateWeekoffEligibility("e1", 24, AUG, 2)).toBe(5);
  });

  it("August: the same paid base with no holidays declared still falls to the slab", async () => {
    // 24 against 26 available — genuinely short two days, so the 24-25 slab applies.
    expect(await calculateWeekoffEligibility("e1", 24, AUG, 0)).toBe(4);
  });

  it("November: 2 holidays would have cost 2 week-offs, the worst case", async () => {
    // 25 working days - 2 holidays = 23 available. Before: 23 vs 25 -> slab 18-23 -> 3.
    expect(await calculateWeekoffEligibility("e1", 23, NOV, 2)).toBe(5);
    expect(await calculateWeekoffEligibility("e1", 23, NOV, 0)).toBe(3);
  });

  it("genuinely short attendance is still capped by the slab", async () => {
    // 19 paid days in August with 2 holidays: 19 < 24, so the slab decides -> 18-23 -> 3.
    expect(await calculateWeekoffEligibility("e1", 19, AUG, 2)).toBe(3);
    // And a very poor month stays where it was.
    expect(await calculateWeekoffEligibility("e1", 7, AUG, 2)).toBe(1);
    expect(await calculateWeekoffEligibility("e1", 0, AUG, 2)).toBe(0);
  });

  it("never grants more week-offs than the month actually has", async () => {
    expect(await calculateWeekoffEligibility("e1", 31, AUG, 2)).toBe(5);
  });

  it("refuses to turn a bad holiday count into free pay", async () => {
    // A count that is negative, absurd, or non-finite must not drive availableWorkingDays to
    // zero, where `paidBase >= available` is true for everyone regardless of attendance.
    for (const bad of [-5, 999, Number.NaN, Number.POSITIVE_INFINITY]) {
      const granted = await calculateWeekoffEligibility("e1", 3, AUG, bad as number);
      expect(granted).toBe(0); // 3 paid days earns nothing on the slab, whatever the input
    }
  });
});

describe("the holiday count is per employee, never a flat month figure", () => {
  /**
   * Holidays are configured in leave_holiday_master and scoped per employee by
   * resolveHolidaysForEmployeeV2: holiday_date >= date_of_joining, branch/process via
   * holiday_cost_centre_mapping, and designation via holiday_designation_mapping. Two people in
   * the same month legitimately get different counts — a new joiner, a different branch, a
   * designation the holiday does not cover — so the eligibility test has to move with them.
   * Passing a single month-wide holiday count would hand week-offs to people the holiday never
   * applied to.
   */
  it("same paid base, different holiday entitlement, different week-offs", async () => {
    // 26 August working days. Both worked 24 days.
    // Covered by both holidays -> 24 available -> full entitlement.
    expect(await calculateWeekoffEligibility("covered", 24, AUG, 2)).toBe(5);
    // Joined mid-month, only one holiday falls after joining -> 25 available -> still short.
    expect(await calculateWeekoffEligibility("joiner", 24, AUG, 1)).toBe(4);
    // A branch the holidays were not declared for -> 26 available -> short by two.
    expect(await calculateWeekoffEligibility("other-branch", 24, AUG, 0)).toBe(4);
  });
});
