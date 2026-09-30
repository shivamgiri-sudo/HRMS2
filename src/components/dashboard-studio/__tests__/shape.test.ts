import { describe, it, expect } from "vitest";
import { boxStats, frameRows, histogram, toFlow, toFrame, toMatrix, toPercentOfTotal, topN, toTable, waterfall } from "../shape";
import { delta, formatCategory, formatValue, axisTick } from "../format";
import { seriesColors, thresholdColor } from "../palettes";
import type { QueryResult, ResultColumn } from "../types";

const col = (key: string, kind: "dimension" | "measure", extra: Partial<ResultColumn> = {}): ResultColumn => ({ key, label: key, kind, format: kind === "measure" ? "number" : "text", dataType: "string", ...extra });
const res = (columns: ResultColumn[], rows: QueryResult["rows"]): QueryResult => ({ columns, rows, truncated: false, range: null, totals: {}, generatedAt: "" });

const oneDim = res([col("d0", "dimension"), col("m0", "measure"), col("m1", "measure")], [{ d0: "A", m0: 10, m1: 1 }, { d0: "B", m0: 30, m1: 2 }, { d0: "C", m0: 20, m1: null }]);
const twoDim = res([col("d0", "dimension"), col("d1", "dimension"), col("m0", "measure")], [
  { d0: "Jan", d1: "X", m0: 5 }, { d0: "Jan", d1: "Y", m0: 15 }, { d0: "Feb", d1: "X", m0: 10 },
]);

describe("toFrame", () => {
  it("one dimension: a series per measure", () => {
    const f = toFrame(oneDim);
    expect(f.categories).toEqual(["A", "B", "C"]);
    expect(f.series.map((s) => s.values)).toEqual([[10, 30, 20], [1, 2, null]]);
    expect(frameRows(f)[1]).toMatchObject({ name: "B", m0: 30, m1: 2, __raw: "B" });
  });
  it("two dimensions: second becomes the series, gaps are null", () => {
    const f = toFrame(twoDim);
    expect(f.categories).toEqual(["Jan", "Feb"]);
    expect(f.series.map((s) => [s.label, s.values])).toEqual([["X", [5, 10]], ["Y", [15, null]]]);
  });
  it("no dimension: one Total category", () => {
    const f = toFrame(res([col("m0", "measure")], [{ m0: 42 }]));
    expect(f.categories).toEqual(["Total"]); expect(f.series[0].values).toEqual([42]);
  });
  it("caps pivoted series at 12 with Other", () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ d0: "A", d1: `S${i}`, m0: 20 - i }));
    const f = toFrame(res([col("d0", "dimension"), col("d1", "dimension"), col("m0", "measure")], rows));
    expect(f.series).toHaveLength(12);
    expect(f.series[11].label).toBe("Other");
    expect(f.series[11].values[0]).toBe(9 + 8 + 7 + 6 + 5 + 4 + 3 + 2 + 1);
  });
});

describe("transforms", () => {
  it("topN keeps the largest and sums the rest", () => {
    const f = topN(toFrame(oneDim), 2);
    expect(f.categories).toEqual(["B", "C", "Other"]);
    expect(f.series[0].values).toEqual([30, 20, 10]);
    expect(topN(toFrame(oneDim), 0).categories).toHaveLength(3);
  });
  it("percent of total per category", () => {
    const f = toPercentOfTotal(toFrame(twoDim));
    expect(f.series[0].values[0]).toBeCloseTo(25); expect(f.series[1].values[0]).toBeCloseTo(75); expect(f.series[0].values[1]).toBeCloseTo(100);
  });
  it("histogram bins cover every value", () => {
    const b = histogram([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3);
    expect(b).toHaveLength(3); expect(b.reduce((a, x) => a + x.count, 0)).toBe(10);
    expect(histogram([5])).toEqual([]);
  });
  it("box stats", () => {
    const s = boxStats(toFrame(res([col("d0", "dimension"), col("m0", "measure")], [1, 2, 3, 4, 5].map((v) => ({ d0: String(v), m0: v })))));
    expect(s[0]).toMatchObject({ min: 1, q1: 2, median: 3, q3: 4, max: 5, n: 5 });
  });
  it("waterfall running total with a closing bar", () => {
    const w = waterfall(toFrame(res([col("d0", "dimension"), col("m0", "measure")], [{ d0: "a", m0: 10 }, { d0: "b", m0: -4 }])));
    expect(w.map((x) => [x.name, x.base, x.value, x.kind])).toEqual([["a", 0, 10, "up"], ["b", 6, 4, "down"], ["Total", 0, 6, "total"]]);
  });
  it("matrix and flow from two dimensions", () => {
    const m = toMatrix(twoDim);
    expect(m.rows).toEqual(["Jan", "Feb"]); expect(m.cols).toEqual(["X", "Y"]); expect(m.cells).toEqual([[5, 15], [10, null]]); expect([m.min, m.max]).toEqual([5, 15]);
    const g = toFlow(twoDim);
    expect(g.nodes.map((n) => n.name)).toEqual(["Jan", "X", "Y", "Feb"]); expect(g.links).toHaveLength(3);
  });
  it("matrix sorts time-bucket columns in order", () => {
    const r = res([col("d0", "dimension"), col("d1", "dimension", { grain: "hour" }), col("m0", "measure")], [
      { d0: "Mon", d1: 10, m0: 1 }, { d0: "Mon", d1: 11, m0: 2 }, { d0: "Tue", d1: 9, m0: 3 }, { d0: "Tue", d1: 10, m0: 4 },
    ]);
    const m = toMatrix(r);
    expect(m.cols).toEqual(["09:00", "10:00", "11:00"]);
    expect(m.cells).toEqual([[null, 1, 2], [3, 4, null]]);
  });
  it("table export labels dimensions", () => {
    const t = toTable(res([col("d0", "dimension", { grain: "weekday" }), col("m0", "measure")], [{ d0: 0, m0: 3 }]));
    expect(t.rows).toEqual([["Mon", 3]]);
  });
});

describe("format", () => {
  it("numbers, currency, percent, duration", () => {
    expect(formatValue(1234567.891, "currency")).toBe("₹12,34,568");
    expect(formatValue(1234567, "number", { compact: true })).toBe("12.3L");
    expect(formatValue(12.345, "percent")).toBe("12.3%");
    expect(formatValue(75, "duration")).toBe("75s");
    expect(formatValue(3725, "duration")).toBe("1h 02m");
    expect(formatValue(null, "number")).toBe("—");
    expect(formatValue(5, "integer", { prefix: "~", suffix: " calls" })).toBe("~5 calls");
  });
  it("axis ticks are short", () => { expect(axisTick(1200000, "number")).toBe("12L"); expect(axisTick(45.5, "percent")).toBe("45.5%"); });
  it("categories by grain", () => {
    expect(formatCategory("2026-09-01", { grain: "month", format: "date", dataType: "date" })).toBe("Sep 2026");
    expect(formatCategory("2026-09-07", { grain: "week", format: "date", dataType: "date" })).toBe("w/c 7 Sep");
    expect(formatCategory(9, { grain: "hour", format: "date", dataType: "date" })).toBe("09:00");
    expect(formatCategory(null)).toBe("(blank)");
    expect(formatCategory("2026-09-01", { format: "text", dataType: "string" })).toBe("2026-09-01");
  });
  it("delta knows good from bad", () => {
    expect(delta(110, 100)).toMatchObject({ text: "+10.0%", good: true });
    expect(delta(110, 100, false)).toMatchObject({ good: false });
    expect(delta(5, 0)).toBeNull();
  });
});

describe("palettes", () => {
  it("per-series overrides win and the palette cycles", () => {
    const c = seriesColors({ palette: "mono", colors: ["#ff0000"] }, 10);
    expect(c[0]).toBe("#ff0000"); expect(c).toHaveLength(10); expect(c[9]).toBe(c[1]);
  });
  it("threshold colour is the highest threshold reached", () => {
    const st = { thresholds: [{ value: 80, color: "green" }, { value: 50, color: "amber" }] };
    expect(thresholdColor(st, 90)).toBe("green"); expect(thresholdColor(st, 60)).toBe("amber"); expect(thresholdColor(st, 10)).toBeNull();
  });
});
