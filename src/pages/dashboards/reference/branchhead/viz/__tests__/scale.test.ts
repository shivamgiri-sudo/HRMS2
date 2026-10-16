import { describe, expect, it } from "vitest";
import { scale, ordinalStep, seriesColor, toneColor, summarize, safeFormat } from "../scale";
import { tipPosition, isKeyboardFocus } from "../useChartTooltip";

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
  it("tooltip stays inside the chart box: flips below near the top, grows inward near the edges", () => {
    expect(tipPosition(0, 50)).toEqual({ left: 0, top: 50, below: false, align: "start" });
    expect(tipPosition(140, -10)).toEqual({ left: 100, top: 0, below: true, align: "end" });
    expect(tipPosition(50, 30)).toEqual({ left: 50, top: 30, below: false, align: "center" });
    expect(tipPosition(Number.NaN, 10).below).toBe(true);
  });
  it("only keyboard (focus-visible) focus counts as keyboard focus", () => {
    expect(isKeyboardFocus({ matches: (s) => s === ":focus-visible" })).toBe(true);
    expect(isKeyboardFocus({ matches: () => false })).toBe(false);
    expect(isKeyboardFocus({ matches: () => { throw new Error("unsupported"); } })).toBe(false);
    expect(isKeyboardFocus(null)).toBe(false);
  });
  it("summarize caps the parts and counts the rest", () => {
    const parts = Array.from({ length: 9 }, (_, i) => `P${i + 1} ${i * 10}`);
    expect(summarize("Headcount", parts)).toBe("Headcount: P1 0, P2 10, P3 20, P4 30, P5 40, P6 50, and 3 more");
    expect(summarize("Headcount", [])).toBe("Headcount: no data");
  });
  it("safeFormat never formats a non-finite value", () => {
    expect(safeFormat((n) => `Rs ${n}`, Number.NaN)).toBe("—");
    expect(safeFormat((n) => `Rs ${n}`, null)).toBe("—");
    expect(safeFormat((n) => `Rs ${n}`, 5)).toBe("Rs 5");
  });
});
