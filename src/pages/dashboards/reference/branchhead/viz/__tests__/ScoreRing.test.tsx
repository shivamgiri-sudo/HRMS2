import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ScoreRing, scoreRingLayout } from "../ScoreRing";

describe("ScoreRing", () => {
  it("renders the value, band text and an accessible name", () => {
    const html = renderToStaticMarkup(<ScoreRing value={82.4} label="Branch score" band="Good" />);
    expect(html).toContain(">82<");
    expect(html).toContain("Good");
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Branch score: 82 out of 100, Good"');
  });
  it("clamps the arc to 0..100", () => {
    const l = scoreRingLayout(140, 120);
    expect(l.value).toBe(100);
    expect(l.dash).toBeCloseTo(l.circumference);
    expect(scoreRingLayout(-5, 120).dash).toBe(0);
    expect(scoreRingLayout(Number.NaN, 120).value).toBe(0);
  });
});
