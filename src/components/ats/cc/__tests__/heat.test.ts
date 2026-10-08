import { describe, expect, it } from "vitest";
import { heatPosition } from "../cc-viz";

describe("heatPosition", () => {
  it("makes the highest value of a red column the strongest, even when marked lower-is-better", () => {
    expect(heatPosition(1, { hue: "red", invert: true })).toBe(1);
    expect(heatPosition(0, { hue: "red", invert: true })).toBe(0);
    expect(heatPosition(1, { hue: "red" })).toBe(1);
  });
  it("flips non-red columns that are lower-is-better, so the best (lowest) value is strongest", () => {
    expect(heatPosition(0, { hue: "blue", invert: true })).toBe(1);
    expect(heatPosition(0.25, { hue: "green", invert: true })).toBe(0.75);
  });
  it("leaves ordinary columns alone", () => {
    expect(heatPosition(0.7, {})).toBe(0.7);
    expect(heatPosition(0.7, { hue: "green" })).toBe(0.7);
  });
});
