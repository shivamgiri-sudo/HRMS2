import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LineArea, lineLayout } from "../LineArea";

const fmt = (n: number) => String(n);
const pts = (ys: Array<number | null>) => ys.map((y, i) => ({ x: `D${i + 1}`, y }));

describe("LineArea", () => {
  it("skips null points by breaking the line", () => {
    const l = lineLayout([{ key: "a", label: "Actual", points: pts([1, null, 3, 4]) }], 400, 160);
    expect(l.series[0].d.split("M").length - 1).toBe(2);
    expect(l.series[0].d.includes("NaN")).toBe(false);
  });
  it("draws a dashed second series with a legend", () => {
    const html = renderToStaticMarkup(
      <LineArea series={[{ key: "a", label: "Actual", points: pts([1, 2, 3]) }, { key: "t", label: "Target", points: pts([2, 2, 2]), dashed: true }]} format={fmt} />,
    );
    expect(html).toContain("stroke-dasharray");
    expect(html).toContain("bh-legend");
    expect(html).toContain("Target");
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Trend, 3 periods: Actual from 1 to 3; Target from 2 to 2"');
  });
  it("draws a dot, not a line, for a single point", () => {
    const l = lineLayout([{ key: "a", label: "A", points: pts([5]) }], 400, 160);
    expect(l.series[0].d).toBe("");
    expect(l.series[0].dots).toHaveLength(1);
    const html = renderToStaticMarkup(<LineArea series={[{ key: "a", label: "A", points: pts([5]) }]} format={fmt} />);
    expect(html).toContain("<circle");
  });
  it("renders an empty state when nothing is finite", () => {
    expect(renderToStaticMarkup(<LineArea series={[{ key: "a", label: "A", points: pts([null, null]) }]} format={fmt} />)).toContain("No data");
    expect(renderToStaticMarkup(<LineArea series={[]} format={fmt} />)).toContain("No data");
  });
  it("includes negative values in the domain", () => {
    const l = lineLayout([{ key: "a", label: "A", points: pts([-4, 2, 6]) }], 400, 160);
    expect(l.yMin).toBeLessThan(0);
  });
});
