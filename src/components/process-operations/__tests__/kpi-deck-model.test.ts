import { describe, expect, it } from "vitest";
import {
  cellStatus, dailyHealth, deltaOf, formatValue, freshnessOf, gapRatio, gapText, rankWorstFirst, statusOf, summarize,
  type DeckReading,
} from "../kpi-deck-model";

const mk = (o: Partial<DeckReading>): DeckReading => ({
  metricKey: "M", label: "Metric", unit: "percentage", direction: "higher_is_better", value: 80, staleDays: 0, latestDate: "2026-09-10",
  provisional: false, priorValue: null, targetValue: 90, trend: [], numerator: null, denominator: null, source: "connector", computedAt: null, ...o,
});
const tr = (pairs: Array<[string, number | null]>) => pairs.map(([date, value]) => ({ date, value, numerator: null, denominator: null }));

describe("kpi-deck-model", () => {
  it("status respects direction and never guesses without a target", () => {
    expect(statusOf(mk({ value: 91 }))).toBe("pass");
    expect(statusOf(mk({ value: 89.9 }))).toBe("fail");
    expect(statusOf(mk({ direction: "lower_is_better", unit: "seconds", value: 250, targetValue: 300 }))).toBe("pass");
    expect(statusOf(mk({ direction: "lower_is_better", value: 310, targetValue: 300 }))).toBe("fail");
    expect(statusOf(mk({ targetValue: null }))).toBe("none");
    expect(statusOf(mk({ direction: null }))).toBe("none");
    expect(statusOf(mk({ value: null }))).toBe("nodata");
  });

  it("gap is comparable across units and signed (positive = worse)", () => {
    expect(gapRatio(mk({ value: 45, targetValue: 90 }))).toBeCloseTo(0.5);
    expect(gapRatio(mk({ direction: "lower_is_better", unit: "seconds", value: 360, targetValue: 300 }))).toBeCloseTo(0.2);
    expect(gapRatio(mk({ value: 99, targetValue: 90 }))).toBeLessThan(0);
    expect(gapRatio(mk({ targetValue: null }))).toBeNull();
    expect(gapText(mk({ value: 51.4, targetValue: 90 }))).toBe("38.6 pt short");
  });

  it("formats units the way the page does", () => {
    expect(formatValue(85.66, "percentage")).toBe("85.7%");
    expect(formatValue(216, "seconds")).toBe("3m 36s");
    expect(formatValue(45, "seconds")).toBe("45s");
    expect(formatValue(39827.5, "currency")).toBe("₹39,828");
    expect(formatValue(740, "count")).toBe("740");
    expect(formatValue(null, "count")).toBe("—");
  });

  it("delta direction turns good/bad by metric direction", () => {
    expect(deltaOf(mk({ value: 92, priorValue: 90 }))).toMatchObject({ text: "▲ 2.0 pt", good: true });
    expect(deltaOf(mk({ direction: "lower_is_better", unit: "seconds", value: 320, priorValue: 300 }))).toMatchObject({ text: "▲ 20s", good: false });
    expect(deltaOf(mk({ value: 90, priorValue: 90.01 }))?.flat).toBe(true);
    expect(deltaOf(mk({ priorValue: null }))).toBeNull();
  });

  it("summarises health over targeted metrics only", () => {
    const h = summarize([mk({ value: 95 }), mk({ value: 10 }), mk({ value: 10 }), mk({ targetValue: null }), mk({ value: null })]);
    expect(h).toMatchObject({ pass: 1, fail: 2, none: 1, nodata: 1, targeted: 3, score: 33 });
    expect(summarize([mk({ targetValue: null })]).score).toBeNull();
  });

  it("detects a stopped feed from the freshest metric, not the average", () => {
    const f = freshnessOf([mk({ staleDays: 19, latestDate: "2026-09-10" }), mk({ staleDays: 20, latestDate: "2026-09-09" })], 3);
    expect(f).toMatchObject({ feedStopped: true, newestAgeDays: 19, newestDate: "2026-09-10", staleMetrics: 2 });
    expect(freshnessOf([mk({ staleDays: 19 }), mk({ staleDays: 1 })], 3).feedStopped).toBe(false);
    expect(freshnessOf([mk({ value: null })], 3).feedStopped).toBe(false);
  });

  it("builds the per-day health series and cell statuses", () => {
    const a = mk({ trend: tr([["2026-09-01", 95], ["2026-09-02", 80]]) });
    const b = mk({ trend: tr([["2026-09-01", 95], ["2026-09-02", 95]]) });
    const untargeted = mk({ targetValue: null, trend: tr([["2026-09-01", 1]]) });
    expect(dailyHealth([a, b, untargeted])).toEqual([
      { date: "2026-09-01", pass: 2, fail: 0, pct: 100 },
      { date: "2026-09-02", pass: 1, fail: 1, pct: 50 },
    ]);
    expect(cellStatus(a, "2026-09-02")).toBe("fail");
    expect(cellStatus(a, "2026-09-05")).toBe("missing");
    expect(cellStatus(untargeted, "2026-09-01")).toBe("none");
  });

  it("ranks failing first by relative gap, then passing, then targetless", () => {
    const worst = mk({ metricKey: "W", label: "W", value: 45 });
    const bad = mk({ metricKey: "B", label: "B", value: 80 });
    const ok = mk({ metricKey: "O", label: "O", value: 95 });
    const none = mk({ metricKey: "N", label: "N", targetValue: null });
    expect(rankWorstFirst([none, ok, bad, worst]).map((m) => m.metricKey)).toEqual(["W", "B", "O", "N"]);
  });
});
