import { describe, expect, it } from "vitest";
import { assignSlots, driveCapacity, generateSlots, inviteTarget, istAddMinutes, nextFreeSlot, nowIst } from "../he-slots.js";

const cfg = { date: "2026-10-07", start: "10:00", end: "12:00", minutes: 30, capacity: 2 };

describe("slots", () => {
  it("generates half-hour slots excluding end", () => expect(generateSlots(cfg)).toEqual(["2026-10-07 10:00:00", "2026-10-07 10:30:00", "2026-10-07 11:00:00", "2026-10-07 11:30:00"]));
  it("capacity", () => expect(driveCapacity(cfg)).toBe(8));
  it("skips full slots and respects lead time", () => {
    const booked = { "2026-10-07 10:00:00": 2, "2026-10-07 10:30:00": 1 };
    expect(nextFreeSlot(cfg, booked, "2026-10-06 18:00:00")).toBe("2026-10-07 10:30:00");
    expect(nextFreeSlot(cfg, booked, "2026-10-07 10:00:00", 60)).toBe("2026-10-07 11:00:00");
  });
  it("null when drive is full or over", () => {
    const full = Object.fromEntries(generateSlots(cfg).map((s) => [s, 2]));
    expect(nextFreeSlot(cfg, full, "2026-10-06 18:00:00")).toBeNull();
    expect(nextFreeSlot(cfg, {}, "2026-10-07 12:00:00")).toBeNull();
  });
  it("istAddMinutes crosses midnight", () => expect(istAddMinutes("2026-10-07 23:30:00", 60)).toBe("2026-10-08 00:30:00"));
  it("nowIst is +5:30 of UTC", () => expect(nowIst(new Date("2026-10-05T05:30:00Z"))).toBe("2026-10-05 11:00:00"));
});

describe("inviteTarget", () => {
  it("scales demand by hire and show rate", () => expect(inviteTarget({ openPositions: 7, showRatePct: 40, interviewToHirePct: 35, capacity: 100 })).toEqual({ targetShows: 20, invites: 50 }));
  it("caps at drive capacity", () => expect(inviteTarget({ openPositions: 50, showRatePct: 50, capacity: 24 })).toEqual({ targetShows: 24, invites: 48 }));
});

describe("assignSlots", () => {
  const day = { start: "10:00", end: "17:30", minutes: 30, perSlot: 6 }; // 15 slots x 6 = 90 seats
  const perSlot = (ts: string[]) => ts.reduce<Record<string, number>>((m, t) => ((m[t] = (m[t] ?? 0) + 1), m), {});
  it("spreads 60 people across the day, never above the per-slot limit", () => {
    const r = assignSlots(60, day);
    expect(r.times.length).toBe(60);
    expect(r.overflow).toBe(0);
    expect(Math.max(...Object.values(perSlot(r.times)))).toBeLessThanOrEqual(6);
    expect(Object.keys(perSlot(r.times)).length).toBe(15);
    expect(r.times[0]).toBe("10:00:00");
  });
  it("a small group is spread out, not piled into the first slot", () => {
    const r = assignSlots(5, day);
    expect(new Set(r.times).size).toBe(5);
  });
  it("reports overflow instead of over-booking", () => {
    const r = assignSlots(100, day);
    expect(r.times.length).toBe(90);
    expect(r.overflow).toBe(10);
    expect(Math.max(...Object.values(perSlot(r.times)))).toBe(6);
  });
  it("nothing to assign / no slots", () => {
    expect(assignSlots(0, day).times).toEqual([]);
    expect(assignSlots(3, { ...day, start: "18:00", end: "10:00" })).toMatchObject({ times: [], overflow: 3 });
  });
});

describe("daily plan numbers", () => {
  it("100 walk-ins at a 25% show rate = 400 invites over 15 slots of 27 (10:00-17:30, 30 min)", async () => {
    const { dailyPlanNumbers, DEFAULT_DAILY_PLAN } = await import("../he-slots.js");
    expect(dailyPlanNumbers(DEFAULT_DAILY_PLAN)).toEqual({ invites: 400, targetShows: 100, slots: 15, perSlot: 27, capacity: 405 });
  });
  it("the minimum outreach wins when it is larger than walk-ins / show rate", async () => {
    const { dailyPlanNumbers, DEFAULT_DAILY_PLAN } = await import("../he-slots.js");
    const n = dailyPlanNumbers({ ...DEFAULT_DAILY_PLAN, walkInsPerDay: 40, minOutreachPerDay: 400 });
    expect(n.invites).toBe(400);
    expect(n.targetShows).toBe(100);
  });
  it("a higher show rate needs fewer invites", async () => {
    const { dailyPlanNumbers, DEFAULT_DAILY_PLAN } = await import("../he-slots.js");
    expect(dailyPlanNumbers({ ...DEFAULT_DAILY_PLAN, minOutreachPerDay: 0, showRatePct: 50 }).invites).toBe(200);
  });
  it("seats per slot never exceed 50 and invites follow an explicit target, capped by the seats", async () => {
    const { dailyPlanNumbers, invitesForTarget, DEFAULT_DAILY_PLAN } = await import("../he-slots.js");
    expect(dailyPlanNumbers({ ...DEFAULT_DAILY_PLAN, minOutreachPerDay: 5000 }).perSlot).toBe(50);
    expect(invitesForTarget({ targetShows: 100, showRatePct: 25, capacity: 405 })).toEqual({ targetShows: 100, invites: 400 });
    expect(invitesForTarget({ targetShows: 100, showRatePct: 25, capacity: 112 }).invites).toBe(112);
  });
});

describe("next working day", () => {
  it("skips Sunday", async () => {
    const { nextWorkingDay } = await import("../he-plan.service.js");
    expect(nextWorkingDay(new Date("2026-10-07T06:00:00Z"))).toBe("2026-10-08"); // Wed -> Thu
    expect(nextWorkingDay(new Date("2026-10-10T06:00:00Z"))).toBe("2026-10-12"); // Sat -> Mon (Sunday skipped)
  });
});
