import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StatTile } from "../StatTile";

describe("StatTile", () => {
  it("shows label, value and a delta with an icon and a direction word", () => {
    const html = renderToStaticMarkup(
      <StatTile label="Shrinkage" value="12.4%" delta={{ text: "+1.2 pts vs yesterday", direction: "up", good: false }} />,
    );
    expect(html).toContain("Shrinkage");
    expect(html).toContain("12.4%");
    expect(html).toContain("+1.2 pts vs yesterday");
    expect(html).toContain("up");
    expect(html).toContain("<svg");
    expect(html).toContain("bh-delta-bad");
    expect(html).not.toContain("<button");
  });
  it("down and flat deltas carry their own words", () => {
    expect(renderToStaticMarkup(<StatTile label="a" value="1" delta={{ text: "-2", direction: "down", good: true }} />)).toContain("down");
    const flat = renderToStaticMarkup(<StatTile label="a" value="1" delta={{ text: "0", direction: "flat", good: null }} />);
    expect(flat).toContain("flat");
    expect(flat).toContain("bh-delta-neutral");
  });
  it("is a 44px button when clickable", () => {
    const html = renderToStaticMarkup(<StatTile label="Late" value="12" onClick={vi.fn()} hint="Open late arrivals" />);
    expect(html).toContain("<button");
    expect(html).toContain('type="button"');
    expect(html).toContain("min-height:44px");
    expect(html).toContain("Open late arrivals");
  });
  it("names a status tone in text, not colour alone, and draws a sparkline only with 3+ points", () => {
    const html = renderToStaticMarkup(<StatTile label="GRN" value="4" tone="critical" spark={[1, 2, 3]} />);
    expect(html).toContain("Critical");
    expect(html).toContain("<path");
    expect(renderToStaticMarkup(<StatTile label="GRN" value="4" spark={[1, 2]} />)).not.toContain("<path");
  });
});
