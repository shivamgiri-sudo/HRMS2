process.env.TZ = "America/Los_Angeles";
import { describe, expect, it } from "vitest";
import { valueAddOn, VALUE_ADD_ENV, type ValueAdd } from "../he-valueadd-switches.js";
import { calibrateShowRate, calibratedCaps, calibratedPlanNumbers, weekdayOf } from "../he-showrate-calibration.js";
import { dailyPlanNumbers, type DailyPlan } from "../he-slots.js";
import { streamCaps } from "../he-stream-plan.service.js";

const noNaN = (v: unknown) => expect(JSON.stringify(v)).not.toMatch(/NaN|Infinity/);

describe("valueAddOn", () => {
  it("is on only for exactly true (trimmed, any case)", () => {
    expect(valueAddOn("best_offer", { HE_BEST_OFFER: " TRUE " })).toBe(true);
    expect(valueAddOn("best_offer", { HE_BEST_OFFER: "true" })).toBe(true);
    for (const v of ["1", "yes", "", "truee", "on", undefined]) expect(valueAddOn("best_offer", { HE_BEST_OFFER: v })).toBe(false);
    expect(valueAddOn("best_offer", {})).toBe(false);
  });
  it("reads its own variable for each switch", () => {
    for (const [k, envName] of Object.entries(VALUE_ADD_ENV)) {
      expect(valueAddOn(k as ValueAdd, { [envName]: "true" })).toBe(true);
      expect(valueAddOn(k as ValueAdd, { HE_OTHER: "true" })).toBe(false);
    }
  });
  it("defaults to process.env", () => {
    expect(valueAddOn("smart_slots")).toBe(process.env.HE_SMART_SLOTS?.trim().toLowerCase() === "true");
  });
});

describe("weekdayOf", () => {
  it("is Monday-based and timezone independent", () => {
    expect(process.env.TZ).toBe("America/Los_Angeles");
    expect(weekdayOf("2026-10-12")).toBe(0);
    expect(weekdayOf("2026-10-18")).toBe(6);
    expect(weekdayOf("2026-10-14")).toBe(2);
    expect(weekdayOf("2026-03-01")).toBe(6);
  });
});

describe("calibrateShowRate", () => {
  const base = { weekday: 2, byWeekday: {}, overall: { invited: 0, arrived: 0 }, planDefault: 0.25, minSample: 30 };
  it("uses the weekday sample at the minimum", () => {
    expect(calibrateShowRate({ ...base, byWeekday: { 2: { invited: 30, arrived: 15 } }, overall: { invited: 60, arrived: 18 } }))
      .toEqual({ rate: 0.5, basis: "actual_weekday", invited: 30, arrived: 15, weekday: 2 });
  });
  it("falls back to overall when the weekday sample is short", () => {
    expect(calibrateShowRate({ ...base, byWeekday: { 2: { invited: 29, arrived: 29 } }, overall: { invited: 60, arrived: 18 } }))
      .toEqual({ rate: 0.3, basis: "actual", invited: 60, arrived: 18, weekday: null });
  });
  it("falls back to the plan default", () => {
    const r = calibrateShowRate({ ...base, overall: { invited: 29, arrived: 20 } });
    expect(r.rate).toBe(0.25);
    expect(r.basis).toBe("plan_default");
    expect(r.weekday).toBeNull();
  });
  it("clamps to the bounds", () => {
    expect(calibrateShowRate({ ...base, overall: { invited: 40, arrived: 0 } }).rate).toBe(0.05);
    expect(calibrateShowRate({ ...base, overall: { invited: 40, arrived: 40 } }).rate).toBe(0.95);
    expect(calibrateShowRate({ ...base, planDefault: 0.01 }).rate).toBe(0.05);
    expect(calibrateShowRate({ ...base, planDefault: 5 }).rate).toBe(0.95);
  });
  it("caps arrived at invited", () => {
    const r = calibrateShowRate({ ...base, overall: { invited: 40, arrived: 55 } });
    expect(r).toMatchObject({ rate: 0.95, arrived: 40, invited: 40, basis: "actual" });
  });
  it("makes counts whole and non-negative, and survives NaN", () => {
    const r = calibrateShowRate({ ...base, byWeekday: { 2: { invited: NaN, arrived: NaN } }, overall: { invited: NaN, arrived: Infinity } });
    expect(r).toMatchObject({ rate: 0.25, basis: "plan_default", invited: 0, arrived: 0 });
    expect(calibrateShowRate({ ...base, overall: { invited: -5, arrived: -1 } }).basis).toBe("plan_default");
    expect(calibrateShowRate({ ...base, overall: { invited: 40.9, arrived: 20.9 } })).toMatchObject({ invited: 40, arrived: 20, rate: 0.5 });
    noNaN(r);
    noNaN(calibrateShowRate({ ...base, planDefault: NaN }));
  });
  it("rounds to 4 decimals", () => {
    expect(calibrateShowRate({ ...base, overall: { invited: 30, arrived: 10 } }).rate).toBe(0.3333);
  });
});

describe("calibratedPlanNumbers", () => {
  const plan: DailyPlan = { walkInsPerDay: 100, minOutreachPerDay: 0, showRatePct: 25, slotStart: "10:00", slotEnd: "17:30", slotMinutes: 30 };
  it("scales invites with the rate", () => {
    expect(calibratedPlanNumbers(plan, 0.4)).toEqual({ invites: 250, targetShows: 100, slots: 15, perSlot: 17, capacity: 255 });
  });
  it("never goes above twice today's invites", () => {
    expect(calibratedPlanNumbers(plan, 0.05)).toEqual({ invites: 800, targetShows: 40, slots: 15, perSlot: 50, capacity: 750 });
  });
  it("never goes below half of today's invites", () => {
    expect(calibratedPlanNumbers(plan, 0.95)).toEqual({ invites: 200, targetShows: 190, slots: 15, perSlot: 14, capacity: 210 });
  });
  it("equals today's numbers at the plan default", () => {
    expect(calibratedPlanNumbers(plan, 0.25)).toEqual(dailyPlanNumbers(plan));
  });
  it("is finite for bad rates", () => {
    for (const r of [NaN, 0, -1, Infinity, 7]) noNaN(calibratedPlanNumbers(plan, r));
  });
});

describe("calibratedCaps", () => {
  const plan: DailyPlan = { walkInsPerDay: 100, minOutreachPerDay: 0, showRatePct: 25, slotStart: "10:00", slotEnd: "17:30", slotMinutes: 30 };
  const streams = [{ id: "a", dailyInvites: null }, { id: "b", dailyInvites: null }, { id: "c", dailyInvites: 40 }];
  it("matches streamCaps at the plan default", () => {
    const caps = calibratedCaps(streams, plan, () => 0.25);
    expect(caps).toEqual(streamCaps(streams, 400));
    expect([...caps.entries()]).toEqual([["a", 200], ["b", 200], ["c", 40]]);
  });
  it("uses each stream's own rate and keeps HR quotas", () => {
    const caps = calibratedCaps(streams, plan, (id) => (id === "a" ? 0.4 : 0.25));
    expect(caps.get("a")).toBe(125);
    expect(caps.get("b")).toBe(200);
    expect(caps.get("c")).toBe(40);
    noNaN([...caps.entries()]);
  });
});
