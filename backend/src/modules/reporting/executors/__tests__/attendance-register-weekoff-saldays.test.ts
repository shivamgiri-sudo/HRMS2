import { describe, it, expect, vi } from "vitest";

/**
 * The attendance register does not compute week-off eligibility itself — it calls
 * calculateWeekoffEligibility(), the same engine the payslip uses. These cases pin the answers
 * the register now inherits, using the shipped default slabs (no policy override).
 */
vi.mock("../../../policy-engine/policy-engine.cache.js", () => ({
  getPolicyValue: async (_d: string, _k: string, _s: string, fallback: string) => fallback,
}));

const { calculateWeekoffEligibility } = await import(
  "../../../payroll/weekoff-eligibility.service.js"
);

// sal_days as the register renders it, capped at the length of the month.
function salDays(paidBase: number, eligibleWO: number, holiday: number, daysInMonth: number) {
  return Math.round(Math.min(paidBase + eligibleWO + holiday, daysInMonth) * 100) / 100;
}

describe("week-off entitlement is relative to the month", () => {
  it("31-day month with 5 Sundays: 26 present days earns all 5", async () => {
    // 31 - 5 = 26 available working days.
    expect(await calculateWeekoffEligibility("e1", 26, "2026-08")).toBe(5);
  });

  it("30-day month with 5 Sundays: 25 present days earns all 5", async () => {
    // 30 - 5 = 25. Nov 2026 has 5 Sundays (1, 8, 15, 22, 29).
    expect(await calculateWeekoffEligibility("e1", 25, "2026-11")).toBe(5);
  });

  it("one day short of the threshold does not earn the last week-off", async () => {
    // The reported case: 25 present + 1 half-day = paidBase 25.5, under 26, so 4 not 5.
    expect(await calculateWeekoffEligibility("e1", 25.5, "2026-08")).toBe(4);
    expect(await calculateWeekoffEligibility("e1", 24, "2026-11")).toBe(4);
  });

  it("never returns more week-offs than the month actually has", async () => {
    expect(await calculateWeekoffEligibility("e1", 31, "2026-08")).toBe(5);
    expect(await calculateWeekoffEligibility("e1", 28, "2026-02")).toBe(4); // Feb 2026: 4 Sundays
  });
});

describe("sal_days ceiling", () => {
  it("never exceeds the days in the month", () => {
    // 31 present + 5 week-offs summed to 36 in a 31-day August on 15 live rows.
    expect(salDays(31, 5, 0, 31)).toBe(31);
    expect(salDays(26, 5, 1, 31)).toBe(31);
    expect(salDays(25, 5, 2.5, 31)).toBe(31);
  });

  it("leaves an ordinary month untouched", () => {
    expect(salDays(25.5, 4, 0, 31)).toBe(29.5);
    expect(salDays(20, 3, 1, 30)).toBe(24);
  });
});
