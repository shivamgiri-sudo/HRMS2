/** Grouped drive rows: pure view-model tables and static markup (node env). Expanding and the lazy load need the live check. */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/hrmsApi", () => ({ hrmsApi: { get: vi.fn(() => new Promise(() => undefined)) } }));

import DriveGroupRow, { DetailView } from "../command/DriveGroupRow";
import DriveTypeSection from "../command/DriveTypeSection";
import { DrivesBox } from "../CampaignDashboardCard";
import {
  actionWords, collapsedCells, dayRows, eventLine, groupsForSection, mergeEvents, page, trendPath, trendSeries, trendView, windowText,
} from "../command/driveGroupModel";
import type { DriveGroup, DriveTrend, StreamEvent, TrendPoint } from "../command/driveCommandTypes";

const R = "0a1b2c3d-0000-4000-8000-000000000001";
const totals = (o: Partial<DriveGroup["totals"]> = {}) => ({ wanted: 40, lined: 60, invited: 55, confirmed: 30, arrived: 21, noShow: 7, declined: 3, showRate: 0.7, ...o });
const group = (o: Partial<DriveGroup> = {}): DriveGroup => ({
  requisitionId: R, branch: "Pune", requisition: "REQ-100", role: "Sales Executive", sourceType: "he", types: ["he"], streamIds: [],
  window: { from: "2026-10-09", to: "2026-10-14", dayIndex: 3, days: 5 }, totals: totals(), days: [], ...o,
});
const pt = (date: string, o: Partial<TrendPoint> = {}): TrendPoint => ({ date, driveId: "d", status: "open", wanted: 10, lined: 12, invited: 11, confirmed: 8, arrived: 6, noShow: 2, declined: 1, showRate: 0.75, streams: [], ...o });
const points = [pt("2026-10-09"), pt("2026-10-10", { lined: 0, invited: 0, confirmed: 0, arrived: 0, noShow: 0, declined: 0, wanted: 0 }), pt("2026-10-12"), pt("2026-10-13", { confirmed: 5, arrived: 0 })];
const TODAY = "2026-10-12";

describe("windowText", () => {
  const g = group();
  it.each([
    ["2026-10-12", "day 3 of 5, ends Wed 14 Oct"],
    ["2026-10-09", "day 3 of 5, ends Wed 14 Oct"],
    ["2026-10-08", "starts Fri 9 Oct, 5 days"],
    ["2026-10-15", "ended Wed 14 Oct"],
  ])("at %s: %s", (today, want) => expect(windowText(g, today)).toBe(want));
  it("one day is singular and an empty window is words, not NaN", () => {
    expect(windowText(group({ window: { from: "2026-10-09", to: "2026-10-09", dayIndex: 0, days: 1 } }), "2026-10-01")).toBe("starts Fri 9 Oct, 1 day");
    expect(windowText(group({ window: { from: "2026-10-09", to: "2026-10-09", dayIndex: 0, days: 0 } }), TODAY)).toBe("no drive days");
  });
});

describe("collapsedCells", () => {
  const labels = ["Wanted", "Lined up", "Invited", "Confirmed", "Arrived", "Did not come", "Declined", "Show rate"];
  it("lists the eight totals with the show rate as a percent", () => {
    const c = collapsedCells(group());
    expect(c.map((x) => x.label)).toEqual(labels);
    expect(c.map((x) => x.value)).toEqual(["40", "60", "55", "30", "21", "7", "3", "70%"]);
  });
  it("shows an en dash when nobody confirmed and survives broken numbers", () => {
    expect(collapsedCells(group({ totals: totals({ confirmed: 0, arrived: 0 }) })).at(-1)?.value).toBe("–");
    const bad = collapsedCells(group({ totals: { wanted: NaN, lined: undefined, invited: -3, confirmed: Infinity } as unknown as DriveGroup["totals"] }));
    expect(bad.map((x) => x.value).join(" ")).not.toMatch(/NaN|undefined|Infinity/);
  });
});

describe("dayRows", () => {
  const rows = dayRows(points, TODAY);
  it("marks today and keeps zero-filled days", () => {
    expect(rows.map((r) => r.date)).toEqual(["2026-10-09", "2026-10-10", "2026-10-12", "2026-10-13"]);
    expect(rows.map((r) => r.isToday)).toEqual([false, false, true, false]);
    expect(rows[1].cells).toEqual(["0", "0", "0", "0", "0", "0", "0", "–"]);
    expect(rows[2].label).toBe("Mon 12 Oct");
  });
  it("a future day shows only lined up and invited", () => {
    expect(rows[3].future).toBe(true);
    expect(rows[3].cells).toEqual(["–", "12", "11", "–", "–", "–", "–", "–"]);
  });
  it("a past day shows its show rate", () => expect(rows[0].cells.at(-1)).toBe("75%"));
});

describe("trendSeries and trendView", () => {
  it("one entry per point; pct is 0 for 0 confirmed", () => {
    const s = trendSeries(points);
    expect(s.counts).toHaveLength(4);
    expect(s.showRate).toHaveLength(4);
    expect(s.showRate.map((r) => r.pct)).toEqual([75, 0, 75, 0]);
    expect(s.counts[1]).toMatchObject({ invited: 0, confirmed: 0, arrived: 0, wanted: 0 });
    expect(trendSeries([])).toEqual({ counts: [], showRate: [] });
  });
  it("tables carry exactly the numbers the charts draw; the rate chart stops at today", () => {
    const v = trendView(points, "he", TODAY);
    expect(v.counts.map((c) => [c.label, String(c.invited), String(c.confirmed), String(c.arrived), String(c.wanted)])).toEqual(v.countsTable.rows);
    expect(v.showRate.map((r) => [r.label, `${r.pct}%`])).toEqual(v.rateTable.rows);
    expect(v.showRate.map((r) => r.date)).toEqual(["2026-10-09", "2026-10-10", "2026-10-12"]);
    expect(trendView([], "he", TODAY).empty).toBe(true);
    expect(trendView(points, "he", TODAY, { prefersReducedMotion: true }).motion.animate).toBe(false);
  });
});

describe("sections, paging, paths and history", () => {
  const mk = (code: string, branch: string, t: DriveGroup["sourceType"]) => group({ requisition: code, branch, sourceType: t });
  it("filters by type and sorts by code then branch", () => {
    const out = groupsForSection([mk("B", "Pune", "he"), mk("A", "Pune", "meta_live"), mk("A", "Delhi", "he"), mk("A", "Pune", "he")], "he");
    expect(out.map((g) => `${g.requisition}/${g.branch}`)).toEqual(["A/Delhi", "A/Pune", "B/Pune"]);
    expect(groupsForSection(undefined as unknown as DriveGroup[], "he")).toEqual([]);
  });
  it("page of 60 rows is 3 pages of 25", () => {
    const rows = Array.from({ length: 60 }, (_, i) => i);
    expect(page(rows, 0)).toEqual({ rows: rows.slice(0, 25), pages: 3 });
    expect(page(rows, 2).rows).toHaveLength(10);
    expect(page([], 0)).toEqual({ rows: [], pages: 0 });
  });
  it("trendPath carries the three keys", () => {
    expect(trendPath(group({ branch: "New Delhi" }))).toBe(`/api/he/drive-trend?requisitionId=${R}&branch=New+Delhi&sourceType=he`);
  });
  const ev = (o: Partial<StreamEvent>): StreamEvent => ({ id: "e", action: "extend", changedBy: null, changedAt: "2026-10-10 11:00:00", oldOpenFrom: null, oldOpenDays: 5, newOpenDays: 7, oldStatus: null, newStatus: null, day: null, reason: "Low turnout", ...o });
  it("event line and merge order", () => {
    expect(eventLine(ev({}))).toBe("Sat 10 Oct · Extended · 5 to 7 days · Low turnout");
    expect(eventLine(ev({ action: "skip_day", day: "2026-10-14", oldOpenDays: null, newOpenDays: null, reason: null }))).toBe("Sat 10 Oct · Skipped a day (Wed 14 Oct)");
    expect(actionWords("weird_thing")).toBe("weird thing");
    expect(mergeEvents([[ev({ id: "a", changedAt: "2026-10-09 10:00:00" })], [ev({ id: "b", changedAt: "2026-10-11 10:00:00" })]]).map((e) => e.id)).toEqual(["b", "a"]);
  });
});

describe("static markup", () => {
  const row = (g: DriveGroup, extra: Partial<React.ComponentProps<typeof DriveGroupRow>> = {}) => renderToStaticMarkup(<DriveGroupRow group={g} today={TODAY} {...extra} />);
  it("collapsed row: button aria-expanded=false with controls, window text, type and totals", () => {
    const h = row(group());
    expect(h).toContain('aria-expanded="false"');
    expect(h).toMatch(/aria-controls="group-[a-zA-Z0-9]+"/);
    for (const t of ["day 3 of 5, ends Wed 14 Oct", "REQ-100", "Sales Executive", "Pune", "Hiring Engine", "Running", "Did not come", "70%"]) expect(h).toContain(t);
    expect(h).not.toMatch(/NaN|undefined|Infinity/);
  });
  it("confirmed 0 shows the dash for the show rate", () => {
    expect(row(group({ totals: totals({ confirmed: 0, arrived: 0 }) }))).toContain(">–<");
  });
  it("compact mode keeps the type name for screen readers only below sm", () => {
    expect(row(group({ sourceType: "meta_old" }), { compact: true })).toContain("sr-only sm:not-sr-only");
  });
  it("long requisition labels wrap instead of overflowing", () => {
    const h = row(group({ requisition: "REQ-".concat("X".repeat(120)), role: "Senior ".repeat(30) }));
    expect(h).toContain("break-words");
    expect(h).toContain("X".repeat(120));
  });
  const trend = (o: Partial<DriveTrend> = {}): DriveTrend => ({ requisitionId: R, branch: "Pune", sourceType: "he", window: group().window, points, partial: false, failedSections: [], ...o });
  const detail = (o: Partial<React.ComponentProps<typeof DetailView>> = {}) => renderToStaticMarkup(
    <DetailView group={group({ streamIds: ["s1"] })} today={TODAY} trend={trend()} trendError={null} loading={false} events={[]} eventsError={null} onRetry={() => undefined} {...o} />);
  it("expanded: day table marks today with aria-current and the word, shows every window day, history and slot", () => {
    const h = detail({ events: [{ id: "e1", action: "extend", changedBy: null, changedAt: "2026-10-10 11:00:00", oldOpenFrom: null, oldOpenDays: 5, newOpenDays: 7, oldStatus: null, newStatus: null, day: null, reason: "Low turnout" }], children: <div>ACTION-SLOT</div> });
    expect(h).toContain('aria-current="date"');
    expect(h).toContain(">today<");
    for (const d of ["Fri 9 Oct", "Sat 10 Oct", "Mon 12 Oct", "Tue 13 Oct"]) expect(h).toContain(d);
    expect(h).toContain("Sat 10 Oct · Extended · 5 to 7 days · Low turnout");
    expect(h).toContain("ACTION-SLOT");
    expect(h).toContain("Show table");
    expect(h).not.toMatch(/NaN|undefined|Infinity/);
  });
  it("expanded: loading skeleton, error with Retry, partial banner, no streams means no history", () => {
    expect(detail({ trend: null, loading: true })).toContain("Loading the day-wise trend");
    const err = detail({ trend: null, trendError: "boom" });
    expect(err).toContain("Could not load the trend: boom");
    expect(err).toContain("Retry");
    expect(detail({ trend: trend({ partial: true, failedSections: ["drives"] }) })).toContain("Some numbers could not be loaded (drives)");
    expect(detail({ group: group() })).not.toContain("Extension history");
    expect(detail({ trend: trend({ points: [] }) })).toContain("No drive days in this window");
  });
  it("section: only its type, per-type empty state, one type missing", () => {
    const groups = [group({ requisition: "REQ-1" }), group({ requisition: "REQ-2", sourceType: "meta_live", types: ["meta_live"] })];
    const he = renderToStaticMarkup(<DriveTypeSection type="he" groups={groups} today={TODAY} title="Hiring Engine drives" />);
    expect(he).toContain("REQ-1");
    expect(he).not.toContain("REQ-2");
    expect(renderToStaticMarkup(<DriveTypeSection type="meta_old" groups={groups} today={TODAY} title="Old" />)).toContain("No old-data re-run in this slice");
    expect(renderToStaticMarkup(<DriveTypeSection type="meta_live" groups={[]} today={TODAY} title="Live" />)).toContain("No live Meta stream is running for this slice");
    expect(renderToStaticMarkup(<DriveTypeSection type="he" groups={[]} today={TODAY} title="HE" />)).toContain("No pool drives in this slice");
  });
  it("section paginates 25 rows with Show more", () => {
    const many = Array.from({ length: 60 }, (_, i) => group({ requisition: `REQ-${String(i).padStart(3, "0")}` }));
    const h = renderToStaticMarkup(<DriveTypeSection type="he" groups={many} today={TODAY} title="HE" />);
    expect(h.split('aria-expanded="false"').length - 1).toBe(25);
    expect(h).toContain("Show more");
    expect(h).toContain("Showing 25 of 60");
  });
});

describe("Master-tab drives box", () => {
  const box = (groups: DriveGroup[] | undefined, failed = false) => renderToStaticMarkup(<DrivesBox groups={groups} failed={failed} today={TODAY} />);
  it("one requisition over two days renders one row, the full-comparison button and no flat Drive header", () => {
    const g = group({ days: [
      { driveId: "d1", date: "2026-10-11", branch: "Pune", requisition: "REQ-100", role: "Sales", status: "open", wanted: 5, lined: 5, invited: 5, confirmed: 4, arrived: 3, noShow: 1, declined: 0 },
      { driveId: "d2", date: "2026-10-12", branch: "Pune", requisition: "REQ-100", role: "Sales", status: "open", wanted: 5, lined: 5, invited: 5, confirmed: 4, arrived: 3, noShow: 1, declined: 0 },
    ] });
    const h = box([g]);
    expect(h.split('aria-expanded="false"').length - 1).toBe(1);
    expect(h).toContain("Open full comparison");
    expect(h).not.toContain(">Drive</th>");
    expect(h).not.toContain("<table");
  });
  it("empty groups and a missing driveGroups give sensible messages", () => {
    expect(box([])).toContain("No open drives in this window.");
    expect(box(undefined)).toContain("Drive rows are not available right now");
    expect(box(undefined)).toContain("Open full comparison");
    expect(box([group()], true)).toContain("Drive rows are not available right now");
  });
});
