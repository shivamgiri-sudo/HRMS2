import { describe, it, expect } from "vitest";
import { DEFAULT_RATING_BANDS } from "../kpi-catalogue.resolve.js";
import { aggregate, attainmentPct, availabilityFor, buildBreakdown, buildSeries, scaledTotalTarget, stalenessDays, windowFor } from "../kpi-performance.calc.js";

describe("windowFor", () => {
  it("builds today / yesterday / wtd / mtd / last30", () => {
    expect(windowFor("today", "2026-10-01")).toMatchObject({ from: "2026-10-01", to: "2026-10-01", days: 1 });
    expect(windowFor("yesterday", "2026-10-01")).toMatchObject({ from: "2026-09-30", to: "2026-09-30" });
    expect(windowFor("mtd", "2026-10-15")).toMatchObject({ from: "2026-10-01", to: "2026-10-15", days: 15 });
    expect(windowFor("last30", "2026-10-31")).toMatchObject({ from: "2026-10-02", days: 30 });
  });
  it("week-to-date starts on Monday", () => {
    // 2026-10-01 is a Thursday
    expect(windowFor("wtd", "2026-10-01").from).toBe("2026-09-28");
    expect(windowFor("wtd", "2026-09-28").from).toBe("2026-09-28");
  });
  it("custom validates and caps the window", () => {
    expect(() => windowFor("custom", "2026-10-01")).toThrow(/from and to/);
    expect(() => windowFor("custom", "2026-10-01", "2026-10-05", "2026-10-01")).toThrow(/on or after/);
    expect(() => windowFor("custom", "2026-10-01", "2026-01-01", "2026-10-01")).toThrow(/at most 93/);
    expect(windowFor("custom", "2026-10-01", "2026-09-01", "2026-09-30").days).toBe(30);
  });
});

describe("aggregate", () => {
  it("averages, sums, takes last, and never turns empty into 0", () => {
    expect(aggregate([2, 4, 6], "average")).toBe(4);
    expect(aggregate([2, 4, 6], "sum")).toBe(12);
    expect(aggregate([2, 4, 6], "last")).toBe(6);
    expect(aggregate([2, 4, 6], "min")).toBe(2);
    expect(aggregate([null, undefined], "average")).toBeNull();
    expect(aggregate([], "sum")).toBeNull();
  });
  it("ignores nulls but keeps real zeros", () => {
    expect(aggregate([0, null, 10], "average")).toBe(5);
  });
});

describe("attainmentPct", () => {
  it("higher is better: actual / target, capped at 120", () => {
    expect(attainmentPct(80, 100, "higher_is_better")).toBe(80);
    expect(attainmentPct(300, 100, "higher_is_better")).toBe(120);
  });
  it("lower is better (e.g. talk time, AHT): target / actual, 100 when actual is 0", () => {
    expect(attainmentPct(200, 100, "lower_is_better")).toBe(50);
    expect(attainmentPct(50, 100, "lower_is_better")).toBe(120);
    expect(attainmentPct(0, 100, "lower_is_better")).toBe(100);
  });
  it("no target or no actual means no score", () => {
    expect(attainmentPct(null, 100, "higher_is_better")).toBeNull();
    expect(attainmentPct(80, null, "higher_is_better")).toBeNull();
    expect(attainmentPct(80, 0, "higher_is_better")).toBeNull();
  });
});

describe("series and breakdown", () => {
  const rows = [
    { date: "2026-10-01", employeeId: "a", value: 10, groupKey: "a", groupLabel: "A" },
    { date: "2026-10-02", employeeId: "a", value: 20, groupKey: "a", groupLabel: "A" },
    { date: "2026-10-01", employeeId: "b", value: 30, groupKey: "b", groupLabel: "B" },
  ];
  it("series fills every day of the window and leaves empty days null", () => {
    const s = buildSeries(rows, "average", { from: "2026-10-01", to: "2026-10-03" });
    expect(s).toEqual([{ date: "2026-10-01", value: 20 }, { date: "2026-10-02", value: 20 }, { date: "2026-10-03", value: null }]);
  });
  it("series sums across employees for volume metrics", () => {
    expect(buildSeries(rows, "sum", { from: "2026-10-01", to: "2026-10-01" })[0].value).toBe(40);
  });
  it("breakdown lists worst attainment first and rates each group", () => {
    const b = buildBreakdown(rows, "average", 20, "higher_is_better", DEFAULT_RATING_BANDS);
    expect(b.map((x) => x.key)).toEqual(["a", "b"]); // a: avg 15 -> 75, b: 30 -> 120
    expect(b[0]).toMatchObject({ value: 15, attainmentPct: 75, rating: "B", samples: 2 });
    expect(b[1]).toMatchObject({ attainmentPct: 120, rating: "S" });
  });
  it("a group with no target has no rating", () => {
    const b = buildBreakdown(rows, "average", null, "higher_is_better", DEFAULT_RATING_BANDS);
    expect(b.every((x) => x.attainmentPct === null && x.rating === null)).toBe(true);
  });
});

describe("availability and staleness", () => {
  it("separates not_tracked, no_data and ok", () => {
    expect(availabilityFor({ mapped: false, hasData: true, rowCount: 5 })).toBe("not_tracked");
    expect(availabilityFor({ mapped: true, hasData: false, rowCount: 0 })).toBe("not_tracked");
    expect(availabilityFor({ mapped: true, hasData: true, rowCount: 0 })).toBe("no_data");
    expect(availabilityFor({ mapped: true, hasData: true, rowCount: 3 })).toBe("ok");
  });
  it("counts staleness in days", () => {
    expect(stalenessDays("2026-09-28", "2026-10-01")).toBe(3);
    expect(stalenessDays(null, "2026-10-01")).toBeNull();
  });
});

describe("volume KPIs are scored against target x worked days", () => {
  it("scales a per-day target by employee-days", () => {
    expect(scaledTotalTarget(80, 100)).toBe(8000);
    expect(scaledTotalTarget(null, 100)).toBeNull();
    expect(scaledTotalTarget(80, 0)).toBeNull();
  });
  it("breakdown scores each group against target x its own days (sum metrics)", () => {
    const rows = [
      { date: "2026-10-01", employeeId: "a", value: 60, groupKey: "a", groupLabel: "A" },
      { date: "2026-10-02", employeeId: "a", value: 100, groupKey: "a", groupLabel: "A" },
      { date: "2026-10-01", employeeId: "b", value: 40, groupKey: "b", groupLabel: "B" },
    ];
    const b = buildBreakdown(rows, "sum", 80, "higher_is_better", DEFAULT_RATING_BANDS, 200, true);
    const a = b.find((x) => x.key === "a")!, bb = b.find((x) => x.key === "b")!;
    expect(a).toMatchObject({ value: 160, target: 160, attainmentPct: 100, rating: "S" });
    expect(bb).toMatchObject({ value: 40, target: 80, attainmentPct: 50, rating: "D" });
  });
});
