import { describe, expect, it } from "vitest";
import { availableViews, defaultView, isShareOfWhole, seriesDelta } from "../matrixChartState";

describe("seriesDelta", () => {
  it("compares the latest value with the previous non-null one", () => {
    expect(seriesDelta([1, null, 3, 4])).toEqual({
      latest: 4,
      previous: 3,
      change: 1,
      pct: (1 / 3) * 100,
    });
  });

  it("skips trailing nulls: the latest is the last real value", () => {
    expect(seriesDelta([2, 5, null])).toEqual({
      latest: 5,
      previous: 2,
      change: 3,
      pct: 150,
    });
  });

  it("has no previous value when only one point exists", () => {
    expect(seriesDelta([null, 7])).toEqual({
      latest: 7,
      previous: null,
      change: null,
      pct: null,
    });
  });

  it("gives a change but no percentage when the previous value is zero", () => {
    expect(seriesDelta([0, 4])).toEqual({
      latest: 4,
      previous: 0,
      change: 4,
      pct: null,
    });
  });

  it("handles a decrease with a negative change and percentage", () => {
    expect(seriesDelta([10, 5])).toEqual({
      latest: 5,
      previous: 10,
      change: -5,
      pct: -50,
    });
  });

  it("is null when there is no data at all", () => {
    expect(seriesDelta([])).toBeNull();
    expect(seriesDelta([null, null])).toBeNull();
  });
});

describe("availableViews", () => {
  it("offers all four views for a many-series percent chart whose series are shares of a whole", () => {
    expect(availableViews({ rows: 9, dual: false, unit: "percent", partsOfWhole: true })).toEqual([
      "lines",
      "bars",
      "stacked",
      "multiples",
    ]);
  });

  it("does not stack percentage rates that are not shares of a whole (error %, shrinkage %)", () => {
    expect(availableViews({ rows: 9, dual: false, unit: "percent" })).toEqual(["lines", "bars", "multiples"]);
    expect(availableViews({ rows: 9, dual: false, unit: "percent", partsOfWhole: false })).not.toContain("stacked");
  });

  it("offers stacked for counts too", () => {
    expect(availableViews({ rows: 6, dual: false, unit: "count" })).toContain(
      "stacked",
    );
  });

  it("never offers stacked for seconds (stacking AHT is meaningless)", () => {
    expect(availableViews({ rows: 6, dual: false, unit: "seconds" })).toEqual([
      "lines",
      "bars",
      "multiples",
    ]);
  });

  it("offers only lines and small multiples on a dual-axis chart", () => {
    expect(availableViews({ rows: 2, dual: true, unit: "seconds" })).toEqual([
      "lines",
      "multiples",
    ]);
  });

  it("offers no small multiples or stacking for a single series", () => {
    expect(availableViews({ rows: 1, dual: false, unit: "percent" })).toEqual([
      "lines",
      "bars",
    ]);
  });
});

describe("defaultView", () => {
  it("opens many-series charts as small multiples, where lines would overlap", () => {
    expect(defaultView({ rows: 9, dual: false, unit: "percent" })).toBe(
      "multiples",
    );
    expect(defaultView({ rows: 5, dual: false, unit: "count" })).toBe(
      "multiples",
    );
  });

  it("keeps the familiar line chart for a handful of series", () => {
    expect(defaultView({ rows: 4, dual: false, unit: "percent" })).toBe(
      "lines",
    );
    expect(defaultView({ rows: 2, dual: true, unit: "seconds" })).toBe("lines");
    expect(defaultView({ rows: 1, dual: false, unit: "percent" })).toBe(
      "lines",
    );
  });
});

describe("isShareOfWhole", () => {
  const m = (rows: (number | null)[][]) => ({
    buckets: rows[0].map((_, i) => `b${i}`),
    rows: rows.map((values, i) => ({ label: `r${i}`, values })),
  });

  it("is true when every period's series add up to about 100", () => {
    expect(isShareOfWhole(m([[60, 50], [40, 50]]))).toBe(true);
    expect(isShareOfWhole(m([[33.4, 30], [33.3, 40], [33.2, 30.5]]))).toBe(true);
  });

  it("is false for independent rates that do not sum to 100", () => {
    expect(isShareOfWhole(m([[3.2, 4.1], [1.1, 2.2], [0, 0.5]]))).toBe(false);
  });

  it("ignores periods with no data, but needs at least one period with data", () => {
    expect(isShareOfWhole(m([[60, null], [40, null]]))).toBe(true);
    expect(isShareOfWhole(m([[null], [null]]))).toBe(false);
  });
});
