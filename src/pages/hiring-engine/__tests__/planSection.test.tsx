/** Plan section: the planning-maths copy against the shared case table, the pure model, and static markup (node env, no DOM). */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/hrmsApi", () => ({ hrmsApi: { get: vi.fn(() => new Promise(() => undefined)), post: vi.fn(() => new Promise(() => undefined)) } }));

import { calendarCells, invitesToClose, planDay, streamRate, whatIf, type PlanStreamInput } from "../command/planMath";
import {
  basisLabel, EMPTY_PLAN_TEXT, PLAN_FORBIDDEN_TEXT, PLAN_GENERIC_TEXT, PLAN_GONE_TEXT, calendarView, checklistGroups, fillLevel, hasEdits, planNowBody, planNowErrorText,
  coversDay, planNowLines, planNowSummary, planPickList, planState, recomputeDay, streamRows,
} from "../command/planModel";
import { PlanSectionView, WhatIfPanel, type PlanSectionViewProps } from "../command/PlanSection";
import D1Checklist, { D1ChecklistView } from "../command/D1Checklist";
import PlanCalendar from "../command/PlanCalendar";
import StreamActions from "../command/StreamActions";
import { sectionParts } from "../command/DriveCommandCenter";
import type { DriveGroup, DrivePlan, PlanDay, StreamDayPlan, StreamView } from "../command/driveCommandTypes";
import { PLAN_MATH_CASES } from "./fixtures/planMathCases";

const R = "0a1b2c3d-0000-4000-8000-000000000001";
const NOT_NUMBER = /NaN|Infinity|undefined/;

// ---- shared case table (the backend runs the same file: backend/.../__tests__/planMathParity.test.ts) ----------------------------------------
describe("planning maths: shared case table (frontend copy)", () => {
  it.each(PLAN_MATH_CASES.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const got = c.fn === "planDay" ? planDay(c.input as never)
      : c.fn === "whatIf" ? whatIf(c.base as never, c.edits as never)
        : c.fn === "streamRate" ? streamRate(c.input as never)
          : c.fn === "invitesToClose" ? invitesToClose(...c.args)
            : calendarCells(c.days as never);
    expect(got).toEqual(c.expected);
  });
});

// ---- fixtures -----------------------------------------------------------------------------------------------------------------------------
const rate = (streamId: string, r: number, basis: "actual_weekday" | "actual" | "plan_default", invited = 0, weekday?: number) => ({ streamId, sourceType: "meta_live" as const, invited, arrived: 0, rate: r, basis, ...(weekday != null ? { weekday } : {}) });
const input = (o: Partial<PlanStreamInput> & { streamId: string }): PlanStreamInput => ({
  sourceType: "meta_live", label: o.streamId, cap: 30, lined: 0, rate: rate(o.streamId, 0.4, "plan_default"), poolRemaining: null, covers: true, ...o,
});
const OCT = input({ streamId: "s1", label: "Oct ads", lined: 20, rate: rate("s1", 0.3, "actual", 40), poolRemaining: null });
const POOL = input({ streamId: "s2", sourceType: "he", label: "Pool: ATS history", lined: 10, rate: { ...rate("s2", 0.4, "plan_default"), sourceType: "he" }, poolRemaining: 3 });
const day1 = planDay({ date: "2026-10-09", driveId: "d1", target: 20, capacity: 60, streams: [OCT, POOL] }); // seats 30 of 60 -> good
const day2 = planDay({ date: "2026-10-10", driveId: null, target: 20, capacity: 60, streams: [{ ...OCT, lined: 0 }, { ...POOL, covers: false, lined: 0 }] });
const preview: StreamDayPlan = {
  requisitionId: R, code: "REQ-7", branch: "Pune", date: "2026-10-09", driveId: null, drive: "would_create",
  streams: [
    { streamId: "s1", sourceType: "meta_live", originLabel: "Oct ads", cap: 30, alreadyLined: 0, lined: 0, wouldLine: 10 },
    { streamId: "s2", sourceType: "he", originLabel: "Pool: ATS history", cap: 15, alreadyLined: 0, lined: 0, wouldLine: 15 },
  ],
};
const planOf = (days: PlanDay[], over: Partial<DrivePlan> = {}): DrivePlan => ({
  requisitionId: R, code: "REQ-7", branch: "Pune", generatedAt: "2026-10-08T10:00:00Z", from: "2026-10-09", days, calendar: calendarCells(days), rates: [],
  checklist: { date: "2026-10-09", preview, items: [
    { kind: "will_plan", text: "Tonight the evening pass will create the drive and line up 25 people (Oct ads 10, Pool: ATS history 15)" },
    { kind: "pool_below_quota", text: "Pool: ATS history: 3 people left in the pool for a daily quota of 15", streamId: "s2" },
  ] },
  partial: false, failedSections: [], ...over,
});
const NORMAL = planOf([day1, day2]);
const group = (over: Partial<DriveGroup>): DriveGroup => ({
  requisitionId: R, branch: "Pune", requisition: "REQ-7", role: "Agent", sourceType: "meta_live", types: ["meta_live"], streamIds: [],
  window: { from: "2026-10-01", to: "2026-10-14", dayIndex: 1, days: 14 }, totals: { wanted: 0, lined: 0, invited: 0, confirmed: 0, arrived: 0, noShow: 0, declined: 0, showRate: 0 }, days: [], ...over,
});
const stream = (over: Partial<StreamView> = {}): StreamView => ({
  id: "s1", requisitionId: R, branchName: "Pune", sourceType: "meta_live", originId: "c1", originLabel: "Oct ads", openFrom: "2026-10-05", openDays: 6,
  dailyInvites: null, status: "open", closedReason: null, createdBy: null, createdAt: "2026-10-01T00:00:00Z", add: [], skip: [], version: 2,
  window: { from: "2026-10-05", to: "2026-10-10", dayIndex: 4, days: 6, state: "running" }, label: "day 4 of 6, ends Sat 10 Oct", warnings: [], ...over,
});
const view = (over: Partial<PlanSectionViewProps> = {}) => renderToStaticMarkup(
  <PlanSectionView requisitionId={R} groups={[]} groupsLoading={false} onPick={() => undefined} plan={NORMAL} loading={false} error={null}
    onRetry={() => undefined} day={null} onDay={() => undefined}
    streamActions={(id) => (id === "s1" ? <StreamActions stream={stream()} today="2026-10-08" onDone={() => undefined} /> : null)}
    checklist={<D1Checklist plan={over.plan ?? NORMAL} requisitionId={R} onPlanned={() => undefined} />} {...over} />,
);

// ---- model ----------------------------------------------------------------------------------------------------------------------------------
describe("recomputeDay", () => {
  const A = input({ streamId: "A", lined: 10, rate: rate("A", 0.3, "actual", 40) });
  const B = input({ streamId: "B", lined: 10, rate: rate("B", 0.4, "plan_default"), poolRemaining: 12 });
  const d = planDay({ date: "2026-10-15", driveId: null, target: 20, capacity: 60, streams: [A, B] });
  it("without overrides gives the server's numbers (expected 7, gap 13)", () => {
    expect(recomputeDay(d, {})).toMatchObject({ expected: 7, gap: 13, seatsUsed: 20 });
  });
  it("a quota replaces lined", () => {
    expect(recomputeDay(d, { A: { quota: 30 } })).toMatchObject({ expected: 13, seatsUsed: 40, gap: 7 });
  });
  it("show rate 0 gives gap = target minus the rest, never Infinity or NaN", () => {
    const r = recomputeDay(d, { B: { showRate: 0 } });
    expect(r).toMatchObject({ expected: 3, gap: 17 });
    expect(JSON.stringify(r)).not.toMatch(NOT_NUMBER);
    expect(recomputeDay(d, { A: { showRate: 0 }, B: { showRate: 0 } }).gap).toBe(20);
  });
  it("keeps seats held by people no stream owns (extraSeatsUsed)", () => {
    const withOrphans = planDay({ date: "x", driveId: null, target: 20, capacity: 60, streams: [A, B], extraSeatsUsed: 5 });
    expect(withOrphans.seatsUsed).toBe(25);
    expect(recomputeDay(withOrphans, { A: { quota: 12 } }).seatsUsed).toBe(27);
  });
  it("keeps the expected arrivals of people no stream owns (the server's extraExpected), with and without edits", () => {
    const L = input({ streamId: "L", lined: 12, rate: rate("L", 0.25, "plan_default"), poolRemaining: 500 });
    const d20 = planDay({ date: "x", driveId: "d1", target: 30, capacity: 40, streams: [L], extraSeatsUsed: 20, extraExpected: 5 });
    expect(d20).toMatchObject({ expected: 8, gap: 22, seatsUsed: 32 });
    expect(recomputeDay(d20, {})).toMatchObject({ expected: 8, gap: 22, seatsUsed: 32 });
    expect(recomputeDay(d20, { L: { quota: 20 } })).toMatchObject({ expected: 10, gap: 20, seatsUsed: 40 });
    expect(recomputeDay(d20, { L: { showRate: 0 } })).toMatchObject({ expected: 5, gap: 25 });
  });
  it("clamps quota to 0..500 and show rate to 0..100; ignores NaN edits", () => {
    expect(recomputeDay(d, { A: { quota: 9999 } }).seatsUsed).toBe(510);
    expect(recomputeDay(d, { A: { quota: -4 } }).seatsUsed).toBe(10);
    expect(recomputeDay(d, { A: { showRate: 250 } }).expected).toBe(14);
    expect(recomputeDay(d, { A: { quota: Number.NaN, showRate: Number.NaN } })).toMatchObject({ expected: 7, seatsUsed: 20 });
    expect(hasEdits({ A: { quota: Number.NaN } })).toBe(false);
    expect(hasEdits({ A: { showRate: 0 } })).toBe(true);
  });
  it("a stream not open on the day adds seats but no arrivals; streams keep the server's order", () => {
    const N = input({ streamId: "N", covers: false, lined: 4 });
    const n = planDay({ date: "x", driveId: null, target: 10, capacity: 60, streams: [N, B] });
    const r = recomputeDay(n, { N: { quota: 50 } });
    expect(r.expected).toBe(4);
    expect(r.seatsUsed).toBe(60);
    expect(r.streams.map((s) => s.streamId)).toEqual(n.streams.map((s) => s.streamId));
  });
});

describe("fillLevel", () => {
  it.each([[0, "empty", 0], [-1, "empty", 0], [Number.NaN, "empty", 0], [0.1, "low", 1], [0.25, "good", 2], [0.5, "good", 2], [0.75, "full", 3], [1, "full", 3], [1.2, "over", 4]] as const)(
    "%s -> %s", (f, word, step) => { expect(fillLevel(f)).toEqual({ word, step }); });
});

describe("planNowSummary and lines", () => {
  it("dry run that would create the drive", () => {
    expect(planNowSummary(preview)).toBe("Would create the drive for 2026-10-09 and line up 25 people");
    expect(planNowSummary({ ...preview, date: "2026-10-15" })).toBe("Would create the drive for 2026-10-15 and line up 25 people");
  });
  it("exists (dry and real), skipped, created and null", () => {
    expect(planNowSummary({ ...preview, drive: "exists", driveId: "d1" })).toBe("Drive exists; would line up 25 more");
    const real = { ...preview, drive: "exists" as const, streams: preview.streams.map((l) => ({ ...l, wouldLine: undefined, lined: 4 })) };
    expect(planNowSummary(real)).toBe("Drive exists; lined up 8 more");
    expect(planNowSummary({ ...preview, drive: "skipped", reason: "requisition is not open", streams: [] })).toBe("Skipped: requisition is not open");
    expect(planNowSummary({ ...real, drive: "created" })).toBe("Created the drive for 2026-10-09 and lined up 8 people");
    expect(planNowSummary(null)).toBe("No open stream covers that day");
  });
  it("the request's own dryRun flag decides the wording (an all-failed dry run has no wouldLine)", () => {
    const failedDry = { ...preview, drive: "exists" as const, streams: preview.streams.map((l) => ({ ...l, wouldLine: undefined, skipped: "lock wait" })) };
    expect(planNowSummary(failedDry)).toBe("Drive exists; lined up 0 more"); // the old guess
    expect(planNowSummary(failedDry, true)).toBe("Drive exists; would line up 0 more");
    expect(planNowSummary({ ...preview, drive: "exists" }, false)).toBe("Drive exists; lined up 0 more");
    const html = renderToStaticMarkup(<D1ChecklistView checklist={{ date: "2026-10-09", preview: null, items: [] }} date="2026-10-09" busy={null} run={{ dryRun: true, result: failedDry, error: null }} onPreview={() => undefined} onPlanNow={() => undefined} />);
    expect(html).toContain("would line up 0 more");
    expect(html).not.toContain("lined up 0 more (already");
  });
  it("coversDay reads the server's covers flag, not the reasoning text", () => {
    const base: PlanStreamInput = { streamId: "x", sourceType: "meta_live", label: "X", cap: 10, lined: 2, poolRemaining: null, covers: false,
      rate: { streamId: "x", sourceType: "meta_live", invited: 0, arrived: 0, rate: 0.4, basis: "plan_default" } };
    const d = planDay({ date: "2026-10-15", driveId: null, target: 10, capacity: 60, streams: [base] });
    expect(d.streams[0].covers).toBe(false);
    expect(coversDay(d.streams[0])).toBe(false);
    expect(coversDay({ ...d.streams[0], covers: true })).toBe(true); // even with the "Not open" text
    expect(coversDay(planDay({ date: "2026-10-15", driveId: null, target: 10, capacity: 60, streams: [{ ...base, covers: true }] }).streams[0])).toBe(true);
  });
  it("per-stream lines carry skipped reasons", () => {
    const p = { ...preview, drive: "exists" as const, streams: [{ ...preview.streams[0], wouldLine: undefined, lined: 3, alreadyLined: 2 }, { ...preview.streams[1], wouldLine: undefined, skipped: "origin launch not found" }] };
    expect(planNowLines(p)).toEqual([
      { streamId: "s1", label: "Oct ads", text: "lined up 3 (already 2, quota 30)", skipped: false },
      { streamId: "s2", label: "Pool: ATS history", text: "Skipped: origin launch not found", skipped: true },
    ]);
  });
  it("body and errors", () => {
    expect(planNowBody("2026-10-09", true)).toEqual({ dryRun: true, date: "2026-10-09" });
    expect(planNowBody(null, false)).toEqual({ dryRun: false });
    const err = (status: number, message: string) => Object.assign(new Error(message), { status });
    expect(planNowErrorText(err(409, "No open stream covers that day"))).toBe("No open stream covers that day");
    expect(planNowErrorText(err(400, "Pick a day after today, at most 7 days ahead"))).toBe("Pick a day after today, at most 7 days ahead");
    expect(planNowErrorText(err(403, "Forbidden"))).toBe(PLAN_FORBIDDEN_TEXT);
    expect(planNowErrorText(err(404, "Requisition not found"))).toBe(PLAN_GONE_TEXT);
    expect(planNowErrorText(err(500, "Could not plan the day"))).toBe(PLAN_GENERIC_TEXT);
    expect(planNowErrorText(null)).toBe(PLAN_GENERIC_TEXT);
  });
});

describe("planPickList, planState, rows", () => {
  it("lists requisitions with a Meta type or a stream, once each, by label", () => {
    const list = planPickList([
      group({ requisitionId: "r-he", requisition: "REQ-1", role: "", sourceType: "he", types: ["he"] }),
      group({ requisitionId: "r-he-s", requisition: "REQ-2", role: "Agent", sourceType: "he", types: ["he"], streamIds: ["s9"] }),
      group({ requisitionId: "r-m", requisition: "REQ-0", role: "", sourceType: "meta_old", types: ["meta_old"] }),
      group({ requisitionId: "r-m", requisition: "REQ-0", role: "", sourceType: "he", types: ["he"] }),
    ]);
    expect(list).toEqual([{ requisitionId: "r-m", label: "REQ-0" }, { requisitionId: "r-he-s", label: "REQ-2 - Agent" }]);
    expect(planPickList(null as never)).toEqual([]);
  });
  it("states", () => {
    expect(planState({ requisitionId: null, plan: null, loading: false, error: null })).toBe("pick");
    expect(planState({ requisitionId: R, plan: null, loading: true, error: null })).toBe("loading");
    expect(planState({ requisitionId: R, plan: null, loading: false, error: "boom" })).toBe("error");
    expect(planState({ requisitionId: R, plan: NORMAL, loading: true, error: "boom" })).toBe("ready");
    expect(planState({ requisitionId: R, plan: planOf([]), loading: false, error: null })).toBe("empty");
    expect(planState({ requisitionId: R, plan: planOf([planDay({ date: "x", driveId: null, target: 20, capacity: 60, streams: [{ ...OCT, covers: false }] })]), loading: false, error: null })).toBe("empty");
  });
  it("calendar view: text, word and open flag per cell; checklist groups", () => {
    const v = calendarView(NORMAL);
    expect(v.rows.map((r) => r.label)).toEqual(["Pool: ATS history", "Oct ads"]);
    const oct = v.rows.find((r) => r.streamId === "s1")!;
    expect(oct.cells[0]).toEqual({ date: "2026-10-09", text: "20 / 60", word: "good", step: 2, open: true });
    expect(v.rows.find((r) => r.streamId === "s2")!.cells[1].open).toBe(false);
    expect(checklistGroups(NORMAL.checklist.items).map((g) => g.items.length)).toEqual([1, 0, 1]);
    expect(streamRows(day1).find((r) => r.streamId === "s1")).toMatchObject({ rate: "30%", basis: "14-day actual", open: true });
  });
});

// ---- static markup ----------------------------------------------------------------------------------------------------------------------------
describe("Plan section markup", () => {
  it("without a requisition shows the pick list, or an empty state", () => {
    const html = view({ requisitionId: null, plan: null, groups: [group({})] });
    expect(html).toContain("Pick a requisition to plan");
    expect(html).toContain(`<option value="${R}">REQ-7 - Agent</option>`);
    expect(view({ requisitionId: null, plan: null, groups: [] })).toContain("No requisition with streams in this window");
    expect(view({ requisitionId: null, plan: null, groups: null, groupsLoading: true })).toContain('aria-label="Loading requisitions"');
  });
  it("loading, error with Retry, refresh error and partial banner", () => {
    expect(view({ plan: null, loading: true })).toContain('aria-label="Loading the plan"');
    const err = view({ plan: null, error: "Requisition not found" });
    expect(err).toContain("Could not load the plan: Requisition not found");
    expect(err).toContain("Retry");
    expect(view({ error: "timeout" })).toContain("Could not refresh: timeout. Showing the last result.");
    const partial = view({ plan: planOf([day1], { partial: true, failedSections: ["rates", "pool"] }) });
    expect(partial).toContain("Partial plan: some parts failed to load (show rates, remaining pool)");
  });
  it("a plan: reasoning text, sliders, calendar cell, checklist, Plan now, stream actions", () => {
    const html = view();
    expect(html).toContain(day1.streams.find((s) => s.streamId === "s1")!.reasoning);
    expect(html).toContain("pool has 3 left, so 3");
    expect(html).toContain('aria-label="Daily quota for Oct ads"');
    expect(html).toContain('aria-label="Show rate for Oct ads"');
    expect(html).toContain('aria-valuetext="20 people"');
    expect(html).toContain('aria-valuetext="30%"');
    expect(html).toContain('type="range" min="0" max="500" step="1"');
    expect(html).toContain('type="range" min="0" max="100" step="1"');
    expect(html).toContain("20 / 60");
    expect(html).toContain(">good<");
    expect(html).toContain("Tonight the evening pass will create the drive and line up 25 people (Oct ads 10, Pool: ATS history 15)");
    expect(html).toContain("Dry run of tonight&#x27;s pass:</span> Would create the drive for 2026-10-09 and line up 25 people");
    expect(html).toContain(">Plan now<");
    expect(html).toContain("Preview Plan now (dry run)");
    expect(html).toContain('aria-haspopup="menu"'); // the Extend menu (Task 14) on the stream's row
    // the menu sits outside the scrolling table (overflow-x:auto would clip it vertically)
    const rec = html.indexOf('id="plan-rec-heading"');
    expect(html.indexOf('aria-haspopup="menu"', rec)).toBeGreaterThan(html.indexOf("</table>", rec));
    expect(html).toContain('aria-label="Stream actions"');
    expect(html).toContain('scope="col"');
    expect(html).toContain('scope="row"');
    expect(html).toContain('id="plan-now-result"');
    expect(html).toContain("Fri 9 Oct with your changes: expected 10 arrivals for a target of 20, gap 10, seats used 30 of 60");
    expect(html).not.toMatch(NOT_NUMBER);
  });
  it("no open streams: the empty text and Open a stream", () => {
    const html = view({ plan: planOf([]), onCreateStream: () => undefined });
    expect(html).toContain(EMPTY_PLAN_TEXT);
    expect(html).toContain("Open a stream");
  });
  it("rate 0 and pool null: finite numbers only", () => {
    const zero = planDay({ date: "2026-10-09", driveId: null, target: 3, capacity: 0, streams: [input({ streamId: "z", label: "Zero", rate: rate("z", 0, "actual", 50), poolRemaining: null })] });
    const html = view({ plan: planOf([zero]) });
    expect(html).toContain("Gap 3 shows / 0% show rate (14-day actual, 50 invited) = 60 invites; 0 seats left, so 0");
    expect(html).toContain("0 / 0");
    expect(html).toContain(">empty<");
    expect(html).not.toMatch(NOT_NUMBER);
  });
  it("long labels wrap instead of widening the page", () => {
    const long = "Live Meta campaign for night-shift voice agents across three branches with a very long name".repeat(2);
    const d = planDay({ date: "2026-10-09", driveId: null, target: 20, capacity: 60, streams: [{ ...OCT, label: long }] });
    const html = view({ plan: planOf([d]) });
    expect(html).toContain(long);
    expect(html).toContain(`aria-label="Daily quota for ${long}"`);
    expect(html).toContain("break-words");
    expect(html).toContain("overflow-x-auto");
  });
  it("what-if panel with no open stream says so", () => {
    const closed = planDay({ date: "2026-10-09", driveId: null, target: 20, capacity: 60, streams: [{ ...POOL, covers: false }] });
    expect(renderToStaticMarkup(<WhatIfPanel day={closed} />)).toContain("No stream is open on this day.");
  });
  it("calendar renders nothing without days", () => {
    expect(renderToStaticMarkup(<PlanCalendar plan={{ days: [], calendar: [] }} />)).toBe("");
  });
  it("checklist result region: dry-run preview per stream, real run, and a 409 verbatim", () => {
    const base = { checklist: NORMAL.checklist, date: "2026-10-09", busy: null, onPreview: () => undefined, onPlanNow: () => undefined };
    const dry = renderToStaticMarkup(<D1ChecklistView {...base} run={{ dryRun: true, result: preview, error: null }} />);
    expect(dry).toContain("Preview (nothing saved)");
    expect(dry).toContain("would line up 15 (already 0, quota 15)");
    const skipped = { ...preview, drive: "exists" as const, streams: [{ ...preview.streams[0], wouldLine: undefined, skipped: "origin launch not found" }] };
    expect(renderToStaticMarkup(<D1ChecklistView {...base} run={{ dryRun: false, result: skipped, error: null }} />)).toContain("Skipped: origin launch not found");
    const conflict = renderToStaticMarkup(<D1ChecklistView {...base} run={{ dryRun: false, result: null, error: "No open stream covers that day" }} />);
    expect(conflict).toContain("Plan now failed: No open stream covers that day");
    const busy = renderToStaticMarkup(<D1ChecklistView {...base} busy="plan" run={null} />);
    expect(busy).toContain("Planning…");
    expect(busy.match(/disabled=""/g)).toHaveLength(2);
  });
  it("the page mounts the Plan section in the always-rendered slot", () => {
    const parts = sectionParts("plan", null, null, undefined, <p>PLAN-SECTION</p>);
    expect(parts.gated).toBeNull();
    expect(renderToStaticMarkup(<>{parts.always}</>)).toBe("<p>PLAN-SECTION</p>");
  });
});

describe("calibrated show rates in the Plan section", () => {
  const WED = input({ streamId: "s1", label: "Oct ads", lined: 20, rate: rate("s1", 0.4, "actual_weekday", 30, 2) });
  const THIN = input({ streamId: "s2", sourceType: "he", label: "Pool: ATS history", lined: 10, rate: { ...rate("s2", 0.25, "plan_default"), sourceType: "he" }, poolRemaining: 3 });
  const dayC = planDay({ date: "2026-10-14", driveId: "d1", target: 20, capacity: 60, streams: [WED, THIN] });
  const calibrated = planOf([dayC], { showRateMode: "calibrated", checklist: { date: "2026-10-14", preview: null, items: [] } });

  it("labels the three bases", () => {
    expect(basisLabel("actual_weekday", 2)).toBe("Same weekday, 14-day actual");
    expect(basisLabel("actual")).toBe("14-day actual");
    expect(basisLabel("plan_default")).toBe("Plan default");
  });
  it("the weekday reasoning names the day", () => {
    expect(dayC.streams.find((s) => s.streamId === "s1")!.reasoning).toContain("(Wed 14-day actual, 30 invited)");
  });
  it("rows say not enough history only when calibration is on", () => {
    expect(streamRows(dayC, true).find((r) => r.streamId === "s2")).toMatchObject({ basis: "Plan default", notEnough: true });
    expect(streamRows(dayC).find((r) => r.streamId === "s2")).toMatchObject({ basis: "Plan default", notEnough: false });
    expect(streamRows(dayC, true).find((r) => r.streamId === "s1")).toMatchObject({ rate: "40%", basis: "Same weekday, 14-day actual", notEnough: false });
  });
  it("markup shows the calibration line, the basis and the honest thin-history state", () => {
    const html = view({ plan: calibrated, checklist: null });
    expect(html).toContain("Show rates are calibrated from the last 14 days (kept between 5% and 95%)");
    expect(html).toContain("(Same weekday, 14-day actual)");
    expect(html).toContain("Plan default (not enough history)");
    expect(html).not.toMatch(NOT_NUMBER);
  });
  it("a fixed plan shows neither the line nor the new labels", () => {
    const html = view({ plan: NORMAL });
    expect(html).not.toContain("calibrated from the last 14 days");
    expect(html).not.toContain("Same weekday");
    expect(html).not.toContain("not enough history");
    expect(html).toContain("(14-day actual)");
  });
});
