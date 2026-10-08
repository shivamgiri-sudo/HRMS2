/** Funnel depth components and their placement (node env, static markup). Clicks, sorting and CSV download need the live check. */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/hrmsApi", () => ({ hrmsApi: { get: vi.fn(() => new Promise(() => undefined)) } }));
vi.mock("@/hooks/useUserRole", () => ({ useHasRole: vi.fn(() => true) }));

import JourneyCompare from "../command/charts/JourneyCompare";
import JourneyFunnel from "../command/charts/JourneyFunnel";
import CampaignProgressTable from "../command/CampaignProgressTable";
import FootfallPlan from "../command/FootfallPlan";
import InsightsPanel from "../command/InsightsPanel";
import { sectionParts } from "../command/DriveCommandCenter";
import { driveJourney, journeyCompare } from "../command/charts/journeyModel";
import { PLAN_LINK_TEXT } from "../command/footfallModel";
import { commandHash, defaultFilters } from "../command/driveCommandModel";
import { STAGES } from "../command/driveCommandTypes";
import type { CampaignProgress, DriveAnalytics, DriveInsight, JourneyCounts, StageCounts } from "../command/driveCommandTypes";

const NOW = new Date("2026-10-08T06:00:00Z");
const sc = (o: Partial<StageCounts> = {}): StageCounts => ({ leads: 0, qualified: 0, invited: 0, confirmed: 0, arrived: 0, selected: 0, joined: 0, ...o });
const jc = (o: Partial<JourneyCounts> = {}): JourneyCounts => ({ leads: 0, fills: 0, screened: 0, qualified: 0, contacted: 0, invited: 0, replied: 0, confirmed: 0, arrived: 0, ...o });
const typ = (s: StageCounts, noShow = 0) => ({ stages: s, previous: sc(), noShow, declined: 0, conversions: STAGES.slice(1).map((to, i) => ({ from: STAGES[i], to, rate: null })), sparkline: [] });
const st = (o: Partial<CampaignProgress["stages"]> = {}): CampaignProgress["stages"] =>
  ({ leads: 0, fills: 0, screened: 0, qualified: 0, contacted: 0, invited: 0, replied: 0, confirmed: 0, arrived: 0, selected: 0, joined: 0, ...o });
const stalledInsight: DriveInsight = {
  id: "stalled_leads:meta_live:r2:c2", rule: "stalled_leads", severity: "critical", sourceType: "meta_live", requisitionId: "r2", title: "K7BK night: 64 qualified Live Meta leads have had no contact",
  evidence: [{ label: "Qualified at screening", value: "64" }], suggestion: "Outreach is blocked.", effect: { value: 64, unit: "people", text: "about 64 people" },
  action: { type: "open_section", section: "live" }, ownerAction: "HR: on Meta Campaigns, relink this campaign to an open requisition.",
};
const heInsight: DriveInsight = { ...stalledInsight, id: "no_show_leak:he:all:", rule: "no_show_leak", sourceType: "he", title: "Hiring Engine: most confirmed people do not come", ownerAction: undefined };
const prod = (over: Partial<DriveAnalytics> = {}): DriveAnalytics => ({
  generatedAt: "", window: { from: "2026-09-25", to: "2026-10-08", days: 14 }, previousWindow: { from: "2026-09-11", to: "2026-09-24" },
  filter: { requisitionId: null, branch: null }, followupMode: "off", qualifiedTracked: false,
  types: { meta_live: typ(sc({ leads: 91 })), meta_old: typ(sc({ leads: 344, invited: 257, confirmed: 18, arrived: 3 }), 190), he: typ(sc({ leads: 241, invited: 112, confirmed: 8 }), 105) },
  journey: {
    meta_live: jc({ leads: 91, fills: 91, screened: 91, qualified: 78 }),
    meta_old: jc({ leads: 344, fills: 103, screened: 103, qualified: 37, contacted: 257, invited: 257, replied: 25, confirmed: 18, arrived: 3 }),
    he: jc({ leads: 241, contacted: 112, invited: 112, replied: 40, confirmed: 30 }),
  },
  campaigns: [
    { campaignId: "c2", campaignName: "K7BK night", campaignStatus: "active", campaignRequisitionCode: "REQ-2609-K7BK", requisitionId: "r2", requisitionCode: "REQ-2609-K7BK", branch: "NOIDA-2", sourceType: "meta_live",
      blockers: [{ code: "requisition_closed", text: "REQ-2609-K7BK: requisition is closed, so outreach refuses its leads" }], stages: st({ leads: 72, fills: 72, screened: 72, qualified: 64 }) },
    { campaignId: "c1", campaignName: "Ahmedabad", campaignStatus: "draft", campaignRequisitionCode: "AHMEDABAD-SBI-1", requisitionId: "r1", requisitionCode: "AHMEDABAD-SBI-1", branch: "AHMEDABAD", sourceType: "meta_old",
      blockers: [], stages: st({ leads: 165, fills: 100, screened: 100, qualified: 37, contacted: 78, invited: 78, confirmed: 11 }) },
  ],
  openSeats: [{ requisitionId: "r1", code: "AHMEDABAD-SBI-1", branch: "AHMEDABAD", open: 32, closedReason: null }, { requisitionId: "r9", code: "NOIDA-Onfido-17", branch: "NOIDA-2", open: 15, closedReason: null },
    { requisitionId: "r2", code: "REQ-2609-K7BK", branch: "NOIDA-2", open: 0, closedReason: "requisition is closed" }],
  typesPresent: ["meta_live", "meta_old", "he"], daily: [], timing: { replies: {}, arrivals: {}, arrivalsWithoutTime: 0 }, scatter: [], waterfall: { meta_live: [], meta_old: [], he: [] },
  groups: [], cost: { available: false, note: "" }, insights: [stalledInsight, heInsight], requisitionCount: 5, truncated: false, partial: false, failedSections: [], ...over,
}) as unknown as DriveAnalytics;
const cellText = (html: string): string[][] => [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => [...m[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => c[1].replace(/<[^>]+>/g, "").trim()));
const filters = defaultFilters(NOW);
const noop = () => undefined;

describe("JourneyFunnel", () => {
  it("lists every stage with count, step rate and loss, marks the largest loss in words, and ships the model's table", () => {
    const html = renderToStaticMarkup(<JourneyFunnel analytics={prod()} type="meta_live" />);
    expect(html).toContain('data-journey-stage="meta_live-contacted"');
    expect(html).toContain("Largest loss: Qualified to Contacted, 78 people");
    expect(html).toContain("largest loss</span>");
    const j = driveJourney(prod(), "meta_live");
    const rows = cellText(html).filter((r) => r.length === 5).slice(1);
    expect(rows).toEqual(j.table.rows);
  });
  it("Hiring Engine says where its funnel starts", () => {
    expect(renderToStaticMarkup(<JourneyFunnel analytics={prod()} type="he" />)).toContain("so its funnel starts at Leads");
  });
});

describe("JourneyCompare", () => {
  it("one row per stage, n/a where a stage does not exist, Highest / Lowest in words with an icon, CSV button labelled with the range", () => {
    const html = renderToStaticMarkup(<JourneyCompare analytics={prod()} />);
    const v = journeyCompare(prod());
    for (const r of v.rows) expect(html).toContain(`data-compare-stage="${r.key}"`);
    expect(html).toContain(">n/a<");
    expect(html).toContain("Highest");
    expect(html).toContain("Lowest");
    expect(html).toContain('data-level="high"');
    expect(html).toContain('aria-label="Export the funnel comparison as CSV for 2026-09-25 to 2026-10-08"');
    expect(html).toContain("min-h-11");
    expect(html).toContain("dark:bg-blue-950");
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain(v.aria);
  });
  it("empty range: an honest empty state, no table", () => {
    const empty = prod({ journey: { meta_live: jc(), meta_old: jc(), he: jc() }, types: { meta_live: typ(sc()), meta_old: typ(sc()), he: typ(sc()) } });
    const html = renderToStaticMarkup(<JourneyCompare analytics={empty} />);
    expect(html).toContain("No drive activity in this range");
    expect(html).not.toContain("<table");
  });
});

describe("CampaignProgressTable", () => {
  it("stalled badge in words with the server's reason, the largest drop-off cell marked, sortable headers as buttons", () => {
    const html = renderToStaticMarkup(<CampaignProgressTable analytics={prod()} />);
    expect(html).toContain("1 campaign is stalled: 64 qualified people have had no contact.");
    expect(html).toContain("</svg> Stalled</span>");
    expect(html).toContain("REQ-2609-K7BK: requisition is closed, so outreach refuses its leads");
    expect(html).toContain('data-worst="true"');
    expect(html).toContain("Largest drop-off: Qualified to contacted: 64 lost");
    expect(html).toContain('aria-sort="none"');
    expect((html.match(/<button type="button"/g) ?? []).length).toBe(14);
  });
  it("scoped to one drive, and an honest empty state", () => {
    expect(renderToStaticMarkup(<CampaignProgressTable analytics={prod()} only="meta_old" />)).not.toContain("K7BK night");
    expect(renderToStaticMarkup(<CampaignProgressTable analytics={prod({ campaigns: [] })} />)).toContain("No Meta campaign activity in this range.");
  });
});

describe("FootfallPlan", () => {
  it("says the arithmetic in words, shows the floor note and links to the Plan's what-if sliders", () => {
    const href = commandHash("plan", filters, NOW);
    const html = renderToStaticMarkup(<FootfallPlan analytics={prod()} type="meta_old" planHref={href} />);
    expect(html).toContain("To fill 47 open seats, Old Meta data needs about 47 arrivals.");
    expect(html).toContain("is a floor; at the measured 1%");
    expect(html).toContain("1 requisition in scope is closed or full and add no seats.");
    expect(html).toContain(`href="${href}"`);
    expect(html).toContain(PLAN_LINK_TEXT);
  });
  it("an older server without open seats says so", () => {
    expect(renderToStaticMarkup(<FootfallPlan analytics={prod({ openSeats: undefined })} type="he" />)).toContain("Open seats are not available from this server yet.");
  });
});

describe("InsightsPanel owner action", () => {
  it("shows the owner action in words with an icon, and a drive-specific heading", () => {
    const html = renderToStaticMarkup(<InsightsPanel analytics={prod()} title="Insights for Live Meta" dismissed={new Set()} onDismiss={noop} onRestore={noop} onAction={noop} />);
    expect(html).toContain("Insights for Live Meta");
    expect(html).toContain("Owner action: </span>HR: on Meta Campaigns, relink this campaign to an open requisition.");
  });
});

describe("375 px: no sideways page scroll", () => {
  // A scroll box that is not positioned lets absolutely placed text inside it (sr-only headers, captions) escape it and widen the page.
  it("every table scroll box in the Summary and the drive sections is positioned, so it contains its screen-reader text", () => {
    for (const s of ["summary", "live", "old", "he"] as const) {
      const html = renderToStaticMarkup(<>{sectionParts(s, prod(), null, undefined, undefined, 0, filters, noop).gated}</>);
      const boxes = [...html.matchAll(/class="([^"]*\boverflow-(?:x-)?auto\b[^"]*)"/g)].map((m) => m[1]);
      expect(boxes.length).toBeGreaterThan(0);
      for (const c of boxes) expect(c.split(" ").some((k) => k === "relative" || k === "sticky"), `${s}: ${c}`).toBe(true);
    }
  });
});

describe("placement", () => {
  const typeInsights = (t: "meta_live" | "meta_old" | "he") => <InsightsPanel analytics={{ insights: prod().insights.filter((i) => i.sourceType === t), partial: false }} title={`Insights for ${t}`}
    dismissed={new Set()} onDismiss={noop} onRestore={noop} onAction={noop} />;
  it("the Summary carries the comparison, the three journeys, all campaigns and the three footfall plans", () => {
    const html = renderToStaticMarkup(<>{sectionParts("summary", prod(), null, undefined, undefined, 0, filters, noop).gated}</>);
    expect(html).toContain('data-funnel-depth="summary"');
    expect(html).toContain("data-journey-compare");
    for (const t of ["meta_live", "meta_old", "he"]) { expect(html).toContain(`data-journey-stage="${t}-leads"`); expect(html).toContain(`data-footfall="${t}"`); }
    expect(html).toContain('data-campaign-progress="all"');
  });
  it("each drive section reuses the pieces for its own drive, with its own insights", () => {
    const live = renderToStaticMarkup(<>{sectionParts("live", prod(), null, undefined, undefined, 0, filters, noop, typeInsights).gated}</>);
    expect(live).toContain('data-funnel-depth="meta_live"');
    expect(live).toContain("Funnel: Live Meta journey");
    expect(live).toContain('data-campaign-progress="meta_live"');
    expect(live).toContain("Insights for meta_live");
    expect(live).toContain("K7BK night: 64 qualified");
    expect(live).not.toContain("most confirmed people do not come");
    const he = renderToStaticMarkup(<>{sectionParts("he", prod(), null, undefined, undefined, 0, filters, noop, typeInsights).gated}</>);
    expect(he).toContain('data-funnel-depth="he"');
    expect(he).toContain('data-journey-stage="he-leads"');
    expect(he).not.toContain("data-campaign-progress");
    expect(he).toContain("most confirmed people do not come");
  });
});
