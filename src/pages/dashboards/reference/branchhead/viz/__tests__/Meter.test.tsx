import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Meter, meterLayout } from "../Meter";

const fmt = (n: number) => `Rs ${n}`;

describe("Meter", () => {
  it("clamps the fill at 100% and says over limit in text", () => {
    expect(meterLayout(150, 100)).toEqual({ pct: 150, fillPct: 100, over: true });
    const html = renderToStaticMarkup(<Meter value={150} limit={100} label="Budget used" format={fmt} />);
    expect(html).toContain("over limit");
    expect(html).toContain("width:100%");
    expect(html).toContain("Rs 150");
    expect(html).toContain("Rs 100");
  });
  it("draws a partial fill under the limit with a meter role", () => {
    const html = renderToStaticMarkup(<Meter value={40} limit={100} label="Budget used" format={fmt} />);
    expect(html).toContain("width:40%");
    expect(html).toContain('role="meter"');
    expect(html).not.toContain("over limit");
  });
  it("renders an empty state when there is no limit", () => {
    expect(meterLayout(5, 0)).toEqual({ pct: 0, fillPct: 0, over: false });
    expect(renderToStaticMarkup(<Meter value={5} limit={0} label="Budget used" format={fmt} />)).toContain("No data");
  });
});
