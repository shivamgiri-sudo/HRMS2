import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Sparkline, sparklinePath } from "../Sparkline";

describe("Sparkline", () => {
  it("returns null with fewer than 3 finite points", () => {
    expect(Sparkline({ points: [1, null, 2], label: "Score" })).toBeNull();
    expect(sparklinePath([1, Number.NaN, 2], 80, 24)).toBeNull();
  });
  it("draws a path ending at the last finite point", () => {
    const html = renderToStaticMarkup(<Sparkline points={[1, 2, null, 4]} label="Score trend" />);
    expect(html).toContain("<path");
    expect(html).toContain('role="img"');
    expect(html).toContain("Score trend");
    const p = sparklinePath([1, 2, null, 4], 80, 24)!;
    expect(p.d.startsWith("M")).toBe(true);
    expect(p.d.split("M").length - 1).toBe(2);
    expect(p.last.x).toBeCloseTo(78);
    expect(p.count).toBe(3);
  });
  it("flat series sits mid-height without NaN", () => {
    const p = sparklinePath([5, 5, 5], 80, 24)!;
    expect(p.d.includes("NaN")).toBe(false);
  });
});
