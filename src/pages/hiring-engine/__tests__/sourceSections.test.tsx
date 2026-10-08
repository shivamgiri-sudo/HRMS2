/** Live Meta / Old Meta data sections without streams (node env, no DOM). The widen button's click needs the live check. */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/hrmsApi", () => ({ hrmsApi: { get: vi.fn(() => new Promise(() => undefined)) } }));
vi.mock("@/hooks/useUserRole", () => ({ useHasRole: vi.fn(() => true) }));

import SourceOverview from "../command/SourceOverview";
import { sectionParts } from "../command/DriveCommandCenter";
import { commandHash, defaultFilters, parseCommandHash } from "../command/driveCommandModel";
import {
  HISTORIC_NOTE, SHOW_ALL_TIME, atWidestRange, campaignMappingView, scopeToType, showAllTimeFilters, showHistoricNote, zeroNotes,
} from "../command/sourceSectionModel";
import { kpiView } from "../command/charts/summaryView";
import { STAGES } from "../command/driveCommandTypes";
import type { DriveAnalytics, SourceType, StageCounts } from "../command/driveCommandTypes";

const NOW = new Date("2026-10-08T06:00:00Z");
const sc = (o: Partial<StageCounts> = {}): StageCounts => ({ leads: 0, qualified: 0, invited: 0, confirmed: 0, arrived: 0, selected: 0, joined: 0, ...o });
const typ = (s: StageCounts, spark: number[] = []) => ({ stages: s, previous: sc(), noShow: 0, declined: 0, conversions: STAGES.slice(1).map((to, i) => ({ from: STAGES[i], to, rate: s[STAGES[i]] > 0 ? s[to] / s[STAGES[i]] : null })), sparkline: spark });
const day = (date: string, l: number, h: number) => ({ date, target: 10, byType: { meta_live: { invited: l, confirmed: l, arrived: l }, meta_old: { invited: 0, confirmed: 0, arrived: 0 }, he: { invited: h, confirmed: h, arrived: h } } });
const fixture = (over: Partial<DriveAnalytics> = {}): DriveAnalytics => ({
  generatedAt: "2026-10-08T05:00:00Z", window: { from: "2026-09-25", to: "2026-10-08", days: 14 }, previousWindow: { from: "2026-09-11", to: "2026-09-24" },
  filter: { requisitionId: null, branch: null }, followupMode: "dry_run", qualifiedTracked: true,
  types: { meta_live: typ(sc({ leads: 103, qualified: 60, invited: 50, confirmed: 30, arrived: 20, selected: 10, joined: 8 }), [1, 2, 3]), meta_old: typ(sc()), he: typ(sc({ leads: 481, invited: 343 })) },
  typesPresent: ["meta_live", "he"], daily: [day("2026-10-06", 3, 9), day("2026-10-07", 4, 8)], timing: { replies: {}, arrivals: {}, arrivalsWithoutTime: 0 },
  scatter: [], waterfall: { meta_live: [], meta_old: [], he: [] }, groups: [], cost: { available: false, note: "" }, insights: [],
  requisitionCount: 1, truncated: false, partial: false, failedSections: [], ...over,
}) as unknown as DriveAnalytics;
const filters = defaultFilters(NOW);
const noop = () => undefined;
const render = (a: DriveAnalytics, type: SourceType, f = filters) => renderToStaticMarkup(<SourceOverview analytics={a} type={type} filters={f} onFilters={noop} />);

describe("source sections without streams", () => {
  it("Live Meta with data but no groups shows its KPI tiles, funnel and trend, and only its own type", () => {
    const html = render(fixture(), "meta_live");
    for (const l of ["Leads", "Qualified", "Invited", "Confirmed", "Arrived", "Selected", "Joined"]) expect(html).toContain(`>${l}<`);
    expect(html).toContain('data-stage="meta_live-leads">103<');
    expect(html).not.toContain("data-kpi-tile=\"he\"");
    expect(html).not.toContain("data-kpi-tile=\"meta_old\"");
    expect(html).toContain("Selected and joined count only people who arrived");
    expect(html).toContain("Funnel");
    expect(html).toContain("Daily arrivals");
  });
  it("the Live section part renders the overview above the streams list with Open a stream", () => {
    const parts = sectionParts("live", fixture(), undefined, { requisitions: [], requisitionId: null, onChanged: noop }, undefined, 0, filters, noop);
    const html = renderToStaticMarkup(<>{parts.gated}</>);
    expect(html).toContain('data-kpi-tile="meta_live"');
    expect(html).toContain("Open a stream");
    expect(html).toContain("No live Meta stream is running for this slice");
    expect(html.indexOf("data-kpi-tile")).toBeLessThan(html.indexOf("Open a stream"));
    expect(html).toContain("not linked to a stream yet");
  });
  it("zero-lead Old Meta in the default window shows the historic note and Show all time", () => {
    const html = render(fixture(), "meta_old");
    expect(html).toContain(HISTORIC_NOTE);
    expect(html).toContain(`>${SHOW_ALL_TIME}<`);
    expect(html).toContain('data-kpi-tile="meta_old"');
    expect(html).toContain("No activity in this range");
  });
  it("a widened Old Meta range with no leads says so instead of the historic note, and no button", () => {
    const wide = showAllTimeFilters(filters, NOW);
    const html = render(fixture(), "meta_old", wide);
    expect(html).not.toContain(HISTORIC_NOTE);
    expect(html).not.toContain(`>${SHOW_ALL_TIME}<`);
    expect(html).toContain("already as wide as the report allows");
  });
  it("Old Meta with leads shows no historic note", () => {
    const a = fixture({ types: { ...fixture().types, meta_old: typ(sc({ leads: 12, invited: 5 })) } });
    expect(render(a, "meta_old")).not.toContain(HISTORIC_NOTE);
  });
  it("buttons are 44px targets with focus rings", () => {
    const html = render(fixture(), "meta_old");
    expect(html).toMatch(/<button[^>]*min-h-11[^>]*focus-visible:ring-2[^>]*>Show all time|<button[^>]*focus-visible:ring-2[^>]*min-h-11[^>]*>Show all time/);
  });
});

describe("empty window", () => {
  it("does not hide the Old Meta section behind the generic empty box when no requisition has drives", async () => {
    const { DriveCommandView } = await import("../command/DriveCommandCenter");
    const a = fixture({ requisitionCount: 0 });
    const p = sectionParts("old", a, undefined, undefined, undefined, 0, filters, noop);
    const html = renderToStaticMarkup(
      <DriveCommandView section="old" filters={filters} analytics={a} loading={false} error={null} onSection={noop} onFilters={noop} onRetry={noop} requisitions={[]} branches={[]} gated={p.gated} />);
    expect(html).not.toContain("No requisitions with drives in this window");
    expect(html).toContain(HISTORIC_NOTE);
  });
});

describe("sourceSectionModel", () => {
  it("scopeToType keeps one type and zeroes the others everywhere the charts read", () => {
    const s = scopeToType(fixture(), "meta_live");
    expect(s.types.meta_live.stages.leads).toBe(103);
    expect(s.types.he.stages.leads).toBe(0);
    expect(s.typesPresent).toEqual(["meta_live"]);
    expect(s.daily[0].byType.he.arrived).toBe(0);
    expect(s.daily[0].byType.meta_live.arrived).toBe(3);
    expect(kpiView(s, "meta_live").tiles.map((t) => t.sourceType)).toEqual(["meta_live"]);
  });
  it("historic note only for Old Meta, zero leads, default window", () => {
    expect(showHistoricNote(fixture(), "meta_old", filters, NOW)).toBe(true);
    expect(showHistoricNote(fixture(), "meta_live", filters, NOW)).toBe(false);
    expect(showHistoricNote(fixture(), "meta_old", showAllTimeFilters(filters, NOW), NOW)).toBe(false);
  });
  it("Show all time widens From to the longest allowed range and survives the hash round trip", () => {
    const wide = showAllTimeFilters(filters, NOW);
    expect(wide.to).toBe(filters.to);
    expect(wide.from < filters.from).toBe(true);
    expect(atWidestRange(wide, NOW)).toBe(true);
    expect(atWidestRange(filters, NOW)).toBe(false);
    const hash = commandHash("old", wide, NOW);
    expect(hash).toContain("from=");
    const back = parseCommandHash(hash, NOW);
    expect(back.section).toBe("old");
    expect(back.filters).toEqual(wide);
  });
  it("zero notes tell no-activity from untracked from no-stream", () => {
    const a = fixture({ qualifiedTracked: false, types: { ...fixture().types, meta_live: typ(sc({ leads: 5 })) } });
    const ids = zeroNotes(a, "meta_live", filters, NOW).map((n) => n.id);
    expect(ids).toEqual(["untracked", "no-activity", "no-streams"]);
    expect(zeroNotes(fixture(), "meta_old", filters, NOW).map((n) => n.id)).toEqual(["historic"]);
    expect(zeroNotes(fixture(), "meta_live", filters, NOW).map((n) => n.id)).toEqual(["no-streams"]);
  });
  it("campaign mapping lists campaigns with leads, biggest first, and counts the unlinked", () => {
    const v = campaignMappingView({ campaigns: [
      { campaignId: "a", campaignName: "A", status: "active", requisitionCode: "REQ-1", branchName: "Pune", leads: 5, qualified: 2, joined: 1 },
      { campaignId: "b", campaignName: "B", status: "paused", requisitionCode: null, branchName: null, leads: 50, qualified: 20, joined: 0 },
      { campaignId: "c", campaignName: "C", status: "active", requisitionCode: "REQ-2", branchName: "X", leads: 0, qualified: 0, joined: 0 },
    ] });
    expect(v.rows.map((r) => r.id)).toEqual(["b", "a"]);
    expect(v.rows[0].requisition).toBe("Not linked");
    expect(v.unmapped).toBe(1);
    expect(campaignMappingView(null).empty).toBe(true);
  });
});
