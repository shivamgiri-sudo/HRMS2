import { describe, expect, it } from "vitest";
import { buildBins, buildCalendar, computeDrillStats, movingAverage, statusOn, trendLine, weekdayOf, type DrillReading } from "../metric-drill-model";

const r = (date: string, value: number | null, numerator: number | null = null, denominator: number | null = null): DrillReading => ({ date, value, numerator, denominator });

describe("metric-drill-model", () => {
  it("maps dates to Monday-first weekdays without timezone drift", () => {
    expect(weekdayOf("2026-09-07")).toBe(0); // Monday
    expect(weekdayOf("2026-09-13")).toBe(6); // Sunday
    expect(weekdayOf("2026-09-01")).toBe(1); // Tuesday
  });

  it("statusOn respects direction and missing targets", () => {
    expect(statusOn(91, 90, "higher_is_better")).toBe("pass");
    expect(statusOn(89, 90, "higher_is_better")).toBe("fail");
    expect(statusOn(280, 300, "lower_is_better")).toBe("pass");
    expect(statusOn(5, null, "higher_is_better")).toBe("none");
  });

  it("trend line: slope, r2, and refuses to fit fewer than 4 points", () => {
    const t = trendLine([1, 2, 3, 4, 5]);
    expect(t?.slope).toBeCloseTo(1); expect(t?.r2).toBeCloseTo(1);
    expect(trendLine([1, 2, 3])).toBeNull();
    expect(trendLine([5, 5, 5, 5])?.slope).toBeCloseTo(0);
  });

  it("moving average waits for 3 points", () => {
    const ma = movingAverage([1, 2, 3, 4], 3);
    expect(ma[0]).toBeNull(); expect(ma[1]).toBeNull(); expect(ma[2]).toBeCloseTo(2); expect(ma[3]).toBeCloseTo(3);
  });

  it("computes pass/fail days, streak, best and worst by direction", () => {
    const s = computeDrillStats({
      readings: [r("2026-09-01", 95), r("2026-09-02", 80), r("2026-09-03", 70), r("2026-09-04", 60), r("2026-09-05", null)],
      target: 90, direction: "higher_is_better",
    });
    expect(s.n).toBe(4);
    expect(s).toMatchObject({ passDays: 1, failDays: 3, passPct: 25 });
    expect(s.streak).toEqual({ status: "fail", length: 3 });
    expect(s.best?.value).toBe(95); expect(s.worst?.value).toBe(60);
    expect(s.latest?.gap).toBe(30);
    const lower = computeDrillStats({ readings: [r("2026-09-01", 200), r("2026-09-02", 400)], target: 300, direction: "lower_is_better" });
    expect(lower.best?.value).toBe(200); expect(lower.worst?.value).toBe(400);
  });

  it("sums volume from numerator and denominator", () => {
    const s = computeDrillStats({ readings: [r("2026-09-01", 50, 5, 10), r("2026-09-02", 50, 10, 20)], target: null, direction: null });
    expect(s.volumeTotal).toBe(30); expect(s.numeratorTotal).toBe(15); expect(s.volumeAvg).toBe(15);
  });

  it("calendar pads to whole Monday-first weeks and marks gaps", () => {
    const s = computeDrillStats({ readings: [r("2026-09-02", 1), r("2026-09-04", 2), r("2026-09-09", 3)], target: null, direction: null });
    const cal = buildCalendar(s.points);
    expect(cal).toHaveLength(2);
    expect(cal[0].map((c) => c.date)[0]).toBe("2026-08-31"); // Monday of the first week
    expect(cal[0][0].status).toBe("missing");                 // before the first reading
    expect(cal[0][2].status).toBe("none");                    // 2026-09-02 present, no target
    expect(cal[0][3].status).toBe("missing");                 // 2026-09-03 gap
    expect(cal.every((w) => w.length === 7)).toBe(true);
  });

  it("histogram covers every value and flags the target bin", () => {
    const bins = buildBins([10, 20, 30, 40, 50, 60, 70, 80], 65, 4);
    expect(bins.reduce((a, b) => a + b.count, 0)).toBe(8);
    expect(bins.filter((b) => b.hasTarget)).toHaveLength(1);
    expect(buildBins([1, 1, 1], null)).toEqual([]);
  });

  it("insights call out streaks, and say so plainly when there is no target", () => {
    const fail = computeDrillStats({ readings: ["01", "02", "03", "04", "05"].map((d, i) => r(`2026-09-${d}`, 50 + i)), target: 90, direction: "higher_is_better" });
    expect(fail.insights.some((i) => i.tone === "bad" && /in a row/.test(i.text))).toBe(true);
    const none = computeDrillStats({ readings: [r("2026-09-01", 1)], target: null, direction: null });
    expect(none.insights.some((i) => /No target is set/.test(i.text))).toBe(true);
    expect(none.insights.some((i) => /Only 1 reading/.test(i.text))).toBe(true);
  });
});
