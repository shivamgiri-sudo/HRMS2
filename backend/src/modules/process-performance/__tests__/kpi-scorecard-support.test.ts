import { describe, it, expect } from "vitest";
import { supportFrom } from "../kpi-scorecard.service.js";

/**
 * process_metric_actual stores a ratio's parts already scaled into the metric's
 * unit, so numerator/denominator reproduces the stored value. For a percentage
 * that leaves a factor of 100 in the numerator: Clovia's answer level for
 * 2026-09-07 is held as 35,600 / 363 and reads 98.07%. Printing the numerator
 * raw would tell a reader 35,600 calls were answered out of 363 offered.
 */
describe("supportFrom", () => {
  it("descales the numerator for a percentage metric", () => {
    expect(supportFrom({ ratioNumerator: 35600, ratioDenominator: 363 }, "percent"))
      .toEqual({ numerator: 356, denominator: 363 });
  });

  it("leaves a non-percentage metric's parts alone", () => {
    expect(supportFrom({ ratioNumerator: 1200, ratioDenominator: 40 }, "ratio"))
      .toEqual({ numerator: 1200, denominator: 40 });
  });

  it("reconstructs the displayed percentage from the pair it returns", () => {
    const s = supportFrom({ ratioNumerator: 35600, ratioDenominator: 363 }, "percent")!;
    expect(((s.numerator / s.denominator) * 100).toFixed(2)).toBe("98.07");
  });

  /**
   * Null is the honest answer, not a zero: a partial sum belongs to neither the
   * period's own ratio nor the mean of the daily ones, and a zero denominator has
   * no ratio to show.
   */
  it("returns null when the parts are absent or unusable", () => {
    expect(supportFrom(undefined, "percent")).toBeNull();
    expect(supportFrom({ ratioNumerator: null, ratioDenominator: 363 }, "percent")).toBeNull();
    expect(supportFrom({ ratioNumerator: 100, ratioDenominator: null }, "percent")).toBeNull();
    expect(supportFrom({ ratioNumerator: 100, ratioDenominator: 0 }, "percent")).toBeNull();
  });
});
