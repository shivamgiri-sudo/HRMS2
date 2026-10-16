import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { BarList, Meter, ScoreRing, Sparkline, StatTile } from "../index";
import { Glyph } from "../parts";

const fmt = (n: number) => `${n}`;
/** Every <svg ...> opening tag in the markup. */
const svgTags = (html: string) => html.split("<svg").slice(1).map((s) => s.slice(0, s.indexOf(">")));

describe("small svgs keep their own size inside charts", () => {
  it("Glyph carries the bh-icon class and an inline fixed size", () => {
    const tag = svgTags(renderToStaticMarkup(<Glyph name="warning" size={12} />))[0];
    expect(tag).toContain('class="bh-icon"');
    expect(tag).toContain("width:12px;height:12px;display:inline-block;flex-shrink:0");
  });
  it("note/status icons inside BarList and Meter rows are protected", () => {
    const html = renderToStaticMarkup(<div>
      <BarList items={[{ id: "a", label: "A", value: 9, marker: 5, note: "Over" }]} format={fmt} markerLabel="seats" />
      <Meter value={150} limit={100} label="Budget" format={fmt} />
      <StatTile label="X" value="1" tone="critical" delta={{ text: "+1", direction: "up", good: false }} />
    </div>);
    const icons = svgTags(html).filter((t) => t.includes('viewBox="0 0 16 16"'));
    expect(icons.length).toBeGreaterThan(0);
    for (const t of icons) {
      expect(t).toContain("bh-icon");
      expect(t).toContain("display:inline-block");
    }
  });
  it("ScoreRing and Sparkline svgs have an inline size", () => {
    expect(svgTags(renderToStaticMarkup(<ScoreRing value={80} label="Health" band="Good" size={172} />))[0]).toContain("width:172px;height:172px");
    expect(svgTags(renderToStaticMarkup(<Sparkline points={[1, 2, 3]} label="t" width={72} height={22} />))[0]).toContain("width:72px;height:22px");
  });
  it("the chart-wide svg rule excludes icons", () => {
    const css = readFileSync(resolve(__dirname, "../viz.css"), "utf8");
    expect(css).toContain(".bh-chart svg:not(.bh-icon):not(.lucide)");
    expect(css).not.toContain(".bh-chart svg {");
  });
});
