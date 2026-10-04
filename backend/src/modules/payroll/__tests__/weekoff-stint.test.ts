import { describe, it, expect, vi } from "vitest";
import { calculateWeekoffEligibility } from "../weekoff-eligibility.service.js";

vi.mock("../../policy-engine/policy-engine.cache.js", () => ({
  // Force the documented default slab table, independent of live policy rows.
  getPolicyValue: async (_d: string, _k: string, _s: string, fallback: string) => fallback,
}));

const SEP = "2026-09"; // 30 days, Sundays 6/13/20/27 = 4

describe("calculateWeekoffEligibility with a stint scope", () => {
  it("without the scope it is unchanged: 24 paid days in a 30-day month gives the slab (4)", async () => {
    // working 26, 24 < 26 -> slab 24-25 = 4, min(4, 4 Sundays) = 4
    expect(await calculateWeekoffEligibility("e1", 24, SEP, 0)).toBe(4);
  });

  it("rejoiner employed 21 days with 3 Sundays and 18 paid days earns all 3 (no slab shortfall)", async () => {
    // employed 21, Sundays 3 -> working 18, paid 18 >= 18 -> all 3 Sundays
    expect(await calculateWeekoffEligibility("e1", 18, SEP, 0, { employedDays: 21, sundays: 3 })).toBe(3);
  });

  it("the same 18 paid days WITHOUT the scope falls to the slab (3 of 4 Sundays), unchanged", async () => {
    // working 26, 18 < 26 -> slab 18-23 = 3, min(3, 4) = 3
    expect(await calculateWeekoffEligibility("e1", 18, SEP, 0)).toBe(3);
  });

  it("a rejoiner who missed a day in the stint falls into the slab on the employed working days", async () => {
    // employed 21, Sundays 3 -> working 18, paid 17 < 18 -> slab(17) = 2, min(2, 3) = 2
    expect(await calculateWeekoffEligibility("e1", 17, SEP, 0, { employedDays: 21, sundays: 3 })).toBe(2);
  });

  it("holidays inside employment count toward the full-attendance test", async () => {
    // employed 21, Sundays 3 -> working 18; 1 holiday -> available 17; paid 16 + 1 holiday = 17 >= 17 -> all 3
    expect(await calculateWeekoffEligibility("e1", 16, SEP, 1, { employedDays: 21, sundays: 3 })).toBe(3);
  });

  it("never returns more Sundays than were inside employment", async () => {
    expect(await calculateWeekoffEligibility("e1", 30, SEP, 0, { employedDays: 21, sundays: 3 })).toBe(3);
  });

  it("zero employed days earns nothing", async () => {
    expect(await calculateWeekoffEligibility("e1", 0, SEP, 0, { employedDays: 0, sundays: 0 })).toBe(0);
  });
});
