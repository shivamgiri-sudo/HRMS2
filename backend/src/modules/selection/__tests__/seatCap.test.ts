import { describe, expect, it } from "vitest";
import { applySeatCap, dailySeatCap, DEFAULT_INVITES_PER_SEAT } from "../seat-cap.js";

// WS3 D3: a requisition's preview picks at most ceil(seats left x invites per seat) new people a day (default 4 per seat), minus the
// people already approved or enrolled for it today. Picks over the cap are kept as 'capped' (tomorrow's run sees them again).
describe("dailySeatCap", () => {
  it("1 seat -> 4, 32 seats -> 128, a full requisition -> 0, minus today's approvals", () => {
    expect(DEFAULT_INVITES_PER_SEAT).toBe(4);
    expect(dailySeatCap({ seatsLeft: 1, perSeat: 4, alreadyToday: 0 })).toBe(4);
    expect(dailySeatCap({ seatsLeft: 32, perSeat: 4, alreadyToday: 0 })).toBe(128);
    expect(dailySeatCap({ seatsLeft: 0, perSeat: 4, alreadyToday: 0 })).toBe(0);
    expect(dailySeatCap({ seatsLeft: 3, perSeat: 2.5, alreadyToday: 2 })).toBe(6); // ceil(7.5) - 2
    expect(dailySeatCap({ seatsLeft: 1, perSeat: 4, alreadyToday: 9 })).toBe(0);
  });
});

describe("applySeatCap", () => {
  const row = (id: string, status: string, score: number, include = false) => ({ id, status, score, include });
  it("keeps the best picks (HR includes first, then score), caps the rest; review and excluded rows untouched", () => {
    const rows = [row("a", "picked", 50), row("b", "picked", 90), row("c", "review", 99), row("d", "picked", 70), row("e", "picked", 10, true), row("f", "excluded", 80)];
    const out = applySeatCap(rows, 2);
    expect(out.map((r) => [r.id, r.status])).toEqual([["a", "capped"], ["b", "picked"], ["c", "review"], ["d", "capped"], ["e", "picked"], ["f", "excluded"]]);
  });
  it("a cap above the picks changes nothing; ties keep the original order", () => {
    const rows = [row("a", "picked", 50), row("b", "picked", 50), row("c", "picked", 50)];
    expect(applySeatCap(rows, 10).map((r) => r.status)).toEqual(["picked", "picked", "picked"]);
    expect(applySeatCap(rows, 2).map((r) => r.status)).toEqual(["picked", "picked", "capped"]);
  });
});
