/**
 * Roster Insights and Roster Requests — the remaining two consolidation pages.
 * Same node-environment render approach as RosterRulesPage.test.tsx.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", { "data-layout": "mock" }, children),
}));

import RosterInsightsPage from "@/pages/wfm/RosterInsightsPage";
import RosterRequestsPage from "@/pages/wfm/RosterRequestsPage";

const ROUTES = readFileSync(
  resolve(__dirname, "../../../config/routes/workforce.routes.tsx"), "utf8");

function render(Page: React.ComponentType, path: string, search = ""): string {
  return renderToStaticMarkup(
    React.createElement(MemoryRouter, { initialEntries: [`${path}${search}`] },
      React.createElement(Page)),
  );
}
const activeTab = (html: string) =>
  html.match(/data-state="active"[^>]*?id="[^"]*?-trigger-([a-z-]+)"/)?.[1] ?? null;

describe("Roster Insights", () => {
  it("offers coverage, heat map and fairness", () => {
    const html = render(RosterInsightsPage, "/wfm/roster-insights");
    for (const label of ["Coverage", "Heat map", "Week-off fairness"]) {
      expect(html, `missing tab ${label}`).toContain(label);
    }
  });

  it("defaults to coverage and honours ?tab=", () => {
    expect(activeTab(render(RosterInsightsPage, "/wfm/roster-insights"))).toBe("coverage");
    expect(activeTab(render(RosterInsightsPage, "/wfm/roster-insights", "?tab=fairness"))).toBe("fairness");
  });

  it("falls back rather than rendering blank on an unknown tab", () => {
    expect(activeTab(render(RosterInsightsPage, "/wfm/roster-insights", "?tab=nope"))).toBe("coverage");
  });
});

describe("Roster Requests", () => {
  it("offers both halves of the same job", () => {
    const html = render(RosterRequestsPage, "/wfm/roster-requests");
    // renderToStaticMarkup escapes & as &amp;
    expect(html).toContain("Disputes &amp; week-offs");
    expect(html).toContain("Swaps &amp; conflicts");
  });

  it("defaults to disputes and honours ?tab=", () => {
    expect(activeTab(render(RosterRequestsPage, "/wfm/roster-requests"))).toBe("disputes");
    expect(activeTab(render(RosterRequestsPage, "/wfm/roster-requests", "?tab=swaps"))).toBe("swaps");
  });
});

describe("consolidation stays additive", () => {
  it("registers both consolidated routes", () => {
    expect(ROUTES).toContain('path="/wfm/roster-insights"');
    expect(ROUTES).toContain('path="/wfm/roster-requests"');
  });

  it("keeps every absorbed screen reachable on its own route", () => {
    for (const p of [
      "/workforce-planning", "/wfm/auto-roster", "/wfm/weekoff-fairness", "/wfm/extensions",
    ]) {
      expect(ROUTES, `route ${p} was removed`).toContain(`path="${p}"`);
    }
  });
});

describe("Roster Import copy is honest", () => {
  it("does not claim HD normalization", () => {
    // hdMapsTo is 'NEEDS_MAPPING' by design, so HD is deliberately NOT auto-normalised. The page
    // advertised "WO/HD/blank normalization", which is why two HD cells in a real file were
    // reported as unrecognised after the page had promised otherwise.
    const src = readFileSync(resolve(__dirname, "../RosterImportPage.tsx"), "utf8");
    expect(src).not.toContain("WO/HD/blank");
  });
});
