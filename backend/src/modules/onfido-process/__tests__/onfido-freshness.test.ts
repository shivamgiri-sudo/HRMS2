import { describe, expect, it } from "vitest";
import { findGapMonths } from "../onfido-freshness.service";

describe("findGapMonths", () => {
  it("finds a month with no data between two months that have data", () => {
    expect(findGapMonths(["2026-07", "2026-09"])).toEqual(["2026-08"]);
  });

  it("handles a year boundary and several gaps", () => {
    expect(findGapMonths(["2025-11", "2026-02"])).toEqual(["2025-12", "2026-01"]);
  });

  it("reports nothing for contiguous months or fewer than two", () => {
    expect(findGapMonths(["2026-07", "2026-08", "2026-09"])).toEqual([]);
    expect(findGapMonths(["2026-09"])).toEqual([]);
    expect(findGapMonths([])).toEqual([]);
  });
});
