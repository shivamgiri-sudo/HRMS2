import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DivergingBars, divergingLayout } from "../DivergingBars";

const fmt = (n: number) => String(n);

describe("DivergingBars", () => {
  it("splits positive and negative around a centred zero", () => {
    const l = divergingLayout([{ id: "a", label: "A", value: 50 }, { id: "b", label: "B", value: -100 }]);
    expect(l.zeroPct).toBe(50);
    expect(l.rows[0]).toMatchObject({ sign: "pos", leftPct: 50, widthPct: 25 });
    expect(l.rows[1]).toMatchObject({ sign: "neg", leftPct: 0, widthPct: 50 });
  });
  it("puts zero at the left edge when all values are positive", () => {
    const l = divergingLayout([{ id: "a", label: "A", value: 40 }, { id: "b", label: "B", value: 80 }]);
    expect(l.zeroPct).toBe(0);
    expect(l.rows[1].widthPct).toBe(100);
  });
  it("shows both sign labels in a legend", () => {
    const html = renderToStaticMarkup(
      <DivergingBars items={[{ id: "a", label: "Alpha", value: 5 }, { id: "b", label: "Beta", value: -3 }]} format={fmt} positiveLabel="Profit" negativeLabel="Loss" />,
    );
    expect(html).toContain("Profit");
    expect(html).toContain("Loss");
    expect(html).toContain("bh-legend");
  });
  it("handles empty and all-zero data", () => {
    expect(renderToStaticMarkup(<DivergingBars items={[]} format={fmt} positiveLabel="P" negativeLabel="L" />)).toContain("No data");
    const l = divergingLayout([{ id: "z", label: "Z", value: 0 }]);
    expect(l.rows[0].widthPct).toBe(0);
  });
});
