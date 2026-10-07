/**
 * Accessibility and responsive checklist by static markup (node env, no DOM): every section of the Drive Command Center rendered with a full
 * fixture, plus the panels and dialogs it opens. Focus order, keyboard and real widths need the live check.
 */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/hrmsApi", () => ({ hrmsApi: { get: vi.fn(() => new Promise(() => undefined)), post: vi.fn(() => new Promise(() => undefined)) } }));

import { DriveCommandView, sectionParts } from "../command/DriveCommandCenter";
import InsightsPanel from "../command/InsightsPanel";
import { FollowupPanelView, type PanelData } from "../command/FollowupPanel";
import { DetailView } from "../command/DriveGroupRow";
import { PlanSectionView, WhatIfPanel } from "../command/PlanSection";
import { D1ChecklistView } from "../command/D1Checklist";
import StreamActions, { ConfirmBody, RowStreamActionsView, StreamMenu } from "../command/StreamActions";
import { CreateStreamForm } from "../command/CreateStreamDialog";
import { calendarCells, planDay, type PlanStreamInput } from "../command/planMath";
import { defaultFilters, type SectionId } from "../command/driveCommandModel";
import { STAGES, type DriveAnalytics, type DriveGroup, type DriveInsight, type DrivePlan, type Grid, type SourceType, type StageCounts, type StreamView, type TrendPoint } from "../command/driveCommandTypes";

// ---- fixture -------------------------------------------------------------------------------------------------------------------------------
const R = "0a1b2c3d-0000-4000-8000-000000000001";
const TODAY = "2026-10-08";
const noop = () => undefined;
const sc = (o: Partial<StageCounts> = {}): StageCounts => ({ leads: 0, qualified: 0, invited: 0, confirmed: 0, arrived: 0, selected: 0, joined: 0, ...o });
const conv = (s: StageCounts) => STAGES.slice(1).map((to, i) => ({ from: STAGES[i], to, rate: s[STAGES[i]] > 0 ? s[to] / s[STAGES[i]] : null }));
const typ = (s: StageCounts, spark: number[]) => ({ stages: s, previous: sc({ arrived: 5 }), noShow: 3, declined: 2, conversions: conv(s), sparkline: spark });
const grid = (): Grid => Array.from({ length: 7 }, (_, d) => Array.from({ length: 24 }, (_, h) => (d + h) % 5));
const TYPES: SourceType[] = ["meta_live", "meta_old", "he"];
const totals = { wanted: 40, lined: 60, invited: 55, confirmed: 30, arrived: 21, noShow: 7, declined: 3, showRate: 0.7 };
const group = (t: SourceType, i: number): DriveGroup => ({
  requisitionId: R, branch: "Pune", requisition: `REQ-${i}`, role: "Agent", sourceType: t, types: [t], streamIds: t === "he" ? [] : ["s1"],
  window: { from: "2026-10-05", to: "2026-10-10", dayIndex: 3, days: 6 }, totals,
  days: ["2026-10-07", "2026-10-08", "2026-10-09"].map((date) => ({ date, driveId: "d1", status: "active", wanted: 10, lined: 12, invited: 11, confirmed: 8, arrived: date < TODAY ? 6 : 0, noShow: 1, declined: 1 })),
} as unknown as DriveGroup);
const ins = (id: string, severity: DriveInsight["severity"]): DriveInsight => ({
  id, rule: "under_target", severity, sourceType: "meta_live", requisitionId: R, title: `Title ${id}`,
  evidence: [{ label: "Projected arrivals a day", value: "8" }], suggestion: `Suggestion ${id}`,
  effect: { value: 12, unit: "arrivals_per_day", text: "about +12 arrivals a day" }, action: { type: "open_plan", requisitionId: R, date: "2026-10-09" },
} as DriveInsight);
const insights = [ins("a", "critical"), ins("b", "warn"), ins("c", "info")];
const analytics = {
  generatedAt: "2026-10-08T05:00:00Z", window: { from: "2026-09-25", to: TODAY, days: 14 }, previousWindow: { from: "2026-09-11", to: "2026-09-24" },
  filter: { requisitionId: null, branch: null }, followupMode: "live", qualifiedTracked: true,
  types: {
    meta_live: typ(sc({ leads: 100, qualified: 60, invited: 50, confirmed: 30, arrived: 20, selected: 10, joined: 8 }), [1, 2, 3]),
    meta_old: typ(sc({ leads: 40, qualified: 0, invited: 8, confirmed: 5, arrived: 5, selected: 2 }), [0, 1, 0]),
    he: typ(sc({ leads: 48, invited: 67, confirmed: 41, arrived: 37, selected: 13, joined: 3 }), [2, 2, 4]),
  },
  typesPresent: TYPES,
  daily: ["2026-10-06", "2026-10-07", TODAY].map((date, i) => ({ date, target: 20, byType: { meta_live: { invited: i + 3, confirmed: i + 2, arrived: i + 1 }, meta_old: { invited: 1, confirmed: 1, arrived: 0 }, he: { invited: 5, confirmed: 4, arrived: 3 } } })),
  timing: { replies: { meta_live: grid(), meta_old: grid(), he: grid() }, arrivals: { meta_live: grid(), meta_old: grid(), he: grid() }, arrivalsWithoutTime: 2 },
  scatter: Array.from({ length: 6 }, (_, i) => ({ requisitionId: `r${i}`, code: `REQ-${i}`, branch: "Pune", sourceType: TYPES[i % 3], leads: 10 + i * 7, showRate: 0.3 + i / 100, leadToJoinRate: 0.05 })),
  waterfall: {
    meta_live: [{ from: "leads", to: "qualified", lost: 40, reasons: [{ reason: "not_qualified", n: 40 }] }, { from: "confirmed", to: "arrived", lost: 10, reasons: [{ reason: "no_show", n: 10 }] }],
    meta_old: [{ from: "invited", to: "confirmed", lost: 3, reasons: [{ reason: "no_reply", n: 3 }] }], he: [],
  },
  groups: TYPES.flatMap((t, i) => [group(t, i), group(t, i + 10)]),
  cost: { available: false, note: "Cost per source arrives with Plan 5" }, insights, requisitionCount: 6, truncated: false, partial: false, failedSections: [],
} as unknown as DriveAnalytics;

const stream = (over: Partial<StreamView> = {}): StreamView => ({
  id: "s1", requisitionId: R, branchName: "Pune", sourceType: "meta_live", originId: "c1", originLabel: "Oct ads", openFrom: "2026-10-05", openDays: 6,
  dailyInvites: null, status: "open", closedReason: null, createdBy: null, createdAt: "2026-10-01T00:00:00Z", add: [], skip: [], version: 2,
  window: { from: "2026-10-05", to: "2026-10-10", dayIndex: 4, days: 6, state: "running" }, label: "day 4 of 6, ends Sat 10 Oct", warnings: [], ...over,
});
const input = (o: Partial<PlanStreamInput> & { streamId: string }): PlanStreamInput => ({
  sourceType: "meta_live", label: o.streamId, cap: 30, lined: 0, rate: { streamId: o.streamId, sourceType: "meta_live", invited: 40, arrived: 12, rate: 0.3, basis: "actual" }, poolRemaining: null, covers: true, ...o,
});
const day1 = planDay({ date: "2026-10-09", driveId: "d1", target: 20, capacity: 60, streams: [input({ streamId: "s1", label: "Oct ads", lined: 20 }), input({ streamId: "s2", sourceType: "he", label: "Pool", lined: 10, poolRemaining: 3 })] });
const plan = {
  requisitionId: R, code: "REQ-7", branch: "Pune", generatedAt: "2026-10-08T10:00:00Z", from: "2026-10-09", days: [day1], calendar: calendarCells([day1]), rates: [],
  checklist: { date: "2026-10-09", preview: { requisitionId: R, code: "REQ-7", branch: "Pune", date: "2026-10-09", driveId: null, drive: "would_create",
    streams: [{ streamId: "s1", sourceType: "meta_live", originLabel: "Oct ads", cap: 30, alreadyLined: 0, lined: 0, wouldLine: 10 }] },
  items: [{ kind: "will_plan", text: "Tonight the evening pass will line up 10 people" }, { kind: "pool_below_quota", text: "Pool: 3 people left", streamId: "s2" }] },
  partial: false, failedSections: [],
} as unknown as DrivePlan;
const points: TrendPoint[] = ["2026-10-07", TODAY, "2026-10-09"].map((date) => ({ date, driveId: "d", status: "open", wanted: 10, lined: 12, invited: 11, confirmed: 8, arrived: date < TODAY ? 6 : 0, noShow: 2, declined: 1, showRate: 0.75, streams: [] }));
const followup: PanelData = {
  status: { mode: "live", callFiles: [{ id: "cb1", createdAt: "2026-10-07T12:30:00Z", rows: 9, status: "failed", error: "SMTP 550" }], report: { running: true, last: { slot: "2026-10-07 18:00", ok: true, tries: 1 } } },
  summary: { mode: "live", data: [{ sourceType: "meta_live", total: 10, open: 6, stopped: 4 }] },
  attention: [{ channel: "whatsapp", cause: "131049", count: 1, rows: [{ id: "a1", name: "Asha", mobileMasked: "xxxxxx3210", requisitionId: R, sourceType: "meta_live", error: "131049", attempts: 2, updatedAt: "2026-10-07T08:30:00.000Z", outcomeUnknown: false, retryable: true, retryReason: null }] }],
  sources: null, failed: [],
} as unknown as PanelData;

const filters = { ...defaultFilters(new Date("2026-10-08T06:00:00Z")), requisitionId: R };
const reqs = [{ id: R, label: "REQ-7 - Agent", branch: "Pune", code: "REQ-7" }];
const insightsPanel = <InsightsPanel analytics={analytics} dismissed={new Set()} onDismiss={noop} onRestore={noop} onAction={noop} onRetry={noop} />;
const planView = (
  <PlanSectionView requisitionId={R} groups={analytics.groups} groupsLoading={false} onPick={noop} plan={plan} loading={false} error={null} onRetry={noop} day="2026-10-09" onDay={noop}
    streamActions={(id) => (id === "s1" ? <StreamActions stream={stream()} today={TODAY} onDone={noop} /> : null)}
    checklist={<D1ChecklistView checklist={plan.checklist} date="2026-10-09" busy={null} run={{ dryRun: true, result: plan.checklist.preview, error: null }} onPreview={noop} onPlanNow={noop} />}
    onCreateStream={noop} />
);
const extras: Record<SectionId, React.ReactNode> = {
  summary: <FollowupPanelView expanded loading={false} error={null} data={followup} qualifiedTracked onToggle={noop} onReload={noop} onRetry={noop} onMarkCalled={noop} />,
  live: (
    <>
      <DetailView group={group("meta_live", 1)} today={TODAY} trend={{ requisitionId: R, branch: "Pune", sourceType: "meta_live", window: { from: "2026-10-05", to: "2026-10-10", dayIndex: 3, days: 6 }, points, partial: false, failedSections: [] } as never}
        trendError={null} loading={false} events={[]} eventsError={null} onRetry={noop}>
        <RowStreamActionsView streams={[stream(), stream({ id: "s2", status: "closed" })]} today={TODAY} loading={false} error={null} note={null} onRetry={noop} onDone={noop} onCreate={noop} />
      </DetailView>
      <StreamMenu stream={stream()} onPick={noop} initiallyOpen />
    </>
  ),
  old: <ConfirmBody action="skip_day" stream={stream()} input={{ date: "" }} today={TODAY} errors={["Pick a date"]} showErrors serverError={null} busy={false} onInput={noop} idPrefix="t" />,
  he: (
    <CreateStreamForm form={{ requisitionId: R, sourceType: "meta_live", originId: "c1", openFrom: "2026-10-09", openDays: "7", dailyInvites: "", open: true, override: false, reason: "" }}
      requisitions={reqs} lockRequisition={false} today={TODAY} origins={[{ id: "c1", label: "Oct ads" }]} originsLoading={false} originsError={null}
      readiness={{ loading: false, error: null, problems: [{ code: "no_branch_address", severity: "blocking", message: "Add the branch address" }], neverOverride: [] }}
      errors={[]} showErrors={false} serverError={null} busy={false} onChange={noop} onCancel={noop} idPrefix="c" />
  ),
  plan: <WhatIfPanel day={day1} />,
};
const SECTIONS: SectionId[] = ["summary", "live", "old", "he", "plan"];
function render(section: SectionId): string {
  const p = sectionParts(section, analytics, insightsPanel, { requisitions: reqs, requisitionId: R, onChanged: noop }, planView);
  return renderToStaticMarkup(
    <DriveCommandView section={section} filters={filters} analytics={analytics} loading={false} error={null} onSection={noop} onFilters={noop} onRetry={noop}
      requisitions={reqs} branches={["Delhi", "Pune"]} gated={p.gated}>{p.always}{extras[section]}</DriveCommandView>,
  );
}

// ---- tiny markup helpers (no DOM in node) ------------------------------------------------------------------------------------------------------
const attr = (tag: string, name: string): string | null => { const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag); return m ? m[1] : null; };
const openTags = (html: string, name: string): string[] => html.match(new RegExp(`<${name}\\b[^>]*>`, "g")) ?? [];
const text = (s: string): string => s.replace(/<[^>]*>/g, "").replace(/&[a-z#0-9]+;/gi, " ").trim();
function buttons(html: string): Array<{ tag: string; inner: string }> {
  const out: Array<{ tag: string; inner: string }> = [];
  const re = /<button\b[^>]*>([\s\S]*?)<\/button>/g;
  for (let m = re.exec(html); m; m = re.exec(html)) out.push({ tag: m[0].slice(0, m[0].indexOf(">") + 1), inner: m[1] });
  return out;
}
/** For each <table>, the class of its closest enclosing element. */
function tableParents(html: string): string[] {
  const stack: string[] = [];
  const out: string[] = [];
  const VOID = new Set(["input", "br", "img", "hr", "meta", "link", "col", "area", "source", "path", "rect", "circle", "line", "polyline", "polygon", "use", "stop"]);
  const re = /<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?(\/?)>/g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const [whole, name, selfClose] = m;
    if (whole.startsWith("</")) { stack.pop(); continue; }
    if (name === "table") out.push(attr(stack[stack.length - 1] ?? "", "class") ?? "");
    if (!selfClose && !VOID.has(name.toLowerCase())) stack.push(whole);
  }
  return out;
}

describe.each(SECTIONS)("section %s", (section) => {
  const html = render(section);

  it("renders real content", () => {
    expect(html.length).toBeGreaterThan(2000);
    expect(html).not.toMatch(/NaN|Infinity|undefined/);
  });
  it("every button has text or an aria-label", () => {
    const bad = buttons(html).filter((b) => !text(b.inner) && !attr(b.tag, "aria-label"));
    expect(bad.map((b) => b.tag)).toEqual([]);
  });
  // Ruling: a matching <label for> is the rule; a field wrapped in its <label> (radios, checkboxes) or the exact-number box beside a labelled
  // slider (its own aria-label) also has an accessible name and passes.
  it("every input and select has a matching <label for> (or an enclosing label / aria-label)", () => {
    const fields = [...openTags(html, "input"), ...openTags(html, "select")].filter((t) => attr(t, "type") !== "hidden");
    const labels = new Set(openTags(html, "label").map((t) => attr(t, "for")).filter(Boolean));
    const wrapped = new Set((html.match(/<label\b[^>]*>[\s\S]*?<\/label>/g) ?? []).flatMap((l) => openTags(l, "input")));
    const bad = fields.filter((t) => { const id = attr(t, "id"); return !(id && labels.has(id)) && !wrapped.has(t) && !attr(t, "aria-label"); });
    expect(bad).toEqual([]);
    expect(fields.filter((t) => attr(t, "id") && labels.has(attr(t, "id") as string)).length).toBeGreaterThan(0);
  });
  it("every chart frame has a Show table button wired to its table", () => {
    const frames = html.split('aria-labelledby="chart-title-').slice(1);
    for (const f of frames) {
      const body = f.split('aria-labelledby="chart-title-')[0];
      expect(body).toMatch(/aria-controls="chart-table-[^"]*"[^>]*>[\s\S]*?(Show|Hide) table/);
    }
    if (section === "summary") expect(frames.length).toBeGreaterThanOrEqual(7);
  });
  it("no animate- class without a motion-reduce variant", () => {
    const classes = (html.match(/class="[^"]*"/g) ?? []).filter((c) => /\banimate-/.test(c));
    expect(classes.filter((c) => !c.includes("motion-reduce:"))).toEqual([]);
  });
  it("every table sits in an overflow-x-auto wrapper", () => {
    const parents = tableParents(html);
    expect(parents.filter((c) => !c.includes("overflow-x-auto"))).toEqual([]);
    if (section === "summary" || section === "live" || section === "plan") expect(parents.length).toBeGreaterThan(0); // old / he rows are collapsed
  });
  it("every button is at least 44px tall below sm (min-h-11)", () => {
    const bad = buttons(html).map((b) => b.tag).filter((t) => !(attr(t, "class") ?? "").includes("min-h-11"));
    expect(bad).toEqual([]);
    expect(buttons(html).length).toBeGreaterThan(0);
  });
});

describe("insight status words", () => {
  it("Critical / Warning / Tip each sit next to an icon", () => {
    const html = render("summary");
    for (const w of ["Critical", "Warning", "Tip"]) expect(html).toMatch(new RegExp(`<svg[^>]*aria-hidden="true"[^>]*>[\\s\\S]{0,800}?</svg>\\s*(<[^>]+>\\s*)*${w}\\b`));
  });
});
