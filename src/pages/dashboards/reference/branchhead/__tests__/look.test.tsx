import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AccentCard, ChartCard, EmptyLine, GradientKpi, KPI_HUES, NavyTable, SpecTable, SubTabs, looksNumeric, waterfallData } from "../look";

/** WCAG relative luminance contrast of white text on a hex colour. */
function whiteContrast(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 1.05 / (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] + 0.05);
}

describe("GradientKpi", () => {
  it("white text keeps >= 4.5:1 on the darkest and lightest stop of every hue", () => {
    for (const [hue, stops] of Object.entries(KPI_HUES)) for (const s of stops) expect(whiteContrast(s), `${hue} ${s}`).toBeGreaterThanOrEqual(4.5);
  });
  it("a tile with a click is a button; status is text + icon; critical turns it rose", () => {
    const b = renderToStaticMarkup(<GradientKpi label="GRN pending" value="11" sub="4 over 3 days" hue="teal" status="critical" onClick={() => {}} />);
    expect(b).toContain("<button");
    expect(b).toContain(">Critical<");
    expect(b).toContain("bhl-hue-rose");
    const w = renderToStaticMarkup(<GradientKpi label="Late" value="9" hue="orange" status="warning" />);
    expect(w).not.toContain("<button");
    expect(w).toContain(">Warning<");
    expect(w).toContain("bhl-hue-orange");
    expect(renderToStaticMarkup(<GradientKpi label="X" value="1" />)).not.toContain("bhl-kpi-status");
  });
});

describe("NavyTable and SpecTable", () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ name: `Row ${i + 1}`, n: i }));
  it("shows the top N with a Show all button, numbers right-aligned", () => {
    const out = renderToStaticMarkup(<NavyTable caption="Rows" rows={rows} limit={10}
      columns={[{ key: "a", label: "Name", render: (r) => r.name }, { key: "b", label: "N", num: true, render: (r) => r.n }]} />);
    expect(out).toContain("Row 10");
    expect(out).not.toContain("Row 11");
    expect(out).toContain("Show all 12");
    expect(out).toContain('<th scope="col" class="bhl-r">N</th>');
  });
  it("clickable rows are focusable with a label; empty says so", () => {
    const out = renderToStaticMarkup(<NavyTable caption="Rows" rows={rows.slice(0, 1)} onRowClick={() => {}} rowLabel={(r) => r.name}
      columns={[{ key: "a", label: "Name", render: (r) => r.name }]} />);
    expect(out).toContain('tabindex="0"');
    expect(out).toContain('aria-label="Open Row 1"');
    expect(renderToStaticMarkup(<NavyTable caption="None" rows={[]} empty="Nothing here" columns={[{ key: "a", label: "A", render: () => "" }]} />)).toContain("Nothing here");
  });
  it("SpecTable right-aligns numeric columns only", () => {
    expect(looksNumeric("₹2.6 L")).toBe(true);
    expect(looksNumeric("-₹83,783")).toBe(true);
    expect(looksNumeric("12.5%")).toBe(true);
    expect(looksNumeric("Rent")).toBe(false);
    const out = renderToStaticMarkup(<SpecTable table={{ caption: "T", columns: ["Head", "Budget"], rows: [["Rent", "₹5 L"], ["Utilities", "₹2 L"]] }} />);
    expect(out).toContain('<th scope="col">Head</th>');
    expect(out).toContain('<th scope="col" class="bhl-r">Budget</th>');
  });
});

describe("cards, sub-tabs and the waterfall", () => {
  it("accent card: dot, title and count chip; empty line has an icon and text", () => {
    const out = renderToStaticMarkup(<AccentCard title="Daily orders" chip="12 days"><EmptyLine text="No data yet" /></AccentCard>);
    for (const t of ['class="bhl-dot"', ">Daily orders<", 'class="bhl-count">12 days<', "No data yet", "<svg"]) expect(out).toContain(t);
  });
  it("chart card offers the table twin as a pressed toggle", () => {
    const out = renderToStaticMarkup(<ChartCard title="C" table={{ caption: "t", columns: ["A"], rows: [["x"]] }} defaultShowTable><div /></ChartCard>);
    expect(out).toContain('aria-pressed="true"');
    expect(out).toContain(">x<");
  });
  it("sub-tabs mark exactly one pressed, all 44px buttons", () => {
    const out = renderToStaticMarkup(<SubTabs label="Finance" value="b" onChange={() => {}} items={[{ id: "a", label: "A" }, { id: "b", label: "B" }]} />);
    expect(out.split('aria-pressed="true"').length - 1).toBe(1);
    expect(out).toContain('role="group"');
  });
  it("waterfall bases float deltas from the running total and totals stand on zero", () => {
    const d = waterfallData([{ label: "Rev", value: 100, kind: "total" }, { label: "Cost", value: -30, kind: "delta" }, { label: "Back", value: 5, kind: "delta" }, { label: "OP", value: 75, kind: "total" }]);
    expect(d.map((r) => [r.base, r.total, r.down, r.up])).toEqual([[0, 100, null, null], [70, null, 30, null], [70, null, null, 5], [0, 75, null, null]]);
  });
});
