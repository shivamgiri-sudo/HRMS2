/**
 * Roster Command Center shell + shared filter helpers. Frontend suite is node-environment
 * (no jsdom), so: pure helpers are asserted directly, the real shell is rendered with
 * renderToStaticMarkup, and structural rules (no per-panel hero, one card) are source checks.
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/hrmsApi", () => ({
  hrmsApi: { get: vi.fn(() => new Promise(() => undefined)), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn() },
}));
const access = { pages: new Set<string>(), resolved: true };
vi.mock("@/hooks/useUserRole", () => ({
  useWorkforceAccess: () => ({
    isResolved: access.resolved, isLoading: !access.resolved, isError: false, error: null,
    canViewPage: (c: string) => access.pages.has(c),
  }),
}));

import RosterCommandCenter from "@/pages/wfm/RosterCommandCenter";
import {
  DATE_PRESETS, activePreset, buildChips, defaultFilters, describeTabFilters, isoDate,
  nextParamsForProcess, nextParamsForReset, presetRange, scopeParams,
} from "@/pages/wfm/roster-command-center/filterState";
import { toLobChoices } from "@/components/wfm/LobSelect";

const ALL_CODES = [
  "WFM_ROSTER_LIVE_MONITORING", "WFM_ROSTER_TEAM_ROSTER", "WFM_ROSTER_ANALYTICS", "WFM_ROSTER_TRENDS",
  "WFM_ROSTER_COMPLIANCE", "WFM_ROSTER_SHIFT_EFFECTIVENESS", "WFM_ROSTER_INTERVENTIONS", "WFM_ROSTER_AUDIT_TRAIL",
];

function render(search = "", pages: string[] = ALL_CODES): string {
  access.pages = new Set(pages);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    React.createElement(QueryClientProvider, { client: qc },
      React.createElement(MemoryRouter, { initialEntries: [`/wfm/roster-command-center${search}`] },
        React.createElement(RosterCommandCenter))),
  );
}

const NOW = new Date(2026, 8, 24); // 24 Sep 2026 local

describe("shell rendering", () => {
  it("renders the compact header, all 8 tabs, and no gradient hero", () => {
    const html = render();
    expect(html).toContain("Roster Command Center");
    for (const label of ["Live Monitoring", "Team Roster", "Analytics", "Trends &amp; Publish", "Compliance", "Shift Effectiveness", "Interventions", "Audit Trail"]) {
      expect(html, label).toContain(label);
    }
    expect(html).not.toContain("from-teal-600");
    expect(html).toContain("max-w-[1600px]");
  });

  it("renders Branch, Process, LOB, date controls, presets and Reset", () => {
    const html = render();
    for (const t of ["Branch", "Process", "LOB", "From", "To", "Today", "Yesterday", "Last 7 days", "Last 14 days", "This month", "Reset"]) {
      expect(html, t).toContain(t);
    }
  });

  it("honours ?tab= and hides tabs the viewer cannot open", () => {
    const html = render("?tab=compliance", ["WFM_ROSTER_LIVE_MONITORING", "WFM_ROSTER_COMPLIANCE"]);
    expect(html).toMatch(/data-state="active"[^>]*>[^<]*<svg[^>]*>.*?<\/svg>Compliance/s);
    expect(html).not.toContain("Audit Trail");
    expect(html).toContain("This tab uses: Branch · Process · LOB");
  });

  it("shows the access-denied state when no tab is visible", () => {
    expect(render("", [])).toContain("Access not available");
  });

  it("shows an applied LOB chip from the URL", () => {
    expect(render("?lob=__none__")).toContain("Unassigned");
  });
});

describe("filter helpers", () => {
  it("changing the process clears the LOB but keeps other params", () => {
    const next = nextParamsForProcess(new URLSearchParams("tab=live&lob=abc&branchId=b1&processId=p1"), "p2");
    expect(next.get("processId")).toBe("p2");
    expect(next.get("lob")).toBeNull();
    expect(next.get("branchId")).toBe("b1");
    expect(next.get("tab")).toBe("live");
  });

  it("clearing the process also clears the LOB", () => {
    const next = nextParamsForProcess(new URLSearchParams("processId=p1&lob=abc"), "");
    expect(next.get("processId")).toBeNull();
    expect(next.get("lob")).toBeNull();
  });

  it("reset removes every filter but keeps the tab", () => {
    const next = nextParamsForReset(new URLSearchParams("tab=audit&branchId=b&processId=p&lob=l&from=2026-01-01&to=2026-01-02"));
    expect([...next.keys()]).toEqual(["tab"]);
  });

  it("never sends unset or all values", () => {
    const p = scopeParams({ branchId: "", processId: "all", lobId: "__all__" }, { period: "2026-08" });
    expect(p.toString()).toBe("period=2026-08");
    const q = scopeParams({ branchId: "ALL", processId: "p1", lobId: "__none__" });
    expect(q.get("processId")).toBe("p1");
    expect(q.get("lobId")).toBe("__none__");
    expect(q.has("branchId")).toBe(false);
  });

  it("presets compute the expected ranges", () => {
    expect(presetRange("today", NOW)).toEqual({ from: "2026-09-24", to: "2026-09-24" });
    expect(presetRange("yesterday", NOW)).toEqual({ from: "2026-09-23", to: "2026-09-23" });
    expect(presetRange("last7", NOW)).toEqual({ from: "2026-09-18", to: "2026-09-24" });
    expect(presetRange("last14", NOW)).toEqual({ from: "2026-09-11", to: "2026-09-24" });
    expect(presetRange("month", NOW)).toEqual({ from: "2026-09-01", to: "2026-09-24" });
    expect(DATE_PRESETS).toHaveLength(5);
    expect(activePreset("2026-09-11", "2026-09-24", NOW)).toBe("last14");
    expect(activePreset("2026-01-01", "2026-01-02", NOW)).toBeNull();
    expect(isoDate(-1, NOW)).toBe("2026-09-23");
  });

  it("chips list only non-default filters", () => {
    expect(buildChips(defaultFilters(NOW), {}, NOW)).toEqual([]);
    const chips = buildChips({ ...defaultFilters(NOW), branchId: "b1", lobId: "__none__", from: "2026-09-01" }, { branch: "Noida" }, NOW);
    expect(chips.map((c) => c.key)).toEqual(["branchId", "lob", "dates"]);
    expect(chips[0].value).toBe("Noida");
    expect(chips[1].value).toBe("Unassigned");
  });

  it("describes what each tab uses", () => {
    expect(describeTabFilters("audit")).toBe("This tab uses: Branch · Process · LOB · Dates");
    expect(describeTabFilters("team-roster")).toContain("Process");
  });
});

describe("LobSelect choices", () => {
  const all = [{ id: "l1", lob_name: "Voice" }, { id: "l2", lob_name: "Chat" }];
  it("uses the process-mapped LOBs when a process is selected", () => {
    expect(toLobChoices([{ lob_id: "l2", lob_name: "Chat" }], all, true)).toEqual([{ id: "l2", name: "Chat" }]);
  });
  it("falls back to all LOBs without a process or when mapping is unavailable", () => {
    expect(toLobChoices(undefined, all, false)).toHaveLength(2);
    expect(toLobChoices(undefined, all, true)).toHaveLength(2);
  });
});

describe("panels", () => {
  const dir = resolve(__dirname, "../roster-command-center");
  const panels = readdirSync(dir).filter((f) => f.endsWith("Panel.tsx"));

  it("no panel paints its own full-bleed hero or copies GlassCard", () => {
    expect(panels.length).toBeGreaterThanOrEqual(8);
    for (const f of panels) {
      const src = readFileSync(resolve(dir, f), "utf8");
      expect(src, f).not.toContain("-m-4 sm:-m-6");
      expect(src, f).not.toContain("min-h-screen");
      expect(src, f).not.toContain("function GlassCard");
    }
  });

  it("filter-aware panels send lobId via the shared helper", () => {
    for (const f of ["LiveMonitoringPanel", "AnalyticsPanel", "CompliancePanel", "InterventionsPanel", "ShiftEffectivenessPanel", "AuditTrailPanel", "ProcessTeamRosterPanel", "TrendsPanel"]) {
      expect(readFileSync(resolve(dir, `${f}.tsx`), "utf8"), f).toContain("scopeParams");
    }
  });
});
