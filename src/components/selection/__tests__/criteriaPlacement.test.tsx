import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/hrmsApi", () => ({ hrmsApi: { get: vi.fn(() => new Promise(() => undefined)) } }));
vi.mock("@/hooks/useUserRole", () => ({ useHasRole: vi.fn(() => true) }));

import { CriteriaSectionView } from "../CriteriaSection";
import { CampaignCriteriaView } from "../CampaignCriteria";
import { panelTabs } from "../RequisitionCriteriaPanel";
import { listRows, listCounts, CRITERIA_READ_ROLES } from "../criteriaListModel";
import { ALL_SECTIONS, SECTIONS, nextSectionByKey, parseCommandHash, sectionsFor, commandHash, defaultFilters } from "@/pages/hiring-engine/command/driveCommandModel";
import { DriveCommandView, sectionParts } from "@/pages/hiring-engine/command/DriveCommandCenter";
import type { RequisitionItem } from "../selectionTypes";

const all = { read: true, edit: true, export: true, approve: true, override: true };
const ceo = { read: true, edit: false, export: false, approve: false, override: false };
const none = { read: false, edit: false, export: false, approve: false, override: false };
const now = new Date("2026-10-09T12:00:00Z");
const item = (id: string, o: Partial<RequisitionItem> = {}): RequisitionItem => ({ id, code: `REQ-${id}`, branch: "NOIDA-2", process: "Onfido", designation: "CSE", approvalStatus: "approved",
  completeness: { score: 39, label: "incomplete", missing: ["education_min"], enrolmentReady: false }, legacy: true, undecided: [], defaultedMust: ["rotational_shift"], version: null, ...o });
const noop = () => undefined;

describe("Command Center: Selection criteria section", () => {
  it("sits after Summary, only when the role may read criteria; #drives:criteria parses and round-trips", () => {
    expect(ALL_SECTIONS.map((s) => s.id)).toEqual(["summary", "criteria", "live", "old", "he", "plan"]);
    expect(sectionsFor(false)).toBe(SECTIONS);
    expect(parseCommandHash("#drives:criteria", now).section).toBe("criteria");
    expect(commandHash("criteria", defaultFilters(now), now)).toBe("#drives:criteria");
    expect(nextSectionByKey("summary", "ArrowRight", ALL_SECTIONS)).toBe("criteria");
    expect(nextSectionByKey("summary", "ArrowRight")).toBe("live");
  });
  it("the tab shows with the criteria sections; no filter bar and no analytics skeleton on it", () => {
    const f = defaultFilters(now);
    const html = renderToStaticMarkup(<DriveCommandView section="criteria" filters={f} analytics={null} loading error={null} onSection={noop} onFilters={noop} onRetry={noop} requisitions={[]} branches={[]} sections={ALL_SECTIONS}>x</DriveCommandView>);
    expect(html.match(/role="tab"/g)).toHaveLength(6);
    expect(html).toContain(">Selection criteria<");
    expect(html).not.toContain("Loading drive analytics");
    expect(sectionParts("criteria").gated).toBeNull();
  });
  it("table with badges and undecided-as-MUST text; only-incomplete filter; honest empty states", () => {
    const html = renderToStaticMarkup(<CriteriaSectionView items={[item("a"), item("b", { completeness: { score: 100, label: "complete", missing: [], enrolmentReady: true }, defaultedMust: [] })]} permissions={all}
      onlyIncomplete={false} onOnlyIncomplete={noop} selected={null} onSelect={noop} loading={false} error={null} onRetry={noop} now={now} />);
    expect(html).toContain("2 requisitions, 1 with criteria incomplete");
    expect(html).toContain("1 not decided, acting as MUST: OK with rotational shifts");
    expect(html).toContain('aria-label="Open criteria of REQ-a"');
    expect(html).toContain("Only criteria incomplete");
    expect(html).toContain("overflow-x-auto");
    const empty = renderToStaticMarkup(<CriteriaSectionView items={[]} permissions={all} onlyIncomplete onOnlyIncomplete={noop} selected={null} onSelect={noop} loading={false} error={null} onRetry={noop} now={now} />);
    expect(empty).toContain("Every open requisition you can see has complete criteria.");
    const loading = renderToStaticMarkup(<CriteriaSectionView items={null} permissions={null} onlyIncomplete={false} onOnlyIncomplete={noop} selected={null} onSelect={noop} loading error={null} onRetry={noop} now={now} />);
    expect(loading).toContain('aria-label="Loading requisitions"');
  });
});

describe("campaign drawer and panel by role", () => {
  it("bulk edit only for editors with several requisitions; nothing without read", () => {
    const two = [item("a"), item("b")];
    expect(renderToStaticMarkup(<CampaignCriteriaView items={two} permissions={all} selected={null} onSelect={noop} onBulk={noop} now={now} />)).toContain("Bulk edit criteria");
    expect(renderToStaticMarkup(<CampaignCriteriaView items={two} permissions={ceo} selected={null} onSelect={noop} onBulk={noop} now={now} />)).not.toContain("Bulk edit");
    expect(renderToStaticMarkup(<CampaignCriteriaView items={[item("a")]} permissions={all} selected={null} onSelect={noop} onBulk={noop} now={now} />)).not.toContain("Bulk edit");
    expect(renderToStaticMarkup(<CampaignCriteriaView items={two} permissions={none} selected={null} onSelect={noop} onBulk={noop} now={now} />)).toBe("");
    expect(renderToStaticMarkup(<CampaignCriteriaView items={[]} permissions={all} selected={null} onSelect={noop} onBulk={noop} now={now} />)).toContain("not linked to a requisition you can see");
  });
  it("panel tabs per role: ceo reads status only; recruiters get nothing", () => {
    expect(panelTabs(all).map((t) => t.label)).toEqual(["Summary", "Preview", "Approve shortlist", "Booked, no longer matching"]);
    expect(panelTabs(ceo).map((t) => t.label)).toEqual(["Summary", "Preview", "Shortlist status"]);
    expect(panelTabs(none)).toEqual([]);
    expect(CRITERIA_READ_ROLES).not.toContain("recruiter");
  });
  it("list rows", () => {
    expect(listRows([item("a")], now)[0]).toMatchObject({ code: "REQ-a", where: "NOIDA-2 · Onfido · CSE", incomplete: true });
    expect(listCounts([])).toBe("0 requisitions, 0 with criteria incomplete");
  });
});

describe("375 px: screen-reader-only text stays inside its scroll box", () => {
  it("every table scroll wrapper is a positioning context (an absolute sr-only span would widen the page otherwise)", async () => {
    const fs = await import("node:fs");
    const dir = new URL("..", import.meta.url).pathname;
    for (const f of fs.readdirSync(dir).filter((x: string) => x.endsWith(".tsx"))) {
      const src = fs.readFileSync(`${dir}${f}`, "utf8");
      for (const m of src.matchAll(/className="([^"]*\boverflow-(?:x-)?auto\b[^"]*)"/g)) expect(`${f}: ${m[1]}`).toMatch(/\brelative\b/);
    }
  });
});
