/** Cost per source in the Summary tiles and compare table (node env: pure view-models + static markup). Sorting and CSV download need the live check. */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/hrmsApi", () => ({ hrmsApi: { get: vi.fn(() => new Promise(() => undefined)) } }));

import KpiStrip from "../command/charts/KpiStrip";
import CompareTable from "../command/charts/CompareTable";
import { compareColumnsFor, costNoteFor, costTiles, moneyText } from "../command/charts/costView";
import { compareCsvRows, compareView, csvColumnsFor } from "../command/charts/summaryView";
import { COMPARE_COLUMNS, sectionLabels, toCsv } from "../command/driveCommandModel";
import { STAGES } from "../command/driveCommandTypes";
import type { CostBlock, DriveAnalytics, SourceType, StageCounts, TypeCost } from "../command/driveCommandTypes";

const TYPES: SourceType[] = ["meta_live", "meta_old", "he"];
const sc = (o: Partial<StageCounts> = {}): StageCounts => ({ leads: 0, qualified: 0, invited: 0, confirmed: 0, arrived: 0, selected: 0, joined: 0, ...o });
const conv = (s: StageCounts) => STAGES.slice(1).map((to, i) => ({ from: STAGES[i], to, rate: s[STAGES[i]] > 0 ? s[to] / s[STAGES[i]] : null }));
const typ = (s: StageCounts) => ({ stages: s, previous: sc(), noShow: 0, declined: 0, conversions: conv(s), sparkline: [0, 1, 2] });
const usage = { adSpend: 0, waConversations: 0, calls: 0, callMinutes: 0, emails: 0 };
const tc = (o: Partial<TypeCost> = {}): TypeCost => ({ total: 0, adSpend: 0, messaging: 0, perLead: null, perQualified: null, perArrival: null, perJoin: null, usage, ...o });
const PLACEHOLDER = { available: false as const, note: "Cost per source arrives with Plan 5" };
const block = (o: Partial<CostBlock> = {}): CostBlock => ({
  available: true, estimated: true, ratesConfigured: true, note: "Estimated: Meta ad spend is the last 30-day total spread over the days in range.",
  rates: { "cost.whatsapp_per_conversation": 0.8, "cost.call_per_minute": 0.5, "cost.call_per_call": 1, "cost.email": 0 },
  byType: { meta_live: tc({ total: 3270, perLead: 21.8, perQualified: 54.5, perArrival: 272.5, perJoin: 1090 }), meta_old: tc(), he: tc({ total: 123456.7, perLead: null, perJoin: 123456.7 }) },
  ...o,
});
const fixture = (cost: DriveAnalytics["cost"] = PLACEHOLDER, over: Partial<DriveAnalytics> = {}): DriveAnalytics => ({
  generatedAt: "2026-10-14T05:00:00Z", window: { from: "2026-10-01", to: "2026-10-14", days: 14 }, previousWindow: { from: "2026-09-17", to: "2026-09-30" },
  filter: { requisitionId: null, branch: null }, followupMode: "live", qualifiedTracked: true,
  types: { meta_live: typ(sc({ leads: 150, qualified: 60, invited: 50, confirmed: 30, arrived: 12, selected: 5, joined: 3 })), meta_old: typ(sc()), he: typ(sc({ leads: 20, joined: 1 })) },
  typesPresent: ["meta_live", "he"], daily: [], timing: { replies: {}, arrivals: {}, arrivalsWithoutTime: 0 }, scatter: [], waterfall: { meta_live: [], meta_old: [], he: [] },
  groups: [], cost, insights: [], requisitionCount: 1, truncated: false, partial: false, failedSections: [], ...over,
}) as unknown as DriveAnalytics;
const render = (C: (p: { analytics: DriveAnalytics }) => React.ReactElement | null, a: DriveAnalytics): string => renderToStaticMarkup(React.createElement(C, { analytics: a }));
const text = (html: string): string => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("moneyText", () => {
  it.each([[1090, "₹1,090"], [21.8, "₹21.8"], [123456.7, "₹1,23,457"], [0, "₹0"], [99.995, "₹100"], [null, "–"], [Number.NaN, "–"], [Infinity, "–"]])("%s", (n, out) => {
    expect(moneyText(n as number | null)).toBe(out);
  });
});

describe("costTiles", () => {
  it("is null while cost is unavailable, for the placeholder and for a block without types", () => {
    expect(costTiles(fixture())).toBeNull();
    expect(costTiles(fixture(block({ available: false, byType: null })))).toBeNull();
    expect(costTiles(fixture(undefined as never))).toBeNull();
  });
  it("gives one block per type with Spend, Per lead, Per arrival and Per join", () => {
    const t = costTiles(fixture(block()));
    expect(t?.map((x) => x.sourceType)).toEqual(TYPES);
    expect(t?.[0].rows.map((r) => r.label)).toEqual(["Spend", "Per lead", "Per arrival", "Per join"]);
    expect(t?.[0].rows.find((r) => r.label === "Per join")?.text).toBe("₹1,090");
    expect(t?.[0].rows.find((r) => r.label === "Spend")?.text).toBe("₹3,270");
    expect(t?.[2].rows.find((r) => r.label === "Per lead")?.text).toBe("–");
  });
});

describe("KPI strip cost tile", () => {
  it("keeps today's placeholder wording and shows no rupee sign while unavailable", () => {
    const html = render(KpiStrip, fixture());
    expect(html).toContain("Cost per source arrives with Plan 5");
    expect(html).toContain("Cost per source");
    expect(html).not.toContain("₹");
  });
  it("shows the estimated title, per-type figures, a dash for a missing divisor and the note", () => {
    const html = render(KpiStrip, fixture(block()));
    expect(html).toContain("Cost per source (estimated)");
    expect(html).not.toContain("arrives with Plan 5");
    expect(html).toContain("₹1,090");
    expect(text(html)).toContain("Per lead –");
    expect(html).toContain("Estimated: Meta ad spend is the last 30-day total");
  });
  it("says so when a cost read failed instead of presenting the figures as complete", () => {
    const html = render(KpiStrip, fixture(block(), { partial: true, failedSections: ["cost:spend"] }));
    expect(costNoteFor(fixture(block(), { failedSections: ["cost:spend"] }))).toContain("Meta ad spend");
    expect(text(html)).toContain("could not be read");
  });
  it("on a failed cost read, drops the notes that say nothing is set up (they contradict the partial banner)", () => {
    const none = "No cost source yet: no Meta ad spend is synced for these requisitions and no messaging rates are set";
    const failed = { partial: true, failedSections: ["cost:spend"] };
    const a = fixture({ available: false, estimated: false, ratesConfigured: false, note: none, byType: null } as never, failed);
    expect(costNoteFor(a)).not.toContain("No cost source yet");
    expect(costNoteFor(a)).toContain("could not be read");
    expect(text(render(KpiStrip, a))).not.toContain("No cost source yet");
    expect(text(render(KpiStrip, a))).toContain("could not be read");
    const b = fixture(block({ ratesConfigured: false, note: "Estimated: x. Messaging rates are not set, so only ad spend counts." }), failed);
    expect(costNoteFor(b)).not.toContain("Messaging rates are not set");
    expect(costNoteFor(b)).toContain("Estimated: x.");
    expect(costNoteFor(fixture({ available: false, note: none } as never))).toBe(none);
  });
  it("shows no rupee figure and no NaN for a block with only nulls", () => {
    const html = render(KpiStrip, fixture(block({ byType: { meta_live: tc(), meta_old: tc(), he: tc() } })));
    expect(html).not.toMatch(/NaN|Infinity|undefined/);
  });
});

describe("compare table with cost", () => {
  it("adds the four estimated money columns only when available", () => {
    expect(compareColumnsFor(fixture())).toEqual(COMPARE_COLUMNS);
    const cols = compareColumnsFor(fixture(block()));
    expect(cols.slice(0, COMPARE_COLUMNS.length)).toEqual(COMPARE_COLUMNS);
    expect(cols.slice(COMPARE_COLUMNS.length)).toEqual([
      { key: "cost_per_lead", label: "Cost per lead (est.)", kind: "money" }, { key: "cost_per_qualified", label: "Cost per qualified (est.)", kind: "money" },
      { key: "cost_per_arrival", label: "Cost per arrival (est.)", kind: "money" }, { key: "cost_per_join", label: "Cost per join (est.)", kind: "money" },
    ]);
  });
  it("has 4 more column headings and the caption says costs are estimated", () => {
    const base = render(CompareTable, fixture());
    const withCost = render(CompareTable, fixture(block()));
    const heads = (h: string) => (h.match(/<th /g) ?? []).length;
    expect(heads(withCost) - heads(base)).toBe(4);
    expect(base).not.toContain("Costs are estimated");
    expect(withCost).toContain("Costs are estimated");
    expect(withCost).toContain("₹1,090");
    expect(base).not.toContain("₹");
  });
  it("exports the money columns to CSV with a null as empty", () => {
    const a = fixture(block());
    const csv = toCsv(csvColumnsFor(a), compareCsvRows(compareView(a).rows, compareColumnsFor(a))).split("\r\n");
    expect(csv[0]).toContain("Cost per join (est.)");
    expect(csv[1].endsWith(",21.8,54.5,272.5,1090")).toBe(true);
    expect(csv[2].endsWith(",,,,")).toBe(true);
    expect(csv[3].endsWith(",,,123456.7")).toBe(true);
    expect(toCsv(csvColumnsFor(fixture()), compareCsvRows(compareView(fixture()).rows)).split("\r\n")[0]).not.toContain("Cost per");
  });
});

describe("failed section words", () => {
  it("names the cost sections in plain words", () => {
    expect(sectionLabels(["cost:rates", "cost:spend", "cost:messages", "cost:calls"])).toEqual(["cost rates", "Meta ad spend", "message counts", "call counts"]);
  });
});
