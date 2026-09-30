import { describe, expect, it } from "vitest";
import { currentMonthIst, fmtDate, fmtMonth, fmtPct, fmtPoints, pctChange, recentMonths, scoreBand } from "./format";

describe("compliance format helpers", () => {
  it("formats dates DD/MM/YYYY without timezone drift", () => {
    expect(fmtDate("2026-09-01")).toBe("01/09/2026");
    expect(fmtDate("2026-09-01T18:30:00.000Z")).toBe("01/09/2026");
    expect(fmtDate(null)).toBe("—");
  });
  it("month label + recent months cross the year boundary", () => {
    expect(fmtMonth("2026-01")).toBe("Jan 2026");
    expect(recentMonths("2026-02", 4)).toEqual(["2026-02", "2026-01", "2025-12", "2025-11"]);
  });
  it("null percent is a dash, never 0% or 100%", () => {
    expect(fmtPct(null)).toBe("—");
    expect(fmtPct(99.9)).toBe("99.9%");
    expect(fmtPoints(null)).toBeNull();
    expect(fmtPoints(-2.5)).toBe("-2.5 pts");
  });
  it("pctChange has no baseline for 0/null (avoids Infinity/NaN)", () => {
    expect(pctChange(5, 0)).toBeUndefined();
    expect(pctChange(5, null)).toBeUndefined();
    expect(pctChange(15, 10)).toBe(50);
  });
  it("score bands carry a text label", () => {
    expect(scoreBand(null).label).toBe("No data");
    expect(scoreBand(90).tone).toBe("green");
    expect(scoreBand(74.9).tone).toBe("red");
  });
  it("current month is IST-based (UTC evening of the 30th is already the 1st in IST)", () => {
    expect(currentMonthIst(Date.UTC(2026, 8, 30, 19, 0))).toBe("2026-10");
  });
});
