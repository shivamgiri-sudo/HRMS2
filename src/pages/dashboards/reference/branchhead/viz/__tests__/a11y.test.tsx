import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BarList, StackedBar, DivergingBars, Funnel, Waterfall, Donut, Sparkline, Meter, restoreFocus, cell, stackLayout } from "../index";

const fmt = (n: number) => `${n}`;

describe("row charts are named groups with a data summary", () => {
  it("BarList names the group with real values and caps at 6 items", () => {
    const items = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, label: `Proc ${i}`, value: 100 + i, marker: 90 }));
    items[0] = { id: "onfido", label: "Onfido", value: 280, marker: 181 };
    const html = renderToStaticMarkup(<BarList items={items} format={fmt} markerLabel="mandate" label="Headcount versus mandate by process" />);
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Headcount versus mandate by process: Onfido 280 of 181 mandate, Proc 1 101 of 90 mandate');
    expect(html).toContain("and 2 more");
    expect(html).toContain('title="Onfido"');
    expect(html).toContain('tabindex="0"');
  });
  it("BarList with onSelect: the group is not a tab stop, the rows are buttons", () => {
    const html = renderToStaticMarkup(<BarList items={[{ id: "a", label: "A", value: 3 }]} format={fmt} onSelect={() => {}} label="X" />);
    expect(html).toContain('aria-label="X: A 3"');
    expect(html).not.toContain('tabindex="0"');
    expect(html).toContain("<button");
  });
  it("StackedBar, DivergingBars and Funnel summarise real numbers", () => {
    const sb = renderToStaticMarkup(<StackedBar label="Attendance" series={[{ key: "p", label: "Present" }]}
      rows={[{ id: "r", label: "Alpha", segments: [{ key: "p", value: 7 }] }]} format={fmt} />);
    expect(sb).toContain('aria-label="Attendance: Alpha 7 (Present 7)"');
    expect(sb).toContain('title="Alpha"');
    const db = renderToStaticMarkup(<DivergingBars label="Process P&amp;L" items={[{ id: "a", label: "A", value: -4 }]} format={fmt} positiveLabel="Profit" negativeLabel="Loss" />);
    expect(db).toContain("A -4 Loss");
    expect(db).toContain('role="group"');
    const fn = renderToStaticMarkup(<Funnel label="Hiring" stages={[{ id: "a", label: "Applied", value: 10 }, { id: "b", label: "Selected", value: 4 }]} />);
    expect(fn).toContain('aria-label="Hiring: Applied 10, Selected 4 (40% of previous)"');
  });
  it("focusable SVG charts use role=group with a descriptive label; static figures keep role=img", () => {
    const wf = renderToStaticMarkup(<Waterfall label="Finance" steps={[{ id: "r", label: "Revenue from operations", value: 9, kind: "total" }]} format={fmt} />);
    expect(wf).toContain('role="group"');
    expect(wf).toContain('aria-label="Finance: Revenue from operations 9"');
    expect(wf).toContain("<title>Revenue from operations</title>");
    expect(wf).toContain("Revenue from …");
    const dn = renderToStaticMarkup(<Donut slices={[{ key: "a", label: "A", value: 1 }, { key: "b", label: "B", value: 3 }]} centerLabel="Exits" centerValue="4" />);
    expect(dn).toContain('role="group"');
    expect(dn).not.toContain('role="img"');
  });
});

describe("small fixes", () => {
  it("Sparkline label rounds to one decimal", () => {
    const html = renderToStaticMarkup(<Sparkline points={[1.23456, 2, 3.98765]} label="Score" />);
    expect(html).toContain("from 1.2 to 4");
    expect(html).not.toContain("1.23456");
  });
  it("Meter never formats a non-finite value", () => {
    const format = vi.fn((n: number) => `Rs ${n}`);
    const html = renderToStaticMarkup(<Meter value={Number.NaN} limit={100} label="Budget" format={format} />);
    expect(html).toContain("— of Rs 100");
    expect(format.mock.calls.every(([n]) => Number.isFinite(n))).toBe(true);
  });
  it("table cells keep strings as given and do not group raw numbers", () => {
    expect(cell(1234567)).toBe("1234567");
    expect(cell("₹12.3 L")).toBe("₹12.3 L");
    expect(cell(null)).toBe("—");
    expect(cell(Number.NaN)).toBe("—");
  });
  it("StackedBar folds segment keys missing from series into Other so totals match", () => {
    const l = stackLayout([{ id: "r", label: "R", segments: [{ key: "p", value: 5 }, { key: "ghost", value: 2 }] }], [{ key: "p", label: "Present" }]);
    expect(l.series.map((s) => s.label)).toEqual(["Present", "Other"]);
    expect(l.rows[0].total).toBe(7);
    expect(l.rows[0].segments.map((s) => s.value)).toEqual([5, 2]);
  });
});

describe("DrillDrawer focus return", () => {
  it("focuses the saved opener when it is still in the document", () => {
    const opener = { isConnected: true, focus: vi.fn() };
    const body = { focus: vi.fn() };
    expect(restoreFocus(opener, body)).toBe(opener);
    expect(opener.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(body.focus).not.toHaveBeenCalled();
  });
  it("falls back to the body when the opener is gone or missing", () => {
    const gone = { isConnected: false, focus: vi.fn() };
    const body = { focus: vi.fn() };
    expect(restoreFocus(gone, body)).toBe(body);
    expect(gone.focus).not.toHaveBeenCalled();
    expect(restoreFocus(null, body)).toBe(body);
    expect(restoreFocus(null, null)).toBeNull();
  });
});
