import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StackedBar, stackLayout, STACK_GAP_PX } from "../StackedBar";

const series = [{ key: "present", label: "Present" }, { key: "leave", label: "Leave" }, { key: "absent", label: "Absent" }];
const rows = [
  { id: "p1", label: "Alpha", segments: [{ key: "present", value: 6 }, { key: "leave", value: 2 }, { key: "absent", value: 2 }] },
  { id: "p2", label: "Beta", segments: [{ key: "present", value: 5 }, { key: "leave", value: 0 }, { key: "absent", value: 0 }] },
];

describe("StackedBar", () => {
  it("segments sum to the row total and shares to 100", () => {
    const l = stackLayout(rows, series);
    expect(l.rows[0].total).toBe(10);
    expect(l.rows[0].segments.reduce((s, x) => s + x.value, 0)).toBe(10);
    expect(l.rows[0].segments.reduce((s, x) => s + x.sharePct, 0)).toBeCloseTo(100);
    expect(l.rows[1].widthPct).toBe(50);
    expect(l.rows[1].segments).toHaveLength(1);
  });
  it("uses a 2px surface gap and a legend for 2+ series", () => {
    expect(STACK_GAP_PX).toBe(2);
    const html = renderToStaticMarkup(<StackedBar rows={rows} series={series} />);
    expect(html).toContain("gap:2px");
    expect(html).toContain("Present");
    expect(html).toContain("Absent");
    expect(html).toContain("bh-legend");
  });
  it("folds more than 4 series into Other", () => {
    const many = ["a", "b", "c", "d", "e"].map((k) => ({ key: k, label: k.toUpperCase() }));
    const l = stackLayout([{ id: "r", label: "R", segments: many.map((s) => ({ key: s.key, value: 1 })) }], many);
    expect(l.series.map((s) => s.label)).toEqual(["A", "B", "C", "Other"]);
    expect(l.rows[0].segments.find((s) => s.key === "__other")?.value).toBe(2);
  });
  it("renders an empty state for zero rows and all-zero totals", () => {
    expect(renderToStaticMarkup(<StackedBar rows={[]} series={series} />)).toContain("No data");
    const zero = [{ id: "z", label: "Z", segments: [{ key: "present", value: 0 }] }];
    expect(renderToStaticMarkup(<StackedBar rows={zero} series={series} />)).toContain("No data");
  });
});
