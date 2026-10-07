/** Static-markup tests of the Summary charts (node env, no DOM). Sorting, selectors, the table toggle and CSV download need the live check. */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/hrmsApi", () => ({ hrmsApi: { get: vi.fn(() => new Promise(() => undefined)) } }));

import ChartFrame from "../command/charts/ChartFrame";
import KpiStrip from "../command/charts/KpiStrip";
import FunnelCompare from "../command/charts/FunnelCompare";
import YieldChart from "../command/charts/YieldChart";
import ConversionHeatmap from "../command/charts/ConversionHeatmap";
import TimingHeatmap from "../command/charts/TimingHeatmap";
import ShowRateScatter from "../command/charts/ShowRateScatter";
import DropOffWaterfall from "../command/charts/DropOffWaterfall";
import CompareTable from "../command/charts/CompareTable";
import { typePatternDefs } from "../command/charts/TypePatterns";
import {
  CSV_COLUMNS, EMPTY_TEXT, UNTRACKED_NOTE, compareCsvName, compareCsvRows, cellInk, compareView, contrastRatio, conversionView, funnelView, inkOn,
  kpiView, scatterView, timingView, waterfallView, yieldView,
} from "../command/charts/summaryView";
import { sectionParts } from "../command/DriveCommandCenter";
import { funnelChart } from "../command/driveChartModel";
import { SEQ_RAMP, divergingColor } from "../command/chartTheme";
import { toCsv } from "../command/driveCommandModel";
import { STAGES } from "../command/driveCommandTypes";
import type { DriveAnalytics, Grid, SourceType, StageCounts } from "../command/driveCommandTypes";

// ---- fixtures (the Task 9 fixture, with a 14-day window and a previous period for the change arrow) ---------------------------------------
const TYPES: SourceType[] = ["meta_live", "meta_old", "he"];
const sc = (o: Partial<StageCounts> = {}): StageCounts => ({ leads: 0, qualified: 0, invited: 0, confirmed: 0, arrived: 0, selected: 0, joined: 0, ...o });
const conv = (s: StageCounts) => STAGES.slice(1).map((to, i) => ({ from: STAGES[i], to, rate: s[STAGES[i]] > 0 ? s[to] / s[STAGES[i]] : null }));
const typ = (s: StageCounts, prev: StageCounts = sc(), spark: number[] = []) => ({ stages: s, previous: prev, noShow: 0, declined: 0, conversions: conv(s), sparkline: spark });
const zeroGrid = (): Grid => Array.from({ length: 7 }, () => Array(24).fill(0));
const byType = (l: number, o: number, h: number) => ({
  meta_live: { invited: l, confirmed: l, arrived: l }, meta_old: { invited: o, confirmed: o, arrived: o }, he: { invited: h, confirmed: h, arrived: h },
});
const live = sc({ leads: 100, qualified: 60, invited: 50, confirmed: 30, arrived: 20, selected: 10, joined: 8 });
const he = sc({ leads: 40, qualified: 30, invited: 30, confirmed: 24, arrived: 20, selected: 12, joined: 9 });
const heTiming = zeroGrid(); heTiming[6][23] = 2; heTiming[0][10] = 1;
const fixture = (over: Partial<DriveAnalytics> = {}): DriveAnalytics => ({
  generatedAt: "2026-10-14T05:00:00Z", window: { from: "2026-10-01", to: "2026-10-14", days: 14 }, previousWindow: { from: "2026-09-17", to: "2026-09-30" },
  filter: { requisitionId: null, branch: null }, followupMode: "dry_run", qualifiedTracked: true,
  types: { meta_live: typ(live, sc({ arrived: 8 }), [0, 1, 2, 3, 4, 5]), meta_old: typ(sc()), he: typ(he, sc({ arrived: 20 }), [0, 2, 4]) }, typesPresent: ["meta_live", "he"],
  daily: ["2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14"].map((date, i) => ({ date, target: 25, byType: byType(i, 0, i * 2) })),
  timing: { replies: { meta_live: zeroGrid(), meta_old: zeroGrid(), he: heTiming }, arrivals: { meta_live: zeroGrid(), meta_old: zeroGrid(), he: zeroGrid() }, arrivalsWithoutTime: 3 },
  scatter: Array.from({ length: 8 }, (_, i) => ({ requisitionId: `r${i}`, code: `REQ-${i}`, branch: `B${i}`, sourceType: TYPES[i % 3], leads: 10 + i * 7, showRate: 0.3 + i / 100, leadToJoinRate: 0.05 + i / 200 })),
  waterfall: {
    meta_live: [
      { from: "leads", to: "qualified", lost: 40, reasons: [{ reason: "not_qualified", n: 40 }] },
      { from: "qualified", to: "invited", lost: 10, reasons: [{ reason: "not_invited", n: 10 }] },
      { from: "invited", to: "confirmed", lost: 20, reasons: [{ reason: "declined", n: 4 }, { reason: "no_reply", n: 16 }] },
      { from: "confirmed", to: "arrived", lost: 10, reasons: [{ reason: "no_show", n: 10 }] },
    ],
    meta_old: [], he: [],
  },
  groups: [], cost: { available: false, note: "Cost per source arrives with Plan 5" }, insights: [], requisitionCount: 3, truncated: false, partial: false, failedSections: [],
  ...over,
}) as unknown as DriveAnalytics;
const emptyFixture = (): DriveAnalytics => fixture({
  types: { meta_live: typ(sc()), meta_old: typ(sc()), he: typ(sc()) }, typesPresent: [], daily: [], scatter: [], waterfall: { meta_live: [], meta_old: [], he: [] },
  timing: { replies: { meta_live: [], meta_old: [], he: [] }, arrivals: { meta_live: [], meta_old: [], he: [] }, arrivalsWithoutTime: 0 },
} as Partial<DriveAnalytics>);
const untracked = (): DriveAnalytics => fixture({ followupMode: "off", qualifiedTracked: false });
const longLabels = (): DriveAnalytics => fixture({ scatter: [{ requisitionId: "x", code: `REQ-${"VERY-LONG-REQUISITION-CODE-".repeat(8)}END`, branch: `Branch ${"Name ".repeat(30)}`, sourceType: "he", leads: 50, showRate: 0.5, leadToJoinRate: 0.1 }] });

type Chart = (p: { analytics: DriveAnalytics }) => React.ReactElement | null;
const CHARTS: Array<[string, Chart]> = [
  ["KPI", KpiStrip], ["Funnel", FunnelCompare], ["Yield", YieldChart], ["Conversion", ConversionHeatmap], ["Timing", TimingHeatmap],
  ["Scatter", ShowRateScatter], ["Waterfall", DropOffWaterfall], ["Compare", CompareTable],
];
const render = (C: Chart, a: DriveAnalytics) => renderToStaticMarkup(<C analytics={a} />);
const decode = (s: string) => s.split("&amp;").join("&").split("&quot;").join("\"").split("&#x27;").join("'").split("&lt;").join("<").split("&gt;").join(">");
const strip = (s: string) => decode(s.replace(/<[^>]*>/g, "")).trim();
/** The rows of the n-th <table> in the markup, as cell texts (th and td). */
function tableRows(html: string, n = 0): string[][] {
  const table = html.split("<table").slice(1)[n].split("</table>")[0];
  const body = table.includes("<tbody") ? table.split("<tbody")[1] : table;
  return body.split("<tr").slice(1).map((tr) => (tr.match(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/g) ?? []).map(strip));
}
function caption(html: string, n = 0): string { return strip(html.split("<caption")[n + 1].split("</caption>")[0].replace(/^[^>]*>/, "")); }
const noBadValues = (html: string) => { for (const bad of ["NaN", "undefined", "Infinity", "null"]) expect(html).not.toContain(bad); };

describe("every chart frame", () => {
  it.each(CHARTS.filter(([n]) => n !== "Compare"))("%s renders a title, role=img summary and a closed Show table button", (_n, C) => {
    const html = render(C, fixture());
    expect(html).toMatch(/<h3[^>]*>[^<]+<\/h3>/);
    expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*aria-controls="[^"]+"[^>]*>[\s\S]*?Show table/);
    expect(html).toMatch(/<table[^>]*>[\s\S]*<caption/);
    noBadValues(html);
  });
  it.each(CHARTS.filter(([n]) => ["Funnel", "Yield", "Scatter", "Waterfall"].includes(n)))("%s reserves its chart height and labels the chart as an image", (_n, C) => {
    const html = render(C, fixture());
    expect(html).toMatch(/role="img" aria-label="[^"]{20,}"/);
    expect(html).toMatch(/h-\[220px\] sm:h-\[280px\]|h-\[300px\] sm:h-\[360px\]/);
  });
  it.each(CHARTS)("%s: every type empty shows the empty state and no NaN", (_n, C) => {
    const html = render(C, emptyFixture());
    expect(html).toContain(EMPTY_TEXT);
    noBadValues(html);
  });
  it.each(CHARTS)("%s: very long labels and one type missing render without bad values", (_n, C) => {
    noBadValues(render(C, longLabels()));
    noBadValues(render(C, untracked()));
  });
});

describe("ChartFrame", () => {
  it("defaultTableOpen renders the adapter table: caption and every cell (parity)", () => {
    const f = funnelChart(fixture());
    const html = renderToStaticMarkup(<ChartFrame title="Funnel" table={f.table} empty={false} aria="Funnel summary" defaultTableOpen><div /></ChartFrame>);
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("Hide table");
    expect(caption(html)).toBe(f.table.caption);
    expect(tableRows(html)).toEqual(f.table.rows);
    expect(html).toMatch(/<th scope="col"[^>]*>Stage<\/th>/);
    expect(html).toMatch(/<th scope="row"[^>]*>Leads<\/th>/);
  });
  it("empty shows the empty state instead of the chart", () => {
    const html = renderToStaticMarkup(<ChartFrame title="X" table={{ caption: "c", columns: ["a"], rows: [] }} empty aria="x"><div id="chart-body" /></ChartFrame>);
    expect(html).toContain(EMPTY_TEXT);
    expect(html).not.toContain("chart-body");
  });
});

describe("parity: the rendered table equals the view-model table", () => {
  const a = fixture();
  it("funnel", () => { const v = funnelView(a); const html = render(FunnelCompare, a); expect(caption(html)).toBe(v.table.caption); expect(tableRows(html)).toEqual(v.table.rows); });
  it("yield", () => { const v = yieldView(a); expect(tableRows(render(YieldChart, a))).toEqual(v.table.rows); expect(v.table.rows).toHaveLength(5); });
  it("scatter", () => { expect(tableRows(render(ShowRateScatter, a))).toEqual(scatterView(a).table.rows); });
  it("waterfall (default type is the first present)", () => { expect(tableRows(render(DropOffWaterfall, a))).toEqual(waterfallView(a, "meta_live").table.rows); });
  it("KPI tiles show exactly the table values", () => {
    const v = kpiView(a); const html = render(KpiStrip, a);
    expect(tableRows(html)).toEqual(v.table.rows);
    for (const t of v.tiles) for (const s of t.values) expect(html).toContain(`data-stage="${t.sourceType}-${s.stage}">${s.text}<`);
  });
  it("conversion grid cells equal the table cells", () => {
    const v = conversionView(a); const html = render(ConversionHeatmap, a);
    const grid = tableRows(html, 0); const table = tableRows(html, 1);
    expect(table).toEqual(v.table.rows);
    v.rows.forEach((r, i) => r.cells.forEach((c, k) => expect(grid[i][1 + k].startsWith(c.text)).toBe(true)));
  });
  it("timing grid cells equal the table cells and the peak is called out in text", () => {
    const v = timingView(a, "replies", "he");
    const html = renderToStaticMarkup(<TimingHeatmap analytics={a} initialType="he" />);
    expect(tableRows(html, 0)).toEqual(v.table.rows);
    expect(tableRows(html, 1)).toEqual(v.table.rows);
    expect(html).toContain("Busiest: Sun 23:00 IST with 2 replies");
  });
  it("compare table cells", () => {
    const html = render(CompareTable, a);
    const rows = tableRows(html);
    expect(rows.map((r) => r[0])).toEqual(["Live Meta", "Old Meta data", "Hiring Engine"]);
    expect(rows[0].slice(1)).toEqual(["100", "60", "50", "30", "20", "10", "8", "67%", "8%"]);
  });
});

describe("KPI strip", () => {
  it("three tiles, change arrow as icon and words, sparkline labelled, cost placeholder", () => {
    const html = render(KpiStrip, fixture());
    expect(html.match(/data-kpi-tile=/g)).toHaveLength(3);
    expect(html).toContain("+12 vs previous 14 days");
    expect(html).toContain("no change vs previous 14 days");
    expect(html).toContain('aria-label="Daily arrivals: 0, 1, 2, 3, 4, 5"');
    expect(html).toContain("lucide-arrow-up");
    expect(html).toContain("lucide-minus");
    expect(html).toContain("Cost per source arrives with Plan 5");
  });
  it("a type without data says so in words", () => {
    expect(render(KpiStrip, fixture())).toContain("No activity in this range");
  });
});

describe("follow-up mode off (qualifiedTracked false)", () => {
  it("qualified shows an en dash and the note, never a zero", () => {
    const a = untracked();
    const kpi = render(KpiStrip, a);
    expect(kpi).toContain(UNTRACKED_NOTE);
    expect(kpi).toContain('data-stage="meta_live-qualified">–<');
    const funnel = funnelView(a);
    expect(funnel.table.rows[1]).toEqual(["Qualified", "–", "–", "–", "–", "–", "–"]);
    expect(funnel.rows[2].convText).toBe("– / – / –");
    expect(funnel.biggestDrop.meta_live).not.toBe("qualified");
    expect(render(FunnelCompare, a)).toContain(UNTRACKED_NOTE);
    const conv = conversionView(a);
    expect(conv.rows[0].cells[0].text).toBe("–");
    expect(conv.rows[0].cells[1].text).toBe("–");
    expect(render(ConversionHeatmap, a)).toContain(UNTRACKED_NOTE);
    const cmp = tableRows(render(CompareTable, a));
    expect(cmp[0][2]).toBe("–");
    const wf = waterfallView(a, "meta_live");
    expect(wf.bars.map((b) => b.label)).toEqual(["Invited to Confirmed", "Confirmed to Arrived"]);
    expect(render(DropOffWaterfall, a)).toContain(UNTRACKED_NOTE);
  });
  it("tracked mode shows the real qualified numbers", () => {
    expect(funnelView(fixture()).table.rows[1].slice(1, 2)).toEqual(["60"]);
    expect(render(KpiStrip, fixture())).not.toContain(UNTRACKED_NOTE);
  });
});

describe("conversion heatmap", () => {
  it("null cells print an en dash, headers are scoped, above/below carries an icon and words", () => {
    const html = render(ConversionHeatmap, fixture());
    expect(html).toContain(">–<");
    expect(html).toMatch(/<th scope="col"/);
    expect(html).toMatch(/<th scope="row"/);
    expect(html).toMatch(/lucide-arrow-(up|down)/);
    expect(html).toMatch(/(above|below) average/);
  });
});

describe("timing heatmap", () => {
  it("type and kind selectors are pressed buttons; arrivals without time are noted", () => {
    const html = renderToStaticMarkup(<TimingHeatmap analytics={fixture()} initialType="he" initialKind="arrivals" />);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(2);
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(3);
    expect(html).toContain("3 arrivals have no recorded time");
  });
});

describe("waterfall", () => {
  it("type selector and reasons in the table", () => {
    const html = render(DropOffWaterfall, fixture());
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toContain("declined 4, no reply 16");
  });
});

describe("compare table and CSV", () => {
  it("three rows including Old Meta data with zeros, sortable headers, labelled Export CSV", () => {
    const html = render(CompareTable, fixture());
    const rows = tableRows(html);
    expect(rows).toHaveLength(3);
    expect(rows[1]).toEqual(["Old Meta data", "0", "0", "0", "0", "0", "0", "0", "–", "–"]);
    expect(html.match(/aria-sort="(none|ascending|descending)"/g)?.length).toBe(9);
    expect(html).toContain("Export CSV");
    expect(html).toContain('aria-label="Export the comparison as CSV for 2026-10-01 to 2026-10-14"');
  });
  it("CSV: name has the range, rows match the table, formulas neutralised", () => {
    const a = fixture();
    expect(compareCsvName(a)).toBe("drive-comparison-2026-10-01-to-2026-10-14.csv");
    const csv = toCsv(CSV_COLUMNS, compareCsvRows(compareView(a).rows));
    expect(csv.split("\r\n")[1]).toBe("Live Meta,100,60,50,30,20,10,8,67%,8%");
    expect(toCsv(CSV_COLUMNS, [{ type: "=HYPERLINK(1)" }])).toContain("'=HYPERLINK(1)");
    expect(toCsv(CSV_COLUMNS, compareCsvRows(compareView(untracked()).rows)).split("\r\n")[1]).toBe("Live Meta,100,,50,30,20,10,8,67%,8%");
  });
});

describe("patterns, colours and the summary section", () => {
  it("pattern defs carry one pattern per type with the prefix", () => {
    const html = renderToStaticMarkup(<svg>{typePatternDefs("p1", false)}</svg>);
    expect(html.match(/<pattern /g)).toHaveLength(3);
    expect(html).toContain('id="p1-tex-meta-live"');
  });
  it("heat cell ink keeps 4.5:1 on every ramp and diverging step, or puts the number on a light plate", () => {
    const fills = [...SEQ_RAMP, ...[-0.5, -0.2, -0.1, 0, 0.1, 0.2, 0.5].flatMap((d) => [divergingColor(d, false), divergingColor(d, true)])];
    for (const bg of fills) {
      const ink = cellInk(bg);
      if (ink.plate) expect(contrastRatio("#ffffff", ink.color)).toBeGreaterThanOrEqual(4.5);
      else expect(contrastRatio(bg, ink.color)).toBeGreaterThanOrEqual(4.5);
    }
    expect(cellInk("#2a78d6").plate).toBe(true);
    expect(inkOn("#104281")).toBe("#ffffff");
  });
  it("summary section renders every chart over the analytics", () => {
    const html = renderToStaticMarkup(<>{sectionParts("summary", fixture()).gated}</>);
    for (const t of ["Drive types at a glance", "Funnel by drive type", "Daily arrivals against target", "Conversion by stage", "When people reply and arrive", "Show rate against lead to join", "Where people drop off", "Compare drive types"]) {
      expect(html).toContain(t);
    }
    expect(html).toContain("lg:grid-cols-2");
  });
});
