import { describe, expect, it } from "vitest";
import { ANALYST_WEEKLY_MAX_WEEKS, splitIntoWeeks } from "../onfido-analyst-report.service";

describe("splitIntoWeeks", () => {
  it("splits a month into Monday-start weeks clipped to the range", () => {
    const weeks = splitIntoWeeks("2026-08-01", "2026-08-31");
    expect(weeks[0]).toEqual({ start: "2026-08-01", end: "2026-08-02", label: "WC 27 Jul", monday: "2026-07-27" });
    expect(weeks[1]).toEqual({ start: "2026-08-03", end: "2026-08-09", label: "WC 03 Aug", monday: "2026-08-03" });
    expect(weeks[weeks.length - 1].end).toBe("2026-08-31");
  });

  it("returns a single clipped week for a one-day range", () => {
    expect(splitIntoWeeks("2026-08-05", "2026-08-05")).toEqual([{ start: "2026-08-05", end: "2026-08-05", label: "WC 03 Aug", monday: "2026-08-03" }]);
  });

  it("caps the number of weeks", () => {
    expect(splitIntoWeeks("2026-01-01", "2026-12-31")).toHaveLength(ANALYST_WEEKLY_MAX_WEEKS);
  });
});
