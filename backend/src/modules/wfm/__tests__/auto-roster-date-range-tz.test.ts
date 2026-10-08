import { describe, expect, it } from "vitest";
import { dateRange } from "../auto-roster-synced.service.js";

/**
 * dateRange() (auto-roster-synced.service.ts — the LIVE roster generation engine,
 * 413,386 real assignment rows at audit time) built dates via the local-timezone Date
 * constructor then read them back through toISOString(). On this server (Asia/Kolkata,
 * UTC+5:30), that silently returned every date one day earlier than the startDate/
 * endDate strings it was given — the same bug class already fixed in
 * roster-generation.service.ts's getDatesInRange, found while testing that fix and
 * checked here too since this file drives the engine that actually holds live data.
 */
describe("dateRange returns exactly the requested dates, timezone-independent", () => {
  it("returns the literal start/end dates as the first and last entries", () => {
    const dates = dateRange("2026-08-17", "2026-08-23");
    expect(dates[0]).toBe("2026-08-17");
    expect(dates[dates.length - 1]).toBe("2026-08-23");
  });

  it("returns every date in a 7-day range with none shifted", () => {
    const dates = dateRange("2026-08-17", "2026-08-23");
    expect(dates).toEqual([
      "2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20",
      "2026-08-21", "2026-08-22", "2026-08-23",
    ]);
  });

  it("returns exactly one date for a single-day range", () => {
    expect(dateRange("2026-08-17", "2026-08-17")).toEqual(["2026-08-17"]);
  });

  it("handles a month boundary correctly", () => {
    expect(dateRange("2026-08-30", "2026-09-02")).toEqual([
      "2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02",
    ]);
  });
});
