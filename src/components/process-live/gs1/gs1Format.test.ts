import { describe, expect, it } from "vitest";
import { chartValue, fmtCount, fmtDayShort, fmtMinutes, fmtPct, NA, NO_DATA } from "./gs1Format";

describe("gs1 display formatting", () => {
  it("shows No Data for an empty period and N/A for a not-applicable KPI", () => {
    expect(fmtCount(0, false)).toBe(NO_DATA);
    expect(fmtPct(null)).toBe(NA);
    expect(fmtPct(0)).toBe("0.0%");
    expect(fmtCount(null)).toBe(NA);
    expect(fmtCount(1234)).toBe("1,234");
  });

  it("formats minutes and dates", () => {
    expect(fmtMinutes(12.5)).toBe("12.5 min");
    expect(fmtMinutes(125)).toBe("2 h 05 min");
    expect(fmtMinutes(null)).toBe(NA);
    expect(fmtDayShort("2026-09-01")).toBe("01 Sep");
  });

  it("never turns N/A into a zero bar", () => {
    expect(chartValue(null)).toBeUndefined();
    expect(chartValue(0)).toBe(0);
  });
});
