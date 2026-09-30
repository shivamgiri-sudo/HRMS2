import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PacingCard } from "../PacingCard";
import { PacingBar, barGeometry } from "../PacingBar";
import { StatusChip, STATUS } from "../status";
import { chartRows } from "../PacingChart";
import { monthOptions } from "../PacingPanel";
import type { ForecastKpi } from "../types";

const K = (o: Partial<ForecastKpi> = {}): ForecastKpi => ({
  key: "sales_count", label: "Sales", unit: "count", direction: "higher", kind: "additive", mtd: 240, projected: 440, band: { low: 420, high: 470, level: 0.8 },
  target: 500, pacingPct: 88, status: "at_risk", requiredDailyRate: 26, daysElapsed: 12, daysRemaining: 10, method: "weekday-seasonal-run-rate", expectedDaily: 20, partial: null, ...o,
});

describe("status chip", () => {
  it("every status carries words and an icon, never colour alone", () => {
    for (const s of Object.keys(STATUS)) { const h = renderToStaticMarkup(<StatusChip status={s} />); expect(h).toContain(STATUS[s as keyof typeof STATUS].label); expect(h).toContain("<svg"); expect(h).toContain('aria-hidden="true"'); }
  });
  it("unknown status degrades to not-enough-data", () => expect(renderToStaticMarkup(<StatusChip status="weird" />)).toContain("Not enough data"));
});

describe("barGeometry", () => {
  it("scales everything against the largest of mtd/projected/band/target", () => {
    const g = barGeometry(K({ target: 500 }));
    expect(g.target!).toBeCloseTo(500 / 520, 3); expect(g.mtd!).toBeLessThan(g.projected!); expect(g.low!).toBeLessThan(g.high!);
  });
  it("projection beyond the target is still on the bar", () => { const g = barGeometry(K({ projected: 900, band: { low: 800, high: 1000, level: 0.8 }, target: 500 })); expect(g.high!).toBeLessThanOrEqual(1); expect(g.target!).toBeLessThan(g.projected!); });
  it("percent KPIs are scaled to at least 100", () => expect(barGeometry(K({ unit: "percent", mtd: 50, projected: 52, band: null, target: null })).projected!).toBeCloseTo(52 / 104, 3));
  it("missing values give null parts, not NaN", () => { const g = barGeometry(K({ mtd: null, projected: null, band: null, target: null })); expect(g).toEqual({ mtd: null, projected: null, low: null, high: null, target: null }); });
});

describe("PacingBar", () => {
  it("is an image with a full spoken summary", () => {
    const h = renderToStaticMarkup(<PacingBar k={K()} />);
    expect(h).toContain('role="img"'); expect(h).toContain("240 so far"); expect(h).toContain("projected 440"); expect(h).toContain("range 420 to 470"); expect(h).toContain("target 500");
  });
  it("says there is no target / no projection rather than implying one", () => {
    const h = renderToStaticMarkup(<PacingBar k={K({ target: null, projected: null, band: null, status: "nodata" })} />);
    expect(h).toContain("no projection"); expect(h).toContain("no target");
  });
});

describe("PacingCard", () => {
  it("shows projection, range, target, needed rate and working days as text", () => {
    const h = renderToStaticMarkup(<PacingCard k={K()} selected={false} onSelect={() => undefined} />);
    expect(h).toContain("At risk"); expect(h).toContain("Projected month-end"); expect(h).toContain("80% range 420 to 470"); expect(h).toContain("Needed per working day"); expect(h).toContain("12 done, 10 left");
    expect(h).toContain("Same-weekday average of the last 8 weeks"); expect(h).toContain('aria-pressed="false"');
  });
  it("no target: says so, offers no pacing or needed rate", () => {
    const h = renderToStaticMarkup(<PacingCard k={K({ target: null, pacingPct: null, requiredDailyRate: null, status: "no_target" })} selected onSelect={() => undefined} />);
    expect(h).toContain("No target set"); expect(h).toContain("None configured"); expect(h).not.toContain("Projected vs target"); expect(h).not.toContain("Needed per working day"); expect(h).toContain('aria-pressed="true"');
  });
  it("nodata: no invented number, the reason is printed", () => {
    const h = renderToStaticMarkup(<PacingCard k={K({ projected: null, band: null, status: "nodata", reason: "Only 3 worked day(s) of history; at least 7 are needed", method: "insufficient-history", pacingPct: null, expectedDaily: null })} selected={false} onSelect={() => undefined} />);
    expect(h).toContain("Not enough data"); expect(h).toContain("Only 3 worked day"); expect(h).toContain("—");
  });
  it("finished month labels the figure Final and hides the remaining-day rows", () => {
    const h = renderToStaticMarkup(<PacingCard k={K({ daysRemaining: 0, requiredDailyRate: null, expectedDaily: null, status: "on_track" })} selected={false} onSelect={() => undefined} />);
    expect(h).toContain("Final"); expect(h).not.toContain("Expected per working day");
  });
  it("reports today's uncounted partial", () => expect(renderToStaticMarkup(<PacingCard k={K({ partial: { date: "2026-09-17", value: 30 } })} selected={false} onSelect={() => undefined} />)).toContain("today so far 30 (not counted)"));
  it("the select control is a labelled real button with visible focus styling", () => {
    const h = renderToStaticMarkup(<PacingCard k={K()} selected={false} onSelect={() => undefined} />);
    expect(h).toContain("<button"); expect(h).toContain("focus-visible:ring-2"); expect(h).toContain("min-h-[36px]");
  });
});

describe("chartRows / monthOptions", () => {
  it("maps the path and keeps a band only where both ends exist", () => {
    const rows = chartRows(K({ path: [{ date: "2026-09-16", actual: 10, projected: 10, low: 10, high: 10 }, { date: "2026-09-17", actual: null, projected: 20, low: 15, high: 25 }, { date: "2026-09-18", actual: null, projected: 30, low: null, high: null }] }));
    expect(rows[1]).toEqual({ date: "2026-09-17", actual: null, projected: 20, band: [15, 25] }); expect(rows[2].band).toBeNull();
  });
  it("no path gives no rows", () => expect(chartRows(K())).toEqual([]));
  it("monthOptions lists the current and three previous months across a year boundary", () => expect(monthOptions(new Date(2026, 1, 15))).toEqual(["2026-02", "2026-01", "2025-12", "2025-11"]));
});
