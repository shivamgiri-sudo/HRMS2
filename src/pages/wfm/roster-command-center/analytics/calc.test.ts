import { describe, it, expect } from "vitest";
import { buildInsights, correlationView, currentWeekStart, fmtDate, fmtDateTime, formatINR, formatINRCompact, previousMonth, recentPeriods, share, shiftWeek, shrinkageTone, sortRows } from "./calc";
import type { ShrinkageIntelligence } from "./types";

describe("formatting", () => {
  it("uses the Indian digit grouping", () => {
    expect(formatINR(1234567)).toBe("₹12,34,567");
    expect(formatINR(null)).toBe("—");
    expect(formatINR(NaN)).toBe("—");
  });
  it("compacts to K / L / Cr", () => {
    expect(formatINRCompact(950)).toBe("₹950");
    expect(formatINRCompact(12500)).toBe("₹12.5K");
    expect(formatINRCompact(250000)).toBe("₹2.50L");
    expect(formatINRCompact(31000000)).toBe("₹3.10Cr");
    expect(formatINRCompact(-250000)).toBe("-₹2.50L");
  });
  it("formats dates DD/MM/YYYY and DD/MM/YYYY HH:mm", () => {
    expect(fmtDate("2026-09-28")).toBe("28/09/2026");
    expect(fmtDateTime("2026-09-28 09:05:00")).toBe("28/09/2026 09:05");
    expect(fmtDate(null)).toBe("—");
  });
});

describe("periods", () => {
  it("previousMonth has no overflow on the 31st", () => {
    expect(previousMonth(new Date(2026, 9, 31))).toBe("2026-09");
    expect(previousMonth(new Date(2026, 2, 31))).toBe("2026-02");
    expect(previousMonth(new Date(2026, 0, 5))).toBe("2025-12");
  });
  it("currentWeekStart is the local Monday (even just after midnight)", () => {
    expect(currentWeekStart(new Date(2026, 8, 28, 0, 20))).toBe("2026-09-28");
    expect(currentWeekStart(new Date(2026, 8, 27, 23, 59))).toBe("2026-09-21");
  });
  it("recentPeriods walks back across the year boundary", () => {
    expect(recentPeriods(3, new Date(2026, 0, 10))).toEqual(["2026-01", "2025-12", "2025-11"]);
  });
  it("shiftWeek moves by whole weeks across month ends", () => {
    expect(shiftWeek("2026-09-28", 1)).toBe("2026-10-05");
    expect(shiftWeek("2026-09-28", -1)).toBe("2026-09-21");
  });
});

describe("correlationView", () => {
  it("fills the ring by |r| and colours by sign", () => {
    expect(correlationView(0.45, false)).toMatchObject({ ringPct: 45, tone: "green", label: "Moderate positive" });
    expect(correlationView(-0.8, false)).toMatchObject({ ringPct: 80, tone: "red", label: "Strong negative" });
    expect(correlationView(0.1, false)).toMatchObject({ tone: "amber", label: "Weak" });
    expect(correlationView(0, true).label).toBe("Insufficient data");
  });
});

describe("shrinkageTone / share / sort", () => {
  it("tones against budget", () => {
    expect(shrinkageTone(9, 8)).toBe("red");
    expect(shrinkageTone(7, 8)).toBe("amber");
    expect(shrinkageTone(3, 8)).toBe("green");
  });
  it("share never returns NaN", () => {
    expect(share(1, 0)).toBe(0);
    expect(share(1, 8)).toBe(12.5);
  });
  it("sorts numbers and strings, nulls last", () => {
    const rows = [{ n: 2, s: "b" }, { n: null, s: "a" }, { n: 5, s: "c" }];
    expect(sortRows(rows, (r) => r.n, "desc").map((r) => r.n)).toEqual([5, 2, null]);
    expect(sortRows(rows, (r) => r.n, "asc").map((r) => r.n)).toEqual([2, 5, null]);
    expect(sortRows(rows, (r) => r.s, "asc").map((r) => r.s)).toEqual(["a", "b", "c"]);
  });
});

describe("buildInsights", () => {
  const base = {
    breakdown: { total: { count: 1, pct: 13 } }, budgetPct: 8, varianceFromBudget: 5, trendVsPrevWeek: 3,
    dayOfWeekPattern: [{ day: "Monday", shrinkagePct: 20, isHighRisk: true }],
  } as unknown as ShrinkageIntelligence;
  it("orders critical before warning before info", () => {
    const out = buildInsights(base, undefined, undefined, undefined);
    expect(out.map((i) => i.severity)).toEqual(["critical", "warning", "info"]);
  });
  it("is empty with no data", () => {
    expect(buildInsights(undefined, undefined, undefined, undefined)).toEqual([]);
  });
});
