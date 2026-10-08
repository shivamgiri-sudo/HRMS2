/** Static-markup tests (node env, no DOM). Click, keyboard and hash behaviour needs the live check. */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/hrmsApi", () => ({ hrmsApi: { get: vi.fn(() => new Promise(() => undefined)) } }));
vi.mock("@/hooks/useUserRole", () => ({ useHasRole: vi.fn(() => true) }));

import DriveCommandCenter, { sectionParts, DriveCommandView, type DriveCommandViewProps } from "../command/DriveCommandCenter";
import { defaultFilters } from "../command/driveCommandModel";
import type { DriveAnalytics } from "../command/driveCommandTypes";
import { tabFromHash } from "../hiringEngineTabs";

const noop = () => undefined;
const filters = { ...defaultFilters(new Date("2026-10-07T06:00:00Z")), requisitionId: "42" };
const reqs = [{ id: "42", label: "REQ-42 - Agent", branch: "Pune" }, { id: "43", label: "REQ-43 - Lead", branch: "Delhi" }];
const analytics = (over: Partial<DriveAnalytics> = {}): DriveAnalytics => ({ requisitionCount: 3, truncated: false, partial: false, failedSections: [], ...over } as DriveAnalytics);
const view = (over: Partial<DriveCommandViewProps> = {}, gated?: React.ReactNode, kids?: React.ReactNode) =>
  renderToStaticMarkup(<DriveCommandView section="summary" filters={filters} analytics={null} loading={false} error={null} onSection={noop} onFilters={noop} onRetry={noop} requisitions={reqs} branches={["Delhi", "Pune"]} gated={gated} {...over}>{kids}</DriveCommandView>);
const heView = (over: Partial<DriveCommandViewProps>) => { const p = sectionParts("he"); return view({ section: "he", ...over }, p.gated, p.always); };

describe("DriveCommandCenter", () => {
  it("default export renders the busy skeleton and the health strip", () => {
    const html = renderToStaticMarkup(<DriveCommandCenter />);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Loading drive analytics");
    expect(html).toContain("Loading pipeline health");
    expect(html).toContain("height:112px");
    expect(html).toContain("height:280px");
  });
  it("loading skeleton shows in the view while there is no data", () => {
    expect(view({ loading: true })).toContain("animate-pulse");
  });
  it("tablist: five tabs, one selected with tabindex 0, the rest -1, sticky, wired to the panel", () => {
    const html = view({ section: "plan" });
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Drive command sections"');
    expect(html.match(/role="tab"/g)).toHaveLength(5);
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(html).toMatch(/id="drive-tab-plan"[^>]*aria-selected="true"[^>]*tabindex="0"/);
    expect(html.match(/tabindex="-1"/g)).toHaveLength(5); // four inactive tabs + the focusable panel (insight actions focus it)
    expect(html.match(/aria-controls="drive-section-panel"/g)).toHaveLength(5);
    expect(html).toMatch(/<div role="tablist"[^>]*class="sticky z-20 /);
    expect(html).toContain("top:var(--topbar-height, 64px)");
    expect(html).toContain("focus-visible:ring-inset");
    expect(html).toContain('id="drive-section-panel"');
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain('aria-labelledby="drive-tab-plan"');
  });
  it("error with no data shows an alert and Retry", () => {
    const html = view({ error: "Network down" });
    expect(html).toContain('role="alert"');
    expect(html).toContain("Network down");
    expect(html).toContain("Retry");
  });
  it("partial result names the failed sections", () => {
    const html = view({ analytics: analytics({ partial: true, failedSections: ["timing", "waterfall"] }) });
    expect(html).toContain("timing, waterfall");
    expect(html).toContain("Retry");
  });
  it("truncated result shows the note", () => {
    expect(view({ analytics: analytics({ truncated: true }) })).toContain("Showing the 200 most recent requisitions; narrow the filters to see the rest");
  });
  it("empty window shows the empty state instead of section content, except on the Hiring Engine and Plan sections", () => {
    const a = analytics({ requisitionCount: 0 });
    const summary = view({ section: "summary", analytics: a }, <p>CONTENT</p>);
    expect(summary).toContain("No requisitions with drives in this window");
    expect(summary).not.toContain("CONTENT");
    expect(view({ section: "he", analytics: a }, <p>GATED</p>, <p>CONTENT</p>)).toContain("CONTENT");
  });
  it("gated panels render once data is present", () => {
    expect(view({ analytics: analytics() }, <p>CONTENT</p>)).toContain("CONTENT");
  });
  it("All drives (existing DrivesTab) renders while analytics load, fail, or are empty; gated panels do not", () => {
    for (const over of [{ loading: true }, { error: "boom" }, { analytics: analytics({ requisitionCount: 0 }) }]) {
      const html = heView(over);
      expect(html).toContain("All drives");
      if (!("analytics" in over)) expect(html).not.toContain("Hiring Engine drives");
    }
    expect(heView({ loading: true })).toContain('aria-busy="true"');
    expect(heView({ error: "boom" })).toContain("Retry");
  });
  it("the partial banner names failed sections in words", () => {
    const html = view({ analytics: { requisitionCount: 1, partial: true, failedSections: ["insight:tomorrow"], truncated: false } as never });
    expect(html).toContain("tomorrow&#x27;s plan");
    expect(html).not.toContain("insight:tomorrow");
  });
  it("the Plan section shows no analytics skeleton or error", () => {
    const html = view({ section: "plan", error: "boom" }, null, <p>PLAN</p>);
    expect(html).toContain("PLAN");
    expect(html).not.toContain("Could not load drive analytics");
  });
  it("filter bar: labels match input ids, selects have the all-options, every button has a focus ring", () => {
    const html = view({ section: "summary" });
    for (const id of ["drive-filter-from", "drive-filter-to", "drive-filter-req", "drive-filter-branch"]) {
      expect(html).toContain(`for="${id}"`);
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain("All requisitions");
    expect(html).toContain("All branches");
    expect(html).toContain("Reset");
    expect(html).toContain(`min="${"2026-07-08"}"`);
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    expect(buttons.length).toBeGreaterThanOrEqual(6);
    for (const b of buttons) expect(b).toContain("focus-visible:ring-2");
  });
  it("a hash-supplied requisition missing from the options stays selectable", () => {
    const html = view({ requisitions: [], branches: [] });
    expect(html).toContain("Requisition 42");
  });
  it("no shell className contains a bracket (the shared DegradedBanner has its own static text-[11px])", () => {
    for (const cls of (view({ analytics: analytics({ truncated: true }), error: "x" }).match(/class="[^"]*"/g) ?? [])) expect(cls).not.toContain("[");
  });
  it("tabFromHash still maps every tab hash and the command hash to the drives tab", () => {
    const ids = ["board", "drives", "leads", "master", "planner", "calls", "templates"] as const;
    for (const id of ids) expect(tabFromHash(`#${id}`, ids, "board")).toBe(id);
    expect(tabFromHash("#drives:summary", ids, "board")).toBe("drives");
    expect(tabFromHash("#drives:plan?req=4", ids, "board")).toBe("drives");
    expect(tabFromHash("", ids, "board")).toBe("board");
  });
  it("HiringEnginePage loads the command center for drives and DrivesTab stays reachable", () => {
    const page = readFileSync(new URL("../HiringEnginePage.tsx", import.meta.url), "utf8");
    expect(page).toContain('drives: () => import("./command/DriveCommandCenter")');
    expect(page).toContain("tabFromHash(window.location.hash");
    expect(readFileSync(new URL("../command/DriveCommandCenter.tsx", import.meta.url), "utf8")).toContain('import("../DrivesTab")');
  });
});

describe("campaign map placement (WS3 C4)", () => {
  it("the Summary's always slot carries the campaign map next to the action queue; other sections do not", () => {
    const f = defaultFilters();
    const summary = renderToStaticMarkup(<>{sectionParts("summary", null, null, undefined, null, 0, f, undefined, undefined, undefined, <p>CAMPAIGN-MAP</p>).always}</>);
    expect(summary).toContain("CAMPAIGN-MAP");
    const he = renderToStaticMarkup(<>{sectionParts("he", null, null, undefined, null, 0, f, undefined, undefined, undefined, <p>CAMPAIGN-MAP</p>).always}</>);
    expect(he).not.toContain("CAMPAIGN-MAP");
  });
  it("the full page renders the map on the Summary (server render: loading state)", () => {
    const html = renderToStaticMarkup(<DriveCommandCenter />);
    expect(html).toContain("Campaign map: which drive works on which requisition");
  });
});
