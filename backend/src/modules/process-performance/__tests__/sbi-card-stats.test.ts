import { describe, it, expect } from "vitest";
import { chiSquareP, chiSquareSurvival } from "../sbi-card-stats.js";

describe("chi-square", () => {
  it("matches known critical values", () => {
    expect(chiSquareSurvival(3.841, 1)).toBeCloseTo(0.05, 3);
    expect(chiSquareSurvival(9.488, 4)).toBeCloseTo(0.05, 3);
    expect(chiSquareSurvival(6.635, 1)).toBeCloseTo(0.01, 3);
  });
  it("calls identical segments noise and a real gap significant", () => {
    expect(chiSquareP([[10, 90], [11, 89], [9, 91]])!).toBeGreaterThan(0.8);
    expect(chiSquareP([[5, 95], [30, 70]])!).toBeLessThan(0.001);
  });
  it("refuses to test thin or degenerate tables", () => {
    expect(chiSquareP([[1, 5], [2, 6]])).toBeNull();
    expect(chiSquareP([[0, 50], [0, 60]])).toBeNull();
    expect(chiSquareP([[10, 90]])).toBeNull();
  });
});
