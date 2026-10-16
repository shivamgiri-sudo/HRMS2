import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BarList, barListLayout } from "../BarList";

const fmt = (n: number) => String(n);

describe("BarList", () => {
  it("scales to the largest value or marker, or to an explicit max", () => {
    const l = barListLayout([{ id: "a", label: "A", value: 50, marker: 80 }, { id: "b", label: "B", value: 100 }]);
    expect(l.max).toBe(100);
    expect(l.rows[0].widthPct).toBe(50);
    expect(l.rows[0].markerPct).toBe(80);
    expect(barListLayout([{ id: "a", label: "A", value: 50 }], 200).rows[0].widthPct).toBe(25);
  });
  it("draws the marker with its label and flags over-marker items in text", () => {
    const html = renderToStaticMarkup(
      <BarList items={[{ id: "a", label: "Alpha", value: 12, marker: 10 }, { id: "b", label: "Beta", value: 5, marker: 10 }]} format={fmt} markerLabel="Mandate" />,
    );
    expect(html).toContain("Mandate");
    expect(html).toContain("bh-marker");
    expect(html).toContain("Over Mandate");
    expect(barListLayout([{ id: "a", label: "A", value: 12, marker: 10 }]).rows[0].over).toBe(true);
  });
  it("uses an item note when provided and renders buttons with onSelect", () => {
    const html = renderToStaticMarkup(
      <BarList items={[{ id: "a", label: "Alpha", value: 12, marker: 10, note: "2 above mandate" }]} format={fmt} onSelect={() => {}} />,
    );
    expect(html).toContain("2 above mandate");
    expect(html).toContain("<button");
  });
  it("handles empty input and an all-zero list without NaN", () => {
    expect(renderToStaticMarkup(<BarList items={[]} format={fmt} />)).toContain("No data");
    const l = barListLayout([{ id: "a", label: "A", value: 0 }]);
    expect(l.rows[0].widthPct).toBe(0);
    expect(renderToStaticMarkup(<BarList items={[{ id: "a", label: "A", value: 0 }]} format={fmt} />)).not.toContain("NaN");
  });
});
