import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Waterfall, waterfallLayout } from "../Waterfall";

const fmt = (n: number) => String(n);

describe("Waterfall", () => {
  it("keeps running totals across deltas", () => {
    const l = waterfallLayout([
      { id: "rev", label: "Revenue", value: 100, kind: "total" },
      { id: "sal", label: "Salary", value: -60, kind: "delta" },
      { id: "oth", label: "Other", value: -10, kind: "delta" },
      { id: "op", label: "Operating profit", value: 30, kind: "total" },
    ]);
    expect(l.bars.map((b) => [b.from, b.to])).toEqual([[0, 100], [100, 40], [40, 30], [0, 30]]);
    expect(l.bars.map((b) => b.kind)).toEqual(["total", "down", "down", "total"]);
    expect(l.max).toBe(100);
    expect(l.min).toBe(0);
  });
  it("supports a negative total", () => {
    const l = waterfallLayout([
      { id: "rev", label: "Revenue", value: 50, kind: "total" },
      { id: "cost", label: "Cost", value: -80, kind: "delta" },
      { id: "net", label: "Net", value: -30, kind: "total" },
    ]);
    expect(l.bars[2]).toMatchObject({ from: 0, to: -30 });
    expect(l.min).toBe(-30);
    const html = renderToStaticMarkup(<Waterfall steps={[{ id: "rev", label: "Revenue", value: 50, kind: "total" }, { id: "cost", label: "Cost", value: -80, kind: "delta" }, { id: "net", label: "Net", value: -30, kind: "total" }]} format={fmt} />);
    expect(html).not.toContain("NaN");
    expect(html).toContain("-30");
    expect(html).toContain("Decrease");
  });
  it("renders an empty state with no steps", () => {
    expect(renderToStaticMarkup(<Waterfall steps={[]} format={fmt} />)).toContain("No data");
  });
});
