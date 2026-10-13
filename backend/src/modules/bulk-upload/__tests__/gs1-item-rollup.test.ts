import { describe, expect, it } from "vitest";
import { bumpCount, capCountMap, durationStats, hasValue, normalizeLabel, parseDurationMinutes } from "../gs1-item-rollup.js";

describe("gs1 item roll-up helpers", () => {
  it("normalises labels and counts blanks", () => {
    expect(normalizeLabel("  0-15 ")).toBe("0-15");
    expect(normalizeLabel("")).toBe("(blank)");
    const m = {};
    bumpCount(m, "Closed"); bumpCount(m, " Closed "); bumpCount(m, null);
    expect(m).toEqual({ Closed: 2, "(blank)": 1 });
  });

  it("caps large label maps into (other)", () => {
    expect(capCountMap({ a: 5, b: 3, c: 1, d: 1 }, 2)).toEqual({ a: 5, b: 3, "(other)": 2 });
  });

  it("parses durations to minutes", () => {
    expect(parseDurationMinutes("0:12:30")).toBe(12.5);
    expect(parseDurationMinutes("1:05")).toBe(65);
    expect(parseDurationMinutes("0.5")).toBe(720);
    expect(parseDurationMinutes("18")).toBe(18);
    expect(parseDurationMinutes("")).toBeNull();
    expect(parseDurationMinutes("abc")).toBeNull();
    expect(parseDurationMinutes("99999")).toBeNull();
  });

  it("duration stats and completion markers", () => {
    expect(durationStats(30, 3)).toEqual([10, 3]);
    expect(durationStats(0, 0)).toEqual([null, 0]);
    expect(hasValue(" 2-Sep-26")).toBe(true);
    expect(hasValue("  ")).toBe(false);
  });
});
