import { describe, expect, it } from "vitest";
import {
  autoShowLabels,
  chartHeight,
  dashFor,
  hiddenForTopN,
  toggleSeries,
} from "../matrixChartState";
import type { Matrix } from "../onfidoReportShared";

const matrix: Matrix = {
  buckets: ["Jul", "Aug", "Sep"],
  rows: [
    { label: "A", values: [1, 2, 3] },
    { label: "B", values: [9, 8, 7] },
    { label: "C", values: [5, 5, null] },
    { label: "D", values: [null, null, null] },
    { label: "E", values: [4, 4, 4] },
  ],
};

describe("toggleSeries", () => {
  it("hides a visible series and shows a hidden one, without mutating the input", () => {
    const start = new Set<string>();
    const hidden = toggleSeries(start, "A");
    expect([...hidden]).toEqual(["A"]);
    expect(start.size).toBe(0);
    expect(toggleSeries(hidden, "A").has("A")).toBe(false);
  });
});

describe("hiddenForTopN", () => {
  it("keeps the N series with the highest latest value and hides the rest", () => {
    // latest values: A=3, B=7, C=5 (last non-null), D=none, E=4
    const hidden = hiddenForTopN(matrix, 3);
    expect([...hidden].sort()).toEqual(["A", "D"]);
  });

  it("hides nothing when N covers every series", () => {
    expect(hiddenForTopN(matrix, 10).size).toBe(0);
  });

  it("treats a series with no data as the lowest, so it is hidden first", () => {
    expect(hiddenForTopN(matrix, 4).has("D")).toBe(true);
  });
});

describe("autoShowLabels", () => {
  it("shows point labels only when three or fewer lines are visible", () => {
    expect(autoShowLabels(1)).toBe(true);
    expect(autoShowLabels(3)).toBe(true);
    expect(autoShowLabels(4)).toBe(false);
    expect(autoShowLabels(9)).toBe(false);
  });
});

describe("dashFor", () => {
  it("keeps the first four lines solid and dashes later ones in rotating patterns", () => {
    expect([0, 1, 2, 3].map(dashFor)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(dashFor(4)).toBe("6 3");
    expect(dashFor(5)).toBe("2 3");
    expect(dashFor(6)).toBe("8 3 2 3");
    expect(dashFor(7)).toBe(undefined);
    expect(dashFor(8)).toBe("6 3");
  });
});

describe("chartHeight", () => {
  it("grows with the number of series, up to a cap", () => {
    expect(chartHeight(300, 2)).toBe(300);
    expect(chartHeight(300, 4)).toBe(300);
    expect(chartHeight(300, 8)).toBe(356);
    expect(chartHeight(300, 30)).toBe(380);
  });
});
