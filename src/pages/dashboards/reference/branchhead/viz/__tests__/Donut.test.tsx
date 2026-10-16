import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Donut, donutLayout, foldSlices } from "../Donut";

const five = [
  { key: "a", label: "A", value: 50 }, { key: "b", label: "B", value: 20 }, { key: "c", label: "C", value: 15 },
  { key: "d", label: "D", value: 10 }, { key: "e", label: "E", value: 5 },
];

describe("Donut", () => {
  it("folds a 5th slice into Other and draws at most 4", () => {
    const f = foldSlices(five);
    expect(f).toHaveLength(4);
    expect(f[3]).toMatchObject({ key: "__other", label: "Other", value: 15 });
    const l = donutLayout(five);
    expect(l.total).toBe(100);
    expect(l.slices[0].pct).toBe(50);
    expect(l.slices[3].a1).toBeCloseTo(Math.PI * 2);
  });
  it("renders arcs, a centre value and a legend", () => {
    const html = renderToStaticMarkup(<Donut slices={five} centerLabel="Exits" centerValue="100" />);
    expect(html).toContain("Exits");
    expect(html).toContain(">100<");
    expect(html).toContain("Other");
    expect((html.match(/<path/g) ?? []).length).toBe(4);
  });
  it("draws one full ring for a single slice", () => {
    const html = renderToStaticMarkup(<Donut slices={[{ key: "a", label: "A", value: 3 }]} centerLabel="x" centerValue="3" />);
    expect(html).not.toContain("NaN");
    expect(html).toContain("<circle");
  });
  it("renders an empty state at zero total", () => {
    const html = renderToStaticMarkup(<Donut slices={[{ key: "a", label: "A", value: 0 }]} centerLabel="x" centerValue="0" />);
    expect(html).toContain("No data");
  });
});
