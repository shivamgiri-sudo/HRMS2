import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Funnel, funnelLayout } from "../Funnel";

const stages = [
  { id: "applied", label: "Applied", value: 200 },
  { id: "screened", label: "Screened", value: 120 },
  { id: "selected", label: "Selected", value: 30 },
];

describe("Funnel", () => {
  it("widths follow values and colours step down one ordinal ramp", () => {
    const l = funnelLayout(stages);
    expect(l.rows.map((r) => r.widthPct)).toEqual([100, 60, 15]);
    expect(l.rows.map((r) => r.step)).toEqual([1, 3, 5]);
    expect(l.rows[1].convPct).toBe(60);
    expect(l.rows[0].convPct).toBeNull();
  });
  it("survives a zero first stage", () => {
    const l = funnelLayout([{ id: "a", label: "A", value: 0 }, { id: "b", label: "B", value: 5 }]);
    expect(l.rows[0].widthPct).toBe(0);
    expect(l.rows[1].widthPct).toBe(100);
    expect(l.rows[1].convPct).toBeNull();
    const html = renderToStaticMarkup(<Funnel stages={[{ id: "a", label: "A", value: 0 }, { id: "b", label: "B", value: 5 }]} />);
    expect(html).not.toContain("NaN");
  });
  it("uses ordinal ramp tokens and renders stage labels and buttons", () => {
    const html = renderToStaticMarkup(<Funnel stages={stages} onSelect={() => {}} />);
    expect(html).toContain("var(--bh-ord-1)");
    expect(html).toContain("var(--bh-ord-5)");
    expect(html).toContain("Screened");
    expect(html).toContain("<button");
  });
  it("renders an empty state when every stage is zero", () => {
    expect(renderToStaticMarkup(<Funnel stages={[{ id: "a", label: "A", value: 0 }]} />)).toContain("No data");
  });
});
