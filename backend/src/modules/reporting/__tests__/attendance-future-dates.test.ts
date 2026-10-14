import { describe, expect, it } from "vitest";
import { capAtToday, todayIst } from "../executors/types.js";

/**
 * A day-by-day attendance report must not run past today (report-library complaint 2026-10-14:
 * "filters are not filtering — upcoming future dates are still shown").
 */
describe("capAtToday / todayIst", () => {
  // 2026-10-14 20:00 UTC is already 2026-10-15 01:30 in India.
  const lateUtc = new Date("2026-10-14T20:00:00Z");

  it("todayIst follows the Indian calendar, not UTC", () => {
    expect(todayIst(lateUtc)).toBe("2026-10-15");
    expect(todayIst(new Date("2026-10-14T05:00:00Z"))).toBe("2026-10-14");
  });

  it("caps a future end date at today", () => {
    expect(capAtToday("2026-10-31", lateUtc)).toBe("2026-10-15");
  });

  it("leaves a past or current date alone", () => {
    expect(capAtToday("2026-10-01", lateUtc)).toBe("2026-10-01");
    expect(capAtToday("2026-10-15", lateUtc)).toBe("2026-10-15");
  });

  it("a range wholly in the future ends up with from > to, which selects nothing", () => {
    const from = "2026-10-20";
    const to = capAtToday("2026-10-31", lateUtc);
    expect(from > to).toBe(true);
  });
});
