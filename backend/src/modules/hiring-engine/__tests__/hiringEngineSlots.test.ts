import { describe, expect, it } from "vitest";
import { driveCapacity, generateSlots, inviteTarget, istAddMinutes, nextFreeSlot, nowIst } from "../he-slots.js";

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
