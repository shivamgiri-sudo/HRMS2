/**
 * Roster Rules — consolidation of seven config screens into one tabbed page.
 *
 * Same shape as RosterBuilderPage.test.tsx / RosterPivotGrid.test.tsx: @testing-library/react and
 * jsdom are not installed and vitest runs frontend tests under `environment: "node"`, so the real
 * component is rendered through renderToStaticMarkup rather than with render()/userEvent.
 *
 * DashboardLayout is mocked to a passthrough here. The real one pulls in auth, nav badges, version
 * checks and an employee-profile fetch, none of which this page's behaviour depends on — its own
 * nesting behaviour is asserted separately in Section C against the live source.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", { "data-layout": "mock" }, children),
}));

import { vi } from "vitest";
import RosterRulesPage from "@/pages/wfm/RosterRulesPage";

const ROUTES_SRC = readFileSync(
  resolve(__dirname, "../../../config/routes/workforce.routes.tsx"), "utf8");
const PAGE_SRC = readFileSync(resolve(__dirname, "../RosterRulesPage.tsx"), "utf8");

function renderAt(search: string): string {
  return renderToStaticMarkup(
    React.createElement(
      MemoryRouter,
      { initialEntries: [`/wfm/roster-rules${search}`] },
      React.createElement(RosterRulesPage),
    ),
  );
}

/** Every tab this page is expected to host, and the route each one still lives at alone. */
const EXPECTED = [
  { label: "Week-off rules",   standalone: "/wfm/weekoff-day-rules" },
  { label: "Week-off default", standalone: "/wfm/week-off-default" },
  { label: "Minimum rest",     standalone: "/wfm/rest-policy" },
  { label: "Capacity",         standalone: "/roster-capacity-config" },
  { label: "Demand",           standalone: "/wfm/slot-requirements" },
  { label: "Planning rules",   standalone: "/wfm/planning-rules" },
  { label: "Approvers",        standalone: "/wfm/branch-spoc-config" },
];

// ── Section A — the page renders ──────────────────────────────────────────────

describe("RosterRulesPage — renders", () => {
  it("offers every one of the seven config screens as a tab", () => {
    const html = renderAt("");
    for (const { label } of EXPECTED) {
      expect(html, `tab "${label}" missing`).toContain(label);
    }
  });

  it("shows the page heading", () => {
    expect(renderAt("")).toContain("Roster Rules");
  });

  it("renders inside a DashboardLayout", () => {
    expect(renderAt("")).toContain('data-layout="mock"');
  });
});

// ── Section B — tab selection is linkable ─────────────────────────────────────

describe("RosterRulesPage — tab is driven by the query string", () => {
  /**
   * Returns the tab VALUE of the active trigger. Radix stamps each trigger with
   * id="radix-:rN:-trigger-<value>", which is a far more stable target than the visible label:
   * the label sits after a very long utility class list, so any fixed-width slice of the markup
   * misses it.
   */
  function activeTabValue(html: string): string | null {
    const m = html.match(/data-state="active"[^>]*?id="[^"]*?-trigger-([a-z-]+)"/);
    return m ? m[1] : null;
  }

  it("defaults to the first tab when no tab is given", () => {
    expect(activeTabValue(renderAt(""))).toBe("week-off");
  });

  it("honours an explicit ?tab=", () => {
    expect(activeTabValue(renderAt("?tab=rest"))).toBe("rest");
  });

  it("honours ?tab= for a tab that is not adjacent to the default", () => {
    expect(activeTabValue(renderAt("?tab=approvers"))).toBe("approvers");
  });

  it("falls back to the default tab for an unknown ?tab= instead of rendering nothing", () => {
    // These links get shared and hand-edited; a typo must not produce a blank page.
    expect(activeTabValue(renderAt("?tab=not-a-real-tab"))).toBe("week-off");
  });

  it("does not stack a history entry per tab switch", () => {
    // Back should leave the page, not walk through every tab the user looked at.
    expect(PAGE_SRC).toMatch(/setSearchParams\([^)]*,\s*\{\s*replace:\s*true\s*\}\s*\)/s);
  });
});

// ── Section C — consolidation must not delete anything ────────────────────────

describe("consolidation is additive", () => {
  it("keeps every absorbed screen reachable at its original route", () => {
    // The whole safety argument for this merge is that nothing is removed: deep links, bookmarks
    // and any hard-coded link keep working, and a screen can be un-merged without a revert.
    for (const { standalone } of EXPECTED) {
      expect(ROUTES_SRC, `route ${standalone} was removed`).toContain(`path="${standalone}"`);
    }
  });

  it("registers the consolidated route itself", () => {
    expect(ROUTES_SRC).toContain('path="/wfm/roster-rules"');
  });

  it("hosts the real page components rather than reimplementing them", () => {
    // A rewrite would duplicate config logic and drift from the originals. Each tab must import
    // the existing page.
    for (const page of [
      "NativeWeekOffDayRuleConfig", "NativeWeekOffDefaultConfig", "NativeWFMRestPolicyConfig",
      "NativeWFMPlanningRules", "NativeSlotRequirementBuilder", "NativeRosterCapacityConfig",
      "NativeBranchWFMSpocConfig",
    ]) {
      expect(PAGE_SRC, `${page} should be composed, not reimplemented`).toContain(page);
    }
  });

  it("loads each tab lazily so one page does not pull in seven config screens", () => {
    expect(PAGE_SRC).toMatch(/lazy\(\(\) => import\(/);
  });
});

// ── Section D — the nesting mechanism that makes composition possible ─────────

describe("DashboardLayout nesting", () => {
  const LAYOUT_SRC = readFileSync(
    resolve(__dirname, "../../../components/layout/CompactDashboardLayout.tsx"), "utf8");

  it("renders children straight through when already inside a layout", () => {
    // Six of the seven absorbed pages wrap themselves in DashboardLayout. Without this the shell
    // mounts twice — two sidebars, two headers, and a second round of nav-badge/version/profile
    // requests on every tab switch.
    expect(LAYOUT_SRC).toMatch(/const alreadyInsideLayout = useContext\(InsideDashboardLayout\)/);
    expect(LAYOUT_SRC).toMatch(/if \(alreadyInsideLayout\) return <>\{props\.children\}<\/>/);
  });

  it("keeps the context check out of the hook-heavy shell", () => {
    // An early return placed after the shell's hooks would change hook order between renders.
    expect(LAYOUT_SRC).toMatch(/function DashboardLayoutShell\(/);
  });

  it("provides the context so nested layouts can detect it", () => {
    expect(LAYOUT_SRC).toContain("<InsideDashboardLayout.Provider value={true}>");
  });

  it("defaults to false so a standalone page still gets the full shell", () => {
    expect(LAYOUT_SRC).toMatch(/createContext\(false\)/);
  });
});
