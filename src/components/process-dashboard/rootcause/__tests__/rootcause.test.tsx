import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WhyBody } from "../WhyDrawer";
import { WhyButton } from "../WhyButton";
import { KpiTiles } from "../../KpiTiles";
import { buildWaterfall } from "../waterfall";
import { addDays, compareRange, dayCount, defaultCmp, openWhyState, parseWhy, weekCompareValid, writeWhy } from "../whyState";
import { changeText } from "../format";
import type { WhyResponse, WhySegment } from "../types";

const seg = (key: string, contribution: number, o: Partial<WhySegment> = {}): WhySegment => ({ key, label: key, status: "both", a: 270, b: 300, delta: 30, contribution, contributionPct: null,
  rateEffect: contribution * 0.8, mixEffect: contribution * 0.2, volumeA: 500, volumeB: 500, shareA: 0.5, shareB: 0.5, lowSample: false, ...o });

describe("buildWaterfall", () => {
  const segs = [seg("TL_B", 30), seg("TL_C", -10), seg("TL_A", 5), seg("TL_D", 1), seg("TL_E", -0.5)];
  it("bars chain from 0 and the last bar equals the sum of contributions", () => {
    const bars = buildWaterfall(segs, "lower", 3);
    expect(bars.map((b) => b.key)).toEqual(["TL_B", "TL_C", "TL_A", "__other__", "__total__"]);
    expect(bars[0]).toMatchObject({ lo: 0, hi: 30 }); expect(bars[1]).toMatchObject({ lo: 20, hi: 30 });
    expect(bars[3].value).toBeCloseTo(0.5, 9); expect(bars[4].value).toBeCloseTo(25.5, 9);
  });
  it("colours by direction: a rise in a lower-is-better metric is unfavourable", () => {
    const bars = buildWaterfall(segs, "lower", 8);
    expect(bars[0].good).toBe(false); expect(bars[1].good).toBe(true);
    expect(buildWaterfall(segs, "higher", 8)[0].good).toBe(true);
  });
  it("merges a server-side Other row into the pooled tail", () => {
    const bars = buildWaterfall([seg("a", 4), seg("__other__", 2, { label: "Other (7 more)" })], "higher", 8);
    expect(bars.map((b) => b.name)).toEqual(["a", "Other (7 more)", "Total change"]); expect(bars[2].value).toBe(6);
  });
});

describe("why URL state", () => {
  const dash = { from: "2026-04-01", to: "2026-04-30" };
  it("round-trips and keeps unrelated params", () => {
    const s = { ...openWhyState("aht", "2026-04-08", "2026-04-14"), by: "agent" as const };
    const sp = writeWhy(s, new URLSearchParams("tl=TL_A&foo=1"));
    expect(sp.get("foo")).toBe("1"); expect(sp.get("tl")).toBe("TL_A");
    expect(parseWhy(sp, dash)).toEqual(s);
    expect(writeWhy(null, sp).has("why")).toBe(false); expect(writeWhy(null, sp).get("foo")).toBe("1");
  });
  it("returns null without ?why and ignores junk", () => {
    expect(parseWhy(new URLSearchParams("tl=x"), dash)).toBeNull();
    const s = parseWhy(new URLSearchParams("why=aht&wby=zzz&wfrom=bad&wcmp=nope"), dash)!;
    expect(s.by).toBe("tl"); expect(s.from).toBe("2026-04-01"); expect(s.cmp).toBe("prev");
  });
  it("sensible comparison defaults: a day vs the same weekday, a range vs the period before", () => {
    expect(defaultCmp("2026-04-14", "2026-04-14")).toBe("week"); expect(defaultCmp("2026-04-08", "2026-04-14")).toBe("prev");
    expect(compareRange({ from: "2026-04-14", to: "2026-04-14", cmp: "week", cf: "", ct: "" })).toEqual({ from: "2026-04-07", to: "2026-04-07" });
    expect(compareRange({ from: "2026-04-08", to: "2026-04-14", cmp: "prev", cf: "", ct: "" })).toEqual({ from: "2026-04-01", to: "2026-04-07" });
    expect(compareRange({ from: "2026-04-08", to: "2026-04-14", cmp: "custom", cf: "2026-03-20", ct: "2026-03-10" })).toEqual({ from: "2026-03-10", to: "2026-03-20" });
    expect(weekCompareValid("2026-04-01", "2026-04-30")).toBe(false); expect(dayCount("2026-04-01", "2026-04-07")).toBe(7); expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("format", () => {
  it("percent changes are percentage points, seconds are durations, sign is explicit", () => {
    expect(changeText(3.25, "percent")).toBe("+3.25 pp"); expect(changeText(-41, "seconds")).toBe("-41s"); expect(changeText(null, "count")).toBe("—"); expect(changeText(0, "count")).toBe("0");
  });
});

const resp: WhyResponse = {
  metric: { key: "aht", label: "AHT", unit: "seconds", direction: "lower", kind: "ratio" }, dimension: "tl",
  periods: { current: { from: "2026-04-08", to: "2026-04-14" }, baseline: { from: "2026-04-01", to: "2026-04-07" } },
  total: { a: 270, b: 366, delta: 96, deltaPct: 35.6 }, sumCheck: { sum: 96, expected: 96, diff: 0, ok: true }, segmentCount: 2, volumeUnit: "calls", minVolume: 30, warnings: [],
  explanation: ["AHT rose 1m 36s (unfavourable): 270s in the baseline period to 366s now (+35.6%).", "100% of the change comes from TL_B (+1m 36s)."],
  segments: [seg("TL_B", 96, { a: 270, b: 438, contributionPct: 100 }), seg("Tiny", 0, { lowSample: true, status: "new", a: null, b: 300 }), seg("Unassigned", 0)],
};
describe("WhyBody", () => {
  const html = renderToStaticMarkup(<WhyBody data={resp} onPick={() => undefined} />);
  it("prints the plain-language explanation and the sum check", () => {
    expect(html).toContain("100% of the change comes from TL_B"); expect(html).toContain("contributions add up to the total change");
  });
  it("has a real table alternative with headers, scope and a total row", () => {
    expect(html).toContain("<table"); expect(html).toContain('scope="col"'); expect(html).toContain('scope="row"'); expect(html).toContain("<tfoot");
    expect(html).toContain("Rate effect"); expect(html).toContain("Mix effect");
  });
  it("flags low volume and new segments as text and makes named segments drill buttons", () => {
    expect(html).toContain("Low volume"); expect(html).toContain('aria-label="Filter the dashboard to team leader TL_B"');
    expect(html).not.toContain("Filter the dashboard to team leader Unassigned");
  });
  it("chart has a text alternative naming every bar", () => {
    expect(html).toContain('role="img"'); expect(html).toContain("Waterfall of contributions"); expect(html).toContain("Total change");
  });
  it("a failed sum check is shown loudly", () => {
    const bad = renderToStaticMarkup(<WhyBody data={{ ...resp, sumCheck: { sum: 1, expected: 2, diff: -1, ok: false } }} onPick={() => undefined} />);
    expect(bad).toContain("do not add up");
  });
});

describe("entry points", () => {
  it("Why button is a labelled real button", () => {
    const h = renderToStaticMarkup(<WhyButton label="AHT" onClick={() => undefined} />);
    expect(h).toContain('<button type="button"'); expect(h).toContain('aria-label="Why did AHT change?"'); expect(h).toContain("focus-visible:ring-2");
  });
  it("every tile with a value gets a Why button, and none without onWhy", () => {
    const kpis = [{ key: "aht", label: "AHT", value: 300 }, { key: "calls", label: "Calls", value: null }];
    const withWhy = renderToStaticMarkup(<KpiTiles loading={false} activeKey="" onSelect={() => undefined} onWhy={() => undefined} kpis={kpis} />);
    expect(withWhy).toContain("Why did AHT change?"); expect(withWhy).not.toContain("Why did Calls change?");
    expect(renderToStaticMarkup(<KpiTiles loading={false} activeKey="" onSelect={() => undefined} kpis={kpis} />)).not.toContain("Why did");
  });
});
