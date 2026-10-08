/** Funnel: Confirmed split by channel and response rate per channel and drive type (model + static markup, same adapter). */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ResponseChannels from "../command/ResponseChannels";
import JourneyCompare from "../command/charts/JourneyCompare";
import { channelTable, confirmedSplit, rateCell } from "../command/responseChannelsModel";
import { STAGES, type DriveAnalytics, type JourneyCounts, type StageCounts } from "../command/driveCommandTypes";

const sc = (o: Partial<StageCounts> = {}): StageCounts => ({ leads: 0, qualified: 0, invited: 0, confirmed: 0, arrived: 0, selected: 0, joined: 0, ...o });
const jc = (o: Partial<JourneyCounts> = {}): JourneyCounts => ({ leads: 0, fills: 0, screened: 0, qualified: 0, contacted: 0, invited: 0, replied: 0, confirmed: 0, arrived: 0, ...o });
const typ = (s: StageCounts) => ({ stages: s, previous: sc(), noShow: 0, declined: 0, conversions: STAGES.slice(1).map((to, i) => ({ from: STAGES[i], to, rate: null })), sparkline: [] });
const analyticsFixture = (): DriveAnalytics => ({
  generatedAt: "", window: { from: "2026-09-25", to: "2026-10-08", days: 14 }, previousWindow: { from: "2026-09-11", to: "2026-09-24" },
  filter: { requisitionId: null, branch: null }, followupMode: "off", qualifiedTracked: false,
  types: { meta_live: typ(sc({ leads: 91, invited: 30, confirmed: 11 })), meta_old: typ(sc({ leads: 40, invited: 20, confirmed: 5 })), he: typ(sc({ leads: 20 })) },
  journey: { meta_live: jc({ leads: 91, fills: 91, screened: 91, qualified: 78, contacted: 40, invited: 30, replied: 14, confirmed: 11 }), meta_old: jc({ leads: 40, contacted: 20, invited: 20, confirmed: 5 }), he: jc({ leads: 20 }) },
  typesPresent: ["meta_live", "meta_old", "he"], daily: [], timing: { replies: {}, arrivals: {}, arrivalsWithoutTime: 0 }, scatter: [], waterfall: { meta_live: [], meta_old: [], he: [] },
  groups: [], cost: { available: false, note: "" }, insights: [], requisitionCount: 5, truncated: false, partial: false, failedSections: [],
}) as unknown as DriveAnalytics;

const via = { email: 0, web: 0, whatsapp: 0, voice_bot: 0, call_file: 0, hr: 0, unknown: 0 };
const rate = (c: number, r: number) => ({ contacted: c, responded: r });
const zero = { email: rate(0, 0), whatsapp: rate(0, 0), voice_bot: rate(0, 0) };
const withResponses = (): DriveAnalytics => ({
  ...analyticsFixture(),
  confirmedByChannel: { meta_live: { ...via, email: 2, web: 3, whatsapp: 4, call_file: 1, hr: 1 }, meta_old: { ...via, unknown: 5 }, he: { ...via } },
  responseRate: { meta_live: { email: rate(40, 10), whatsapp: rate(10, 4), voice_bot: rate(0, 0) }, meta_old: zero, he: { ...zero, whatsapp: rate(25, 30) } },
});

describe("confirmedSplit", () => {
  it("groups email + email buttons, voice bot + calling file; words with counts", () => {
    const s = confirmedSplit(withResponses(), "meta_live")!;
    expect(s.parts.map((p) => [p.key, p.n])).toEqual([["email", 5], ["whatsapp", 4], ["voice", 1], ["manual", 1], ["unknown", 0]]);
    expect(s.total).toBe(11);
    expect(s.text).toBe("Email 5 · WhatsApp 4 · Voice bot 1 · HR by hand 1");
    expect(confirmedSplit(withResponses(), "he")!.text).toBe("No confirmations");
    expect(confirmedSplit(withResponses(), "meta_old")!.text).toBe("Before tracking 5");
  });
  it("absent on an older server: null, never zeros", () => {
    expect(confirmedSplit(analyticsFixture(), "meta_live")).toBeNull();
    expect(channelTable(analyticsFixture())).toBeNull();
  });
});

describe("rateCell", () => {
  it("rate only from MIN_SAMPLE contacted; responded never above contacted", () => {
    expect(rateCell(40, 10)).toMatchObject({ rate: 0.25, text: "10 of 40 (25%)" });
    expect(rateCell(10, 4)).toMatchObject({ rate: null, text: "4 of 10" });
    expect(rateCell(0, 0).text).toBe("none contacted");
    expect(rateCell(25, 30)).toMatchObject({ responded: 25, rate: 1 });
  });
});

describe("ResponseChannels markup = the adapter's cells (parity)", () => {
  it("summary: three type columns, both tables, every cell text from channelTable", () => {
    const a = withResponses();
    const html = renderToStaticMarkup(<ResponseChannels analytics={a} />);
    const t = channelTable(a)!;
    for (const r of t.confirmed) for (const c of r.cells) expect(html).toContain(`>${c}</td>`);
    for (const r of t.rates) for (const c of r.cells) expect(html).toContain(`>${c.text}</td>`);
    expect(html).toContain("Live Meta");
    expect(html).toContain("Response rate: answered of contacted");
    expect(html).toContain("Percentages need at least 20 people");
  });
  it("one drive section shows its type only; hidden without data", () => {
    const html = renderToStaticMarkup(<ResponseChannels analytics={withResponses()} only="meta_live" />);
    expect(html).not.toContain("Hiring Engine</th>");
    expect(renderToStaticMarkup(<ResponseChannels analytics={analyticsFixture()} />)).toBe("");
  });
  it("the funnel comparison's Confirmed cell carries the split line", () => {
    const html = renderToStaticMarkup(<JourneyCompare analytics={withResponses()} />);
    const row = html.slice(html.indexOf('data-compare-stage="confirmed"'));
    expect(row.slice(0, row.indexOf("</tr>"))).toContain("Email 5 · WhatsApp 4 · Voice bot 1 · HR by hand 1");
    expect(renderToStaticMarkup(<JourneyCompare analytics={analyticsFixture()} />)).not.toContain("data-split");
  });
});
