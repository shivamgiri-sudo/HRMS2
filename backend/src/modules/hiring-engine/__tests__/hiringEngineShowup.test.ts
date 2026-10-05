import { describe, expect, it } from "vitest";
import { invitesToClose, learnMultiplier, learnRate, pShow } from "../he-showup.js";

const base = { state: "invited", walkedBefore: false, pastNoShows: 0, distanceKm: 5, sharedLocation: false, repliedPositive: false };
describe("show-up model", () => {
  it("confirmed > invited; location sharing and history move it", () => {
    expect(pShow({ ...base, state: "confirmed" })).toBeGreaterThan(pShow(base));
    expect(pShow({ ...base, state: "confirmed", sharedLocation: true })).toBeGreaterThan(pShow({ ...base, state: "confirmed" }));
    expect(pShow({ ...base, pastNoShows: 2 })).toBeLessThan(pShow(base));
    expect(pShow({ ...base, distanceKm: 30 })).toBeLessThan(pShow(base));
  });
  it("learned parameters override defaults", () => {
    expect(pShow(base, { "show.base.invited": 0.5 })).toBe(0.5);
  });
  it("overbooking: invites needed to close the gap", () => {
    expect(invitesToClose(10, 4, 0.3)).toBe(20);
    expect(invitesToClose(10, 12, 0.3)).toBe(0);
  });
  it("learning needs a minimum sample", () => {
    expect(learnRate(10, 20)).toBeNull();
    expect(learnRate(15, 50)).toBe(0.3);
    expect(learnMultiplier(30, 50, 0.3)).toBe(2);
  });
});
