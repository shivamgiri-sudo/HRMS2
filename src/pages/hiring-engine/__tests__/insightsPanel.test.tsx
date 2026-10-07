/** Insights panel: pure view-model tables and static markup (node env). Clicks, focus and dismissal need the live check. */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/hrmsApi", () => ({ hrmsApi: { get: vi.fn(() => new Promise(() => undefined)) } }));

import InsightsPanel from "../command/InsightsPanel";
import {
  EMPTY_MESSAGE, INCOMPLETE_MESSAGE, countsText, insightActionTarget, insightNavHash, panelView, rankInsights, severityCounts, toCard, visibleInsights,
} from "../command/insightsPanelModel";
import { defaultFilters } from "../command/driveCommandModel";
import type { DriveInsight, InsightAction } from "../command/driveCommandTypes";

const R = "0a1b2c3d-0000-4000-8000-000000000001";
const ins = (id: string, severity: DriveInsight["severity"], over: Partial<DriveInsight> = {}): DriveInsight => ({
  id, rule: "under_target", severity, sourceType: "meta_live", requisitionId: R, title: `Title ${id}`,
  evidence: [{ label: "Projected arrivals a day", value: "8" }, { label: "Target a day", value: "20" }],
  suggestion: `Suggestion ${id}`, effect: { value: 12, unit: "arrivals_per_day", text: "about +12 arrivals a day" }, action: { type: "open_plan", requisitionId: R, date: "2026-10-15" }, ...over,
});
const noop = () => undefined;
const render = (insights: DriveInsight[] | undefined, over: { partial?: boolean; dismissed?: string[] } = {}) =>
  renderToStaticMarkup(<InsightsPanel analytics={insights ? { insights, partial: !!over.partial } : null} dismissed={new Set(over.dismissed ?? [])} onDismiss={noop} onRestore={noop} onAction={noop} onRetry={noop} />);

describe("insightActionTarget", () => {
  const cases: Array<[string, InsightAction, unknown]> = [
    ["open_plan", { type: "open_plan", requisitionId: R, date: "2026-10-15" }, { section: "plan", requisitionId: R, date: "2026-10-15", intent: "open_plan", label: "Open the plan" }],
    ["plan_now", { type: "plan_now", requisitionId: R, date: "2026-10-15" }, { section: "plan", requisitionId: R, date: "2026-10-15", intent: "plan_now", label: "Preview Plan now" }],
    ["extend_stream", { type: "extend_stream", streamId: "s1", requisitionId: R }, { section: "plan", requisitionId: R, streamId: "s1", intent: "extend", label: "Extend the stream" }],
    ["create_stream", { type: "create_stream", requisitionId: R, sourceType: "meta_old" }, { section: "plan", requisitionId: R, sourceType: "meta_old", intent: "create_stream", label: "Add an old-data re-run" }],
    ["open_section live", { type: "open_section", section: "live" }, { section: "live", intent: "open_section", label: "Open Live Meta" }],
    ["open_section old", { type: "open_section", section: "old" }, { section: "old", intent: "open_section", label: "Open Old Meta data" }],
    ["open_section he", { type: "open_section", section: "he" }, { section: "he", intent: "open_section", label: "Open Hiring Engine" }],
    ["open_followup", { type: "open_followup" }, { section: "summary", intent: "followup", label: "Open follow-up issues" }],
  ];
  it.each(cases)("%s maps to its control", (_n, action, want) => {
    expect(insightActionTarget(action)).toMatchObject(want as object);
  });
  it("none, unknown types and malformed payloads give no button and never throw", () => {
    for (const a of [{ type: "none" }, { type: "teleport" }, {}, null, undefined, 7, "open_plan", { type: "open_plan" }, { type: "extend_stream", requisitionId: R },
      { type: "create_stream", requisitionId: R, sourceType: "bogus" }, { type: "open_section", section: "nowhere" }, { type: "open_plan", requisitionId: "  " }]) {
      expect(insightActionTarget(a)).toBeNull();
    }
  });
  it("navigation hash narrows the requisition and keeps the other filters", () => {
    const f = { ...defaultFilters(), branch: "Pune" };
    const h = insightNavHash(insightActionTarget({ type: "open_plan", requisitionId: R, date: "2026-10-15" })!, f);
    expect(h).toBe(`#drives:plan?req=${R}&branch=Pune`);
    expect(insightNavHash(insightActionTarget({ type: "open_followup" })!, f)).toBe("#drives:summary?branch=Pune");
  });
});

describe("ranking, counts and dismissal", () => {
  const list = [ins("a", "info"), ins("b", "critical"), ins("c", "warn"), ins("d", "critical"), ins("e", "info"), ins("f", "warn")];
  it("groups critical > warn > info and keeps delivered order inside a severity", () => {
    expect(rankInsights(list).map((i) => i.id)).toEqual(["b", "d", "c", "f", "a", "e"]);
    expect(rankInsights(rankInsights(list)).map((i) => i.id)).toEqual(["b", "d", "c", "f", "a", "e"]);
  });
  it("drops duplicate and id-less rows, tolerates non-arrays", () => {
    expect(rankInsights([ins("a", "info"), ins("a", "critical"), { ...ins("", "info") }, null as unknown as DriveInsight]).map((i) => i.id)).toEqual(["a"]);
    expect(rankInsights(undefined)).toEqual([]);
    expect(rankInsights("x" as unknown as DriveInsight[])).toEqual([]);
  });
  it("an unknown severity reads as a tip", () => {
    expect(toCard(ins("z", "weird" as DriveInsight["severity"])).severityLabel).toBe("Tip");
  });
  it("visibleInsights drops dismissed ids", () => {
    expect(visibleInsights(list, new Set(["a", "c"])).map((i) => i.id)).toEqual(["b", "d", "e", "f"]);
  });
  it("counts by severity as text", () => {
    expect(severityCounts(list)).toEqual({ critical: 2, warn: 2, info: 2, total: 6 });
    expect(countsText(severityCounts(list))).toBe("2 critical, 2 warnings, 2 tips");
    expect(countsText({ critical: 1, warn: 0, info: 1, total: 2 })).toBe("1 critical, 1 tip");
    expect(countsText({ critical: 0, warn: 0, info: 0, total: 0 })).toBe("None");
  });
  it("panelView states", () => {
    expect(panelView({ insights: list, partial: false }, new Set()).state).toBe("list");
    expect(panelView({ insights: [], partial: false }, new Set())).toMatchObject({ state: "empty", message: EMPTY_MESSAGE });
    expect(panelView({ insights: [ins("a", "info")], partial: false }, new Set(["a"]))).toMatchObject({ state: "all_dismissed", dismissedCount: 1 });
    expect(panelView({ insights: [], partial: true }, new Set())).toMatchObject({ state: "unavailable", message: INCOMPLETE_MESSAGE });
    expect(panelView({ insights: list, partial: true }, new Set())).toMatchObject({ state: "list", incomplete: true });
    expect(panelView(null, new Set()).state).toBe("unavailable");
    expect(panelView({ insights: undefined as unknown as DriveInsight[], partial: false }, new Set()).state).toBe("unavailable");
  });
  it("text formatting never emits NaN or undefined", () => {
    const bad = ins("n", "warn", { title: undefined as unknown as string, suggestion: undefined as unknown as string, effect: { value: NaN, unit: "people", text: undefined as unknown as string },
      evidence: [{ label: undefined as unknown as string, value: NaN as unknown as string }, null as unknown as { label: string; value: string }] });
    const json = JSON.stringify(toCard(bad)) + JSON.stringify(panelView({ insights: [bad], partial: false }, new Set()));
    expect(json).not.toMatch(/NaN|undefined|null,"suggestion/);
    expect(toCard(bad)).toMatchObject({ title: "Suggestion", effect: null, evidence: [{ label: "Value", value: "–" }] });
  });
});

describe("InsightsPanel markup", () => {
  it("normal: severity words with icons, type badge, evidence list, effect, one action and a dismiss per card", () => {
    const html = render([ins("a", "info", { sourceType: "he", action: { type: "none" } }), ins("b", "critical")]);
    expect(html).toContain("Critical");
    expect(html).toContain("Tip");
    expect(html).toContain("2 suggestions: 1 critical, 1 tip");
    expect(html.indexOf("Title b")).toBeLessThan(html.indexOf("Title a")); // critical first
    expect(html).toContain("<dl");
    expect(html).toContain("Projected arrivals a day");
    expect(html).toContain("about +12 arrivals a day");
    expect(html).toContain(">Open the plan<");
    expect(html).toContain('aria-label="Open the plan: Title b"');
    expect(html.match(/<article /g)).toHaveLength(2);
    expect(html.match(/aria-labelledby="insight-\d+-[ab]"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Dismiss: Title a"');
    expect(html).toContain('aria-label="Dismiss: Title b"');
    expect(html.match(/<button[^>]*>\s*Open the plan/g)).toHaveLength(1); // the "none" card has no action button
    expect(html).toContain("Hiring Engine");
    expect(html).toContain("<ul");
    expect(html).toContain("min-h-11");
    expect(html).toContain("dark:");
    expect(html).not.toMatch(/NaN|undefined/);
  });
  it("empty state", () => {
    const html = render([]);
    expect(html).toContain("No suggestions right now: the numbers are inside the expected range");
    expect(html).toContain("0 suggestions: None");
    expect(html).not.toContain("<article");
  });
  it("partial analytics: warns, keeps the list and offers Retry; an empty partial list is not called fine", () => {
    const withList = render([ins("a", "warn")], { partial: true });
    expect(withList).toContain(INCOMPLETE_MESSAGE);
    expect(withList).toContain("Retry");
    expect(withList).toContain("<article");
    const empty = render([], { partial: true });
    expect(empty).toContain(INCOMPLETE_MESSAGE);
    expect(empty).not.toContain("inside the expected range");
  });
  it("failed analytics (no payload)", () => {
    const html = render(undefined);
    expect(html).toContain("could not be calculated");
    expect(html).toContain("Retry");
  });
  it("dismissed cards are hidden and the restore button counts them", () => {
    const html = render([ins("a", "info"), ins("b", "info")], { dismissed: ["a"] });
    expect(html).not.toContain("Title a");
    expect(html).toContain("1 dismissed, show again");
    expect(html).toContain("1 suggestion:");
  });
  it("a card with an unknown action type renders with no action button", () => {
    const html = render([ins("a", "warn", { action: { type: "teleport", to: "mars" } as unknown as InsightAction })]);
    expect(html).toContain("<article");
    expect(html).toContain('aria-label="Dismiss: Title a"');
    expect(html.match(/<button/g)).toHaveLength(1);
  });
  it("long suggestion text wraps instead of overflowing", () => {
    const long = "x".repeat(900);
    const html = render([ins("a", "info", { suggestion: long, title: `T${"y".repeat(300)}` })]);
    expect(html).toContain(long);
    expect(html).toContain("break-words");
    expect(html).toContain("min-w-0");
  });
});

describe("InsightsPanel ids and live regions", () => {
  it("ids that differ only in special characters get distinct heading ids", () => {
    const html = render([ins("a/b", "warn"), ins("a:b", "warn")]);
    const ids = (html.match(/aria-labelledby="insight-[^"]+"/g) ?? []);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
  it("the incomplete-result message is a status, not a second alert", () => {
    const html = render([ins("a", "warn")], { partial: true });
    expect(html).toContain(INCOMPLETE_MESSAGE);
    expect(html).not.toContain('role="alert"');
  });
});
