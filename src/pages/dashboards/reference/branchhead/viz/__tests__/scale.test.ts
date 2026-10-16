import { describe, expect, it } from "vitest";
import { scale, ordinalStep, seriesColor, toneColor } from "../scale";
import { tipPosition } from "../useChartTooltip";

describe("scale helpers", () => {
  it("niceMax rounds up to a clean bound and never returns 0", () => {
    expect(scale.niceMax(0)).toBe(1);
    expect(scale.niceMax(-5)).toBe(1);
    expect(scale.niceMax(Number.NaN)).toBe(1);
    expect(scale.niceMax(7)).toBe(10);
    expect(scale.niceMax(23)).toBe(25);
    expect(scale.niceMax(180)).toBe(200);
    expect(scale.niceMax(1)).toBe(1);
  });
  it("pct guards a zero or missing whole", () => {
    expect(scale.pct(1, 0)).toBe(0);
    expect(scale.pct(1, Number.NaN)).toBe(0);
    expect(scale.pct(25, 200)).toBe(12.5);
  });
  it("linear maps the domain and survives an equal domain", () => {
    const f = scale.linear([0, 10], [0, 100]);
    expect(f(5)).toBe(50);
    const g = scale.linear([3, 3], [10, 90]);
    expect(g(3)).toBe(10);
    expect(Number.isNaN(g(7))).toBe(false);
  });
  it("ticks are evenly spaced from 0", () => {
    expect(scale.ticks(100, 2)).toEqual([0, 50, 100]);
  });
  it("clamp bounds a value", () => {
    expect(scale.clamp(150, 0, 100)).toBe(100);
    expect(scale.clamp(Number.NaN, 0, 100)).toBe(0);
  });
  it("ordinal steps spread across the validated 5-step ramp", () => {
    expect([0, 1, 2].map((i) => ordinalStep(i, 3))).toEqual([1, 3, 5]);
    expect([0, 1].map((i) => ordinalStep(i, 2))).toEqual([1, 5]);
    expect(ordinalStep(7, 9)).toBe(5);
    expect(ordinalStep(0, 1)).toBe(1);
  });
  it("colour tokens resolve to CSS variables", () => {
    expect(seriesColor(0)).toBe("var(--bh-s1)");
    expect(seriesColor(3)).toBe("var(--bh-s4)");
    expect(seriesColor(9)).toBe("var(--bh-other)");
    expect(toneColor("critical")).toBe("var(--bh-critical)");
    expect(toneColor(undefined)).toBe("var(--bh-s1)");
  });
  it("tooltip position stays inside the chart box", () => {
    expect(tipPosition(0, 50)).toEqual({ left: 12, top: 50 });
    expect(tipPosition(100, -10)).toEqual({ left: 88, top: 0 });
    expect(tipPosition(40, 30)).toEqual({ left: 40, top: 30 });
  });
});
