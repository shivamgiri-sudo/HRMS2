/** Stream actions: pure model tables and static markup (node env). Clicks, keyboard and focus need the live check. */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/hrmsApi", () => ({ hrmsApi: { get: vi.fn(() => new Promise(() => undefined)), post: vi.fn(() => new Promise(() => undefined)) } }));

import {
  FORBIDDEN_TEXT, GENERIC_TEXT, GONE_CREATE_TEXT, GONE_TEXT, OVERRIDE_HINT, STALE_TEXT, actionErrors, canOverride, changeBody, confirmText, createBody,
  confirmView, createErrors, defaultCreateForm, dialogEscapeAllowed, errorText, presetOptions, menuItems, originOptions, parseCount, parseReadiness, previewEnd, problemRows, rowStreams, successText,
  type CreateForm, type MenuAction,
} from "../command/streamActionsModel";
import { previewWindowChange } from "../command/streamWindowClient";
import { StreamMenu, ConfirmBody, RowStreamActionsView } from "../command/StreamActions";
import { CreateStreamForm, type CreateFormText } from "../command/CreateStreamDialog";
import DriveGroupRow from "../command/DriveGroupRow";
import DriveTypeSection from "../command/DriveTypeSection";
import { requisitionCodeOf, sectionParts } from "../command/DriveCommandCenter";
import { createInFlightGuard } from "../command/inFlight";
import { requisitionOptions } from "../command/commandData";
import type { DriveGroup, ReadinessProblem, StreamStatus, StreamView } from "../command/driveCommandTypes";

const TODAY = "2026-10-08"; // Thursday
const R = "0a1b2c3d-0000-4000-8000-000000000001";
const D = "0a1b2c3d-0000-4000-8000-0000000000d1";
// Mon 5 Oct .. Sat 10 Oct (6 working days)
const stream = (over: Partial<StreamView> = {}): StreamView => ({
  id: "s1", requisitionId: R, branchName: "Pune", sourceType: "meta_live", originId: "c1", originLabel: "Oct ads", openFrom: "2026-10-05", openDays: 6,
  dailyInvites: null, status: "open", closedReason: null, createdBy: null, createdAt: "2026-10-01T00:00:00Z", add: [], skip: [], version: 2,
  window: { from: "2026-10-05", to: "2026-10-10", dayIndex: 4, days: 6, state: "running" }, label: "day 4 of 6, ends Sat 10 Oct", warnings: [], ...over,
});
const apiError = (status: number, message: string, payload?: unknown) => Object.assign(new Error(message), { name: "HrmsApiError", status, payload });
const NOT_READY = apiError(409, "The requisition is not ready", { success: false, message: "The requisition is not ready", problems: [{ code: "no_branch_address", severity: "blocking", message: "Add the branch address in Branch master" }] });

describe("menuItems", () => {
  const enabled = (st: StreamStatus) => menuItems(stream({ status: st })).filter((i) => i.enabled).map((i) => i.action);
  it("a closed stream enables only Reopen", () => {
    expect(enabled("closed")).toEqual(["reopen"]);
  });
  it("draft / open / paused enable every change except Reopen; pause only while open, resume only from draft or paused", () => {
    const changes: MenuAction[] = ["extend1", "extend3", "extend7", "extend_to", "add_day", "skip_day", "shorten"];
    expect(enabled("open")).toEqual([...changes, "pause", "close"]);
    expect(enabled("paused")).toEqual([...changes, "resume", "close"]);
    expect(enabled("draft")).toEqual([...changes, "resume", "close"]);
    expect(menuItems(stream({ status: "draft" })).find((i) => i.action === "resume")?.label).toBe("Open stream");
    expect(menuItems(stream()).map((i) => i.label).slice(0, 6)).toEqual(["+1 day", "+3 days", "+7 days", "To a date…", "Add a day…", "Skip a day…"]);
  });
});

describe("changeBody", () => {
  const cases: Array<[MenuAction, Parameters<typeof changeBody>[1], unknown]> = [
    ["extend1", {}, { action: "extend", days: 1 }],
    ["extend3", {}, { action: "extend", days: 3 }],
    ["extend7", {}, { action: "extend", days: 7 }],
    ["extend_to", { date: "2026-10-20" }, { action: "extend_to", toDate: "2026-10-20" }],
    ["shorten", { date: "2026-10-09" }, { action: "shorten", toDate: "2026-10-09" }],
    ["add_day", { date: "2026-10-11" }, { action: "add_day", day: "2026-10-11" }],
    ["skip_day", { date: "2026-10-12" }, { action: "skip_day", day: "2026-10-12" }],
    ["pause", {}, { action: "pause" }],
    ["resume", {}, { action: "open" }],
    ["close", { reason: "  filled by walk-ins  " }, { action: "close", reason: "filled by walk-ins" }],
    ["close", { reason: "   " }, { action: "close" }],
    ["reopen", { ended: true }, { action: "reopen", days: 3 }],
    ["reopen", { ended: true, days: 5 }, { action: "reopen", days: 5 }],
    ["reopen", {}, { action: "reopen" }],
  ];
  it.each(cases)("%s %j", (a, o, want) => expect(changeBody(a, o)).toEqual(want));
});

describe("window preview mirrors the server's working-day rule", () => {
  it("extend1 from Sat 10 Oct lands on Mon 12 Oct (Sunday skipped)", () => {
    expect(previewEnd("extend1", stream())).toBe("2026-10-12");
    expect(confirmText("extend1", stream()).body).toContain("Mon 12 Oct");
    expect(confirmText("extend1", stream())).toEqual({
      title: "Extend Oct ads by 1 day?", body: "The last day moves from Sat 10 Oct to Mon 12 Oct. Already invited people are not invited again.", confirm: "Extend",
    });
    expect(confirmText("extend3", stream()).title).toBe("Extend Oct ads by 3 days?");
  });
  it("close, shorten and reopen wording", () => {
    expect(confirmText("close", stream())).toEqual({ title: "Close Oct ads now?", body: "Future days stop being planned. Days that already have a drive keep it until you close that drive.", confirm: "Close stream" });
    expect(confirmText("shorten", stream(), { date: "2026-10-09" }).body).toContain("from Sat 10 Oct to Fri 9 Oct");
    const ended = stream({ status: "closed", openFrom: "2026-09-28", openDays: 6, window: { from: "2026-09-28", to: "2026-10-03", dayIndex: 6, days: 6, state: "ended" } });
    expect(confirmText("reopen", ended, { ended: true, days: 3 }).body).toBe("The window ended on Sat 3 Oct. Reopening adds 3 days, so the last day becomes Wed 7 Oct. The requisition is checked for readiness first.");
  });
  it("matches the server's change table", () => {
    const w = { openFrom: "2026-10-05", openDays: 6, add: [], skip: [] };
    expect(previewWindowChange(w, { kind: "add_day", day: "2026-10-11" }, TODAY)).toMatchObject({ ok: true, end: "2026-10-11", next: { openDays: 7, add: ["2026-10-11"] } });
    expect(previewWindowChange(w, { kind: "skip_day", day: "2026-10-09" }, TODAY)).toMatchObject({ ok: true, end: "2026-10-10", next: { openDays: 5, skip: ["2026-10-09"] } });
    expect(previewWindowChange(w, { kind: "extend", days: 61 }, TODAY)).toMatchObject({ ok: false, message: "Days must be a whole number from 1 to 60" });
    expect(previewWindowChange({ ...w, openDays: 118 }, { kind: "extend", days: 3 }, TODAY)).toMatchObject({ ok: false, message: "A stream can be open for at most 120 days" });
    expect(previewWindowChange(w, { kind: "shorten", date: "2026-10-07" }, TODAY)).toMatchObject({ ok: false, message: "The new last day cannot be before today" });
    expect(previewWindowChange(w, { kind: "skip_day", day: "2026-10-11" }, TODAY)).toMatchObject({ ok: false, message: "That day is not inside the window" });
    expect(previewWindowChange(w, { kind: "extend_to", date: "2026-10-10" }, TODAY)).toMatchObject({ ok: false, message: "Nothing to change" });
  });
});

describe("actionErrors (client pre-validation)", () => {
  it.each([
    ["extend_to", {}, ["Pick a date"]],
    ["extend_to", { date: "2026-02-30" }, ["Pick a valid date"]],
    ["add_day", { date: "2026-10-07" }, ["The new last day cannot be before today"]],
    ["skip_day", { date: "2026-10-11" }, ["That day is not inside the window"]],
    ["extend3", { reason: "x".repeat(256) }, ["Reason must be at most 255 characters"]],
    ["extend_to", { date: "2026-10-20" }, []],
  ] as Array<[MenuAction, Parameters<typeof actionErrors>[2], string[]]>)("%s %j", (a, o, want) => expect(actionErrors(a, stream(), o, TODAY)).toEqual(want));
  it("status rules and the 120-day cap", () => {
    expect(actionErrors("extend1", stream({ status: "closed" }), {}, TODAY)).toEqual(["Reopen the stream first"]);
    expect(actionErrors("pause", stream({ status: "paused" }), {}, TODAY)).toEqual(["Not allowed while the stream is paused"]);
    expect(actionErrors("extend7", stream({ openDays: 115 }), {}, TODAY)).toEqual(["A stream can be open for at most 120 days"]);
    const ended = stream({ status: "closed", openFrom: "2026-09-28", window: { from: "2026-09-28", to: "2026-10-03", dayIndex: 6, days: 6, state: "ended" } });
    expect(actionErrors("reopen", ended, { ended: true, days: 1 }, TODAY)).toEqual(["Extend the window when reopening"]);
    expect(actionErrors("reopen", ended, { ended: true, days: 0 }, TODAY)).toEqual(["Days must be a whole number from 1 to 60"]);
    expect(actionErrors("reopen", ended, { ended: true, days: 3 }, TODAY)).toEqual(["Extend the window when reopening"]); // ends Wed 7 Oct
    expect(actionErrors("reopen", ended, { ended: true, days: 4 }, TODAY)).toEqual([]);
  });
  it("success lines come from the server's stream", () => {
    const after = stream({ openDays: 9, window: { from: "2026-10-05", to: "2026-10-14", dayIndex: 4, days: 9, state: "running" } });
    expect(successText("extend3", after, true)).toBe("Stream extended to Wed 14 Oct");
    expect(successText("extend3", after, false)).toBe("Nothing changed");
    expect(successText("close", after, true)).toBe("Stream closed");
  });
});

describe("errorText", () => {
  it("409 not ready: server message verbatim and its problems", () => {
    const r = errorText(NOT_READY);
    expect(r.text).toBe("The requisition is not ready");
    expect(r.problems).toEqual([{ code: "no_branch_address", severity: "blocking", message: "Add the branch address in Branch master" }]);
    expect(errorText(NOT_READY, { overrideAsked: true }).text).toBe(`The requisition is not ready. ${OVERRIDE_HINT}`);
  });
  it.each([
    [apiError(409, "The stream changed meanwhile; reload and try again"), STALE_TEXT],
    [apiError(409, "A stream for this source already exists; reopen or extend it"), "A stream for this source already exists; reopen or extend it"],
    [apiError(400, "A stream can be open for at most 120 days"), "A stream can be open for at most 120 days"],
    [apiError(403, "Access denied. Required: super_admin or admin or hr"), FORBIDDEN_TEXT],
    [apiError(404, "Stream not found"), GONE_TEXT],
    [apiError(500, "Could not change the stream"), GENERIC_TEXT],
    [apiError(502, "<html>bad gateway</html>"), GENERIC_TEXT],
    [new TypeError("Failed to fetch"), GENERIC_TEXT],
    [null, GENERIC_TEXT],
    ["boom", GENERIC_TEXT],
  ])("%#", (e, want) => expect(errorText(e).text).toBe(want));
  it("404 on create names the requisition or source; malformed problems are dropped", () => {
    expect(errorText(apiError(404, "Source not found"), { what: "create" }).text).toBe("Source not found");
    expect(errorText(apiError(404, ""), { what: "create" }).text).toBe(GONE_CREATE_TEXT);
    expect(errorText(apiError(409, "Link this campaign to the requisition first"), { what: "create" }).text).toBe("Link this campaign to the requisition first");
    expect(errorText(apiError(409, "That campaign is linked to another requisition"), { what: "create" }).text).toBe("That campaign is linked to another requisition");
    expect(errorText(apiError(409, "x", { problems: [{ code: 1 }, null, { code: "no_template", severity: "weird", message: "m" }] })).problems).toEqual([]);
  });
});

describe("create form", () => {
  const ok: CreateForm = { ...defaultCreateForm(TODAY, R, "meta_live"), originId: "c1" };
  it("defaults: start tomorrow IST, 7 days, plan-default invites, draft", () => {
    expect(defaultCreateForm(TODAY, R, "he")).toEqual({ requisitionId: R, sourceType: "he", originId: "pool", openFrom: "2026-10-09", openDays: 7, dailyInvites: null, open: false, override: false, reason: "" });
  });
  it("createErrors", () => {
    expect(createErrors(ok, TODAY)).toEqual([]);
    expect(createErrors({ ...ok, openDays: 0, openFrom: "2026-10-07" }, TODAY)).toEqual(["Start date cannot be before today", "Days must be a whole number from 1 to 60"]);
    expect(createErrors({ ...ok, requisitionId: "", originId: "" }, TODAY)).toEqual(["Pick a requisition", "Pick a Live Meta campaign"]);
    expect(createErrors({ ...ok, openDays: 61, dailyInvites: 501 }, TODAY)).toEqual(["Days must be a whole number from 1 to 60", "Daily invites must be a whole number from 1 to 500"]);
    expect(createErrors({ ...ok, openDays: 2.5, dailyInvites: Number.NaN }, TODAY)).toEqual(["Days must be a whole number from 1 to 60", "Daily invites must be a whole number from 1 to 500"]);
    expect(createErrors({ ...ok, openFrom: "2026-11-31" }, TODAY)).toEqual(["Pick a valid start date"]);
    expect(createErrors({ ...ok, sourceType: "meta_old", originId: "not-a-drive" }, TODAY)).toEqual(["That is not a valid launch drive id"]);
    expect(createErrors({ ...ok, sourceType: "meta_old", originId: D }, TODAY)).toEqual([]);
  });
  it("opening now with a blocking problem needs an allowed override", () => {
    const p: ReadinessProblem[] = [{ code: "no_branch_address", severity: "blocking", message: "m" }];
    expect(createErrors({ ...ok, open: true }, TODAY, p, ["requisition_not_open", "no_headcount"])).toHaveLength(1);
    expect(createErrors({ ...ok, open: true, override: true }, TODAY, p, ["requisition_not_open", "no_headcount"])).toEqual([]);
    expect(createErrors({ ...ok, open: false }, TODAY, p, [])).toEqual([]);
  });
  it("createBody sends override only when opening and ticked", () => {
    expect(createBody({ ...ok, dailyInvites: 40, reason: " r " })).toEqual({ requisitionId: R, sourceType: "meta_live", originId: "c1", openFrom: "2026-10-09", openDays: 7, dailyInvites: 40, open: false, reason: "r" });
    const never = ["requisition_not_open", "no_headcount"];
    const overridable: ReadinessProblem[] = [{ code: "no_branch_address", severity: "blocking", message: "m" }];
    expect(createBody({ ...ok, open: true, override: true }, overridable, never)).toMatchObject({ open: true, override: true });
    expect(createBody({ ...ok, open: false, override: true }, overridable, never)).not.toHaveProperty("override");
    // defence in depth: never sent unless the readiness read allows it
    expect(createBody({ ...ok, open: true, override: true })).not.toHaveProperty("override");
    expect(createBody({ ...ok, open: true, override: true }, [...overridable, { code: "no_headcount", severity: "blocking", message: "m" }], never)).not.toHaveProperty("override");
  });
  it("parseCount", () => {
    expect(parseCount("")).toBeNull();
    expect(parseCount(" 12 ")).toBe(12);
    expect(parseCount("1e2")).toBeNaN();
    expect(parseCount("-3")).toBeNaN();
  });
  it("originOptions", () => {
    const campaigns = [{ campaignId: "c1", campaignName: "Oct ads", requisitionCode: "RQ-1" }, { campaignId: "c2", campaignName: "Other", requisitionCode: "RQ-2" }];
    expect(originOptions("meta_live", { code: "RQ-1" }, campaigns, [])).toEqual([{ id: "c1", label: "Oct ads" }]);
    const launches = [
      { driveId: "d1", label: "Sept rerun", requisition: "RQ-1", kind: "campaign", date: "2026-09-21" },
      { driveId: "d2", label: "", requisition: "RQ-1", kind: "batch", date: "2026-09-22" },
      { driveId: "d3", label: "Pool", requisition: "RQ-1", kind: "pool" },
      { driveId: "d4", label: "Other", requisition: "RQ-2", kind: "campaign" },
    ];
    expect(originOptions("meta_old", { code: "RQ-1" }, [], launches)).toEqual([{ id: "d1", label: "Sept rerun (Mon 21 Sep)" }, { id: "d2", label: "Re-run Tue 22 Sep" }]);
    expect(originOptions("he", { code: "" }, [], [])).toEqual([{ id: "pool", label: "Pool: ATS history" }]);
    // prod shape: Meta drives carry kind "meta" and no run_label
    const meta = [
      { driveId: "m1", label: "", requisition: "RQ-1", kind: "meta", date: "2026-09-21", lined: 12 },
      { driveId: "m2", label: "", requisition: "RQ-1", kind: "meta", date: "2026-09-22", lined: 1 },
      { driveId: "m3", label: "", requisition: "RQ-1", kind: "meta", date: "2026-09-23" },
      { driveId: "x1", label: "Odd", requisition: "RQ-1", kind: "something_new", date: "2026-09-24" },
      { driveId: "p1", label: "", requisition: "RQ-1", kind: "pool", date: "2026-09-25" },
      { driveId: "m9", label: "", requisition: "RQ-2", kind: "meta", date: "2026-09-21", lined: 4 },
    ];
    expect(originOptions("meta_old", { code: "RQ-1" }, [], meta)).toEqual([
      { id: "m1", label: "Meta drive Mon 21 Sep (12 people)" }, { id: "m2", label: "Meta drive Tue 22 Sep (1 person)" },
      { id: "m3", label: "Meta drive Wed 23 Sep" }, { id: "x1", label: "Odd (Thu 24 Sep)" },
    ]);
    expect(originOptions("meta_live", { code: "" }, campaigns, [])).toEqual([]);
  });
  it("createErrors names the source type and why when no source is chosen", () => {
    const live = { ...ok, originId: "" };
    expect(createErrors(live, TODAY, [], [], 0)).toEqual(["No campaign is linked to this requisition"]);
    expect(createErrors(live, TODAY, [], [], 2)).toEqual(["Pick a Live Meta campaign"]);
    const old = { ...ok, sourceType: "meta_old" as const, originId: "" };
    expect(createErrors(old, TODAY, [], [], 0)).toEqual(["No old Meta drive exists for this requisition yet"]);
    expect(createErrors(old, TODAY, [], [], 3)).toEqual(["Pick an old Meta drive"]);
    expect(createErrors({ ...old, originId: D }, TODAY, [], [], 0)).toEqual([]);
  });
  it("canOverride: only when every blocking problem is overridable", () => {
    const never = ["requisition_not_open", "no_headcount"];
    expect(canOverride([{ code: "requisition_not_open", severity: "blocking", message: "m" }, { code: "no_branch_address", severity: "blocking", message: "m" }], never)).toBe(false);
    expect(canOverride([{ code: "no_headcount", severity: "blocking", message: "m" }], never)).toBe(false);
    expect(canOverride([{ code: "no_branch_address", severity: "blocking", message: "m" }, { code: "no_bmi_link", severity: "warning", message: "w" }], never)).toBe(true);
    expect(canOverride([{ code: "no_bmi_link", severity: "warning", message: "w" }], never)).toBe(false);
  });
  it("parseReadiness and problemRows (blocking first, each with its word)", () => {
    expect(parseReadiness(null)).toBeNull();
    expect(parseReadiness({ problems: "x" })).toBeNull();
    const r = parseReadiness({ problems: [{ code: "no_bmi_link", severity: "warning", message: "w" }, { code: "no_template", severity: "blocking", message: "b" }], neverOverride: ["no_headcount", 3] });
    expect(r?.neverOverride).toEqual(["no_headcount"]);
    expect(problemRows(r!.problems).map((p) => `${p.word}:${p.code}`)).toEqual(["Blocking:no_template", "Warning:no_bmi_link"]);
  });
  it("rowStreams keeps the row's type, live first", () => {
    const list = [stream({ id: "a", status: "closed", originLabel: "A" }), stream({ id: "b", sourceType: "meta_old" }), stream({ id: "c", status: "paused", originLabel: "C" }), stream({ id: "d", originLabel: "D" })];
    expect(rowStreams(list, "meta_live").map((s) => s.id)).toEqual(["d", "c", "a"]);
    expect(rowStreams("nope", "he")).toEqual([]);
  });
});

describe("static markup", () => {
  it("closed menu: Extend button with aria-haspopup=menu, aria-expanded=false and no list", () => {
    const html = renderToStaticMarkup(<StreamMenu stream={stream()} onPick={() => undefined} />);
    expect(html).toMatch(/<button[^>]*aria-haspopup="menu"[^>]*>/);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Extend");
    expect(html).not.toContain('role="menu"');
  });
  it("open menu: role=menu with menuitem buttons for the enabled actions only", () => {
    const html = renderToStaticMarkup(<StreamMenu stream={stream()} onPick={() => undefined} initiallyOpen />);
    expect(html).toContain('aria-expanded="true"');
    expect(html).toMatch(/aria-controls="[^"]+"/);
    expect(html).toContain('role="menu"');
    expect(html.match(/role="menuitem"/g)).toHaveLength(9);
    expect(html).toContain("+3 days");
    expect(html).not.toContain("Reopen");
    const closed = renderToStaticMarkup(<StreamMenu stream={stream({ status: "closed" })} onPick={() => undefined} initiallyOpen />);
    expect(closed.match(/role="menuitem"/g)).toHaveLength(1);
    expect(closed).toContain("Reopen");
  });
  it("confirm body: date field for date actions, reason field, busy, and the 409 problems", () => {
    const html = renderToStaticMarkup(<ConfirmBody action="skip_day" stream={stream()} input={{ date: "" }} today={TODAY} errors={["Pick a date"]} showErrors serverError={errorText(NOT_READY)} busy={false} onInput={() => undefined} idPrefix="t" />);
    expect(html).toContain('type="date"');
    expect(html).toContain('min="2026-10-08"');
    expect(html).toContain("Reason (optional)");
    expect(html).toContain("Pick a date");
    expect(html).toContain("The requisition is not ready");
    expect(html).toContain("Blocking");
    expect(html).toContain("Add the branch address in Branch master");
    expect(html).toContain('role="alert"');
    const extend = renderToStaticMarkup(<ConfirmBody action="extend3" stream={stream()} input={{}} today={TODAY} errors={[]} showErrors={false} serverError={null} busy onInput={() => undefined} idPrefix="t" />);
    expect(extend).not.toContain('type="date"');
    expect(extend).toContain("disabled");
  });
  it("row actions view: each stream labelled with its status word, a status region and an Open a stream button", () => {
    const html = renderToStaticMarkup(<RowStreamActionsView streams={[stream(), stream({ id: "s2", status: "closed", originLabel: "Sept ads" })]} today={TODAY} loading={false} error={null} note="Stream extended to Wed 14 Oct" onRetry={() => undefined} onDone={() => undefined} onCreate={() => undefined} />);
    expect(html).toContain('role="status"');
    expect(html).toContain("Stream extended to Wed 14 Oct");
    expect(html).toContain('aria-label="Oct ads"');
    expect(html).toContain("Open");
    expect(html).toContain("Closed");
    expect(html).toContain("Open a stream");
    expect(html.match(/aria-haspopup="menu"/g)).toHaveLength(2);
    const empty = renderToStaticMarkup(<RowStreamActionsView streams={[]} today={TODAY} loading={false} error={null} note={null} onRetry={() => undefined} onDone={() => undefined} onCreate={() => undefined} />);
    expect(empty).toContain("No stream of this type yet");
  });

  const formText = (over: Partial<CreateFormText> = {}): CreateFormText => ({ requisitionId: R, sourceType: "meta_live", originId: "c1", openFrom: "2026-10-09", openDays: "7", dailyInvites: "", open: true, override: false, reason: "", ...over });
  const baseProps = {
    requisitions: [{ id: R, label: "RQ-1 - Agent", branch: "Pune", code: "RQ-1" }], lockRequisition: false, today: TODAY,
    origins: [{ id: "c1", label: "Oct ads" }], originsLoading: false, originsError: null,
    readiness: { loading: false, error: null, problems: [] as ReadinessProblem[], neverOverride: ["requisition_not_open", "no_headcount"] },
    errors: [] as string[], showErrors: false, serverError: null, busy: false, onChange: () => undefined, idPrefix: "c",
  };
  it("create form with blocking + warning readiness problems: icon words, messages and the override box", () => {
    const problems: ReadinessProblem[] = [
      { code: "no_bmi_link", severity: "warning", message: "No BookMyInterview link" },
      { code: "no_branch_address", severity: "blocking", message: "Add the branch address in Branch master" },
    ];
    const html = renderToStaticMarkup(<CreateStreamForm {...baseProps} form={formText()} readiness={{ ...baseProps.readiness, problems }} />);
    expect(html).toContain("Blocking");
    expect(html).toContain("Add the branch address in Branch master");
    expect(html).toContain("Warning");
    expect(html.indexOf("Blocking")).toBeLessThan(html.indexOf("Warning"));
    expect(html).toContain("Override (admins only)");
    for (const t of ["Live Meta", "Old Meta data", "Hiring Engine"]) expect(html).toContain(t);
    expect(html.match(/type="radio"/g)).toHaveLength(3);
    expect(html).toContain('min="2026-10-08"');
    expect(html).toContain("Daily invites");
    expect(html).toContain("Open now");
  });
  it("no override box when a blocking problem can never be overridden; 409 server error rendered", () => {
    const problems: ReadinessProblem[] = [{ code: "no_headcount", severity: "blocking", message: "No open positions left on this requisition" }, { code: "no_branch_address", severity: "blocking", message: "Add the branch address" }];
    const html = renderToStaticMarkup(<CreateStreamForm {...baseProps} form={formText()} readiness={{ ...baseProps.readiness, problems }} serverError={errorText(NOT_READY)} />);
    expect(html).not.toContain("Override (admins only)");
    expect(html).toContain("No open positions left on this requisition");
    expect(html).toContain("The requisition is not ready");
  });
  it("busy label, no-origin message with typed launch id fallback, readiness loading", () => {
    const html = renderToStaticMarkup(<CreateStreamForm {...baseProps} form={formText({ sourceType: "meta_old", originId: "" })} origins={[]} readiness={{ ...baseProps.readiness, loading: true }} busy />);
    expect(html).toContain("Checking readiness");
    expect(html).toContain("Launch drive id");
    expect(html).toContain("Creating…");
    const live = renderToStaticMarkup(<CreateStreamForm {...baseProps} form={formText({ originId: "" })} origins={[]} errors={["No campaign is linked to this requisition"]} showErrors />);
    expect(live).toContain("No campaign is linked to this requisition");
    expect(live).toContain("Link a campaign to this requisition in Meta Campaigns first");
  });
  it("live empty state lists the active campaigns with the requisition each is linked to", () => {
    const campaigns = [
      { campaignId: "c2", campaignName: "Delhi ads", requisitionCode: "RQ-2", status: "active" },
      { campaignId: "c3", campaignName: "Loose ads", requisitionCode: null, status: "active" },
      { campaignId: "c4", campaignName: "Old ads", requisitionCode: "RQ-9", status: "paused" },
    ];
    const html = renderToStaticMarkup(<CreateStreamForm {...baseProps} form={formText({ originId: "" })} origins={[]} campaigns={campaigns} />);
    expect(html).toContain("No campaign is linked to this requisition (RQ-1)");
    expect(html).toContain("Delhi ads");
    expect(html).toContain("linked to RQ-2");
    expect(html).toContain("Loose ads");
    expect(html).toContain("not linked to any requisition");
    expect(html).not.toContain("Old ads");
    expect(html).toContain("Link a campaign to this requisition in Meta Campaigns first");
    expect(html).not.toContain("<select id=\"c-origin\"");
  });
  it("old Meta empty state says no drive exists yet and keeps the typed id as last resort; a listed drive shows a select", () => {
    const empty = renderToStaticMarkup(<CreateStreamForm {...baseProps} form={formText({ sourceType: "meta_old", originId: "" })} origins={[]} />);
    expect(empty).toContain("No old Meta drive exists for this requisition yet");
    expect(empty).toContain("Launch drive id");
    const some = renderToStaticMarkup(<CreateStreamForm {...baseProps} form={formText({ sourceType: "meta_old", originId: "" })} origins={[{ id: D, label: "Meta drive Mon 21 Sep (12 people)" }]} />);
    expect(some).toContain("Meta drive Mon 21 Sep (12 people)");
    expect(some).not.toContain("Launch drive id");
  });
});

describe("wiring", () => {
  const totals = { wanted: 20, lined: 30, invited: 25, confirmed: 12, arrived: 6, noShow: 3, declined: 1, showRate: 0.5 };
  const group: DriveGroup = {
    requisitionId: R, branch: "Pune", requisition: "RQ-1", role: "Agent", sourceType: "meta_live", types: ["meta_live"], streamIds: ["s1"],
    window: { from: "2026-10-05", to: "2026-10-10", dayIndex: 4, days: 6 }, totals, days: [],
  };
  const actions = { requisitions: [], requisitionId: null, onChanged: () => undefined };
  it("the expanded row passes the detail reload to a function slot (extension history stays read-only)", () => {
    const html = renderToStaticMarkup(<DriveGroupRow group={group} today={TODAY} initiallyOpen>{(reload) => <span>slot {typeof reload}</span>}</DriveGroupRow>);
    expect(html).toContain("slot function");
  });
  it("a section with actions has an Open a stream button; without (Master card) it stays read-only", () => {
    expect(renderToStaticMarkup(<DriveTypeSection type="meta_live" groups={[group]} today={TODAY} title="Live" actions={actions} />)).toContain("Open a stream");
    expect(renderToStaticMarkup(<DriveTypeSection type="meta_live" groups={[group]} today={TODAY} title="Live" />)).not.toContain("Open a stream");
  });
  it("sectionParts hands the actions to the type sections", () => {
    const analytics = { groups: [group] } as unknown as Parameters<typeof sectionParts>[1];
    for (const s of ["live", "old", "he"] as const) {
      const p = sectionParts(s, analytics, null, actions);
      expect(renderToStaticMarkup(<>{p.gated}</>)).toContain("Open a stream");
    }
  });
  it("requisition options carry the code the origin filter matches on", () => {
    expect(requisitionOptions([{ id: R, requisition_code: "RQ-1", designation_name: "Agent" }, { id: "x" }]).map((o) => o.code)).toEqual(["RQ-1", ""]);
  });
});

describe("fix round", () => {
  it("in-flight guard: a second call while the first is pending is ignored; the guard frees after success and failure", async () => {
    const g = createInFlightGuard();
    let release: (v: string) => void = () => undefined;
    let calls = 0;
    const first = g.run(() => { calls += 1; return new Promise<string>((r) => { release = r; }); });
    expect(g.busy).toBe(true);
    const second = await g.run(async () => { calls += 1; return "again"; });
    expect(second).toBeUndefined();
    expect(calls).toBe(1);
    release("done");
    expect(await first).toBe("done");
    expect(g.busy).toBe(false);
    await expect(g.run(async () => { throw new Error("x"); })).rejects.toThrow("x");
    expect(g.busy).toBe(false);
    expect(await g.run(async () => 7)).toBe(7);
  });
  it("confirmation words and checks come from the fresh copy; not ready until it arrives", () => {
    const stale = stream();
    const fresh = stream({ openDays: 9, version: 3, window: { from: "2026-10-05", to: "2026-10-14", dayIndex: 4, days: 9, state: "running" } });
    const before = confirmView("extend3", stale, null, {}, TODAY);
    expect(before.ready).toBe(false);
    expect(before.text.body).toContain("from Sat 10 Oct to Wed 14 Oct");
    const after = confirmView("extend3", stale, fresh, {}, TODAY);
    expect(after.ready).toBe(true);
    expect(after.stream).toBe(fresh);
    expect(after.text.body).toContain("from Wed 14 Oct to Sat 17 Oct");
    // a stream closed meanwhile: the change is refused on the client too
    expect(confirmView("extend3", stale, stream({ status: "closed" }), {}, TODAY).errors).toEqual(["Reopen the stream first"]);
  });
  it("Escape inside StreamDialog belongs to the open menu", () => {
    expect(dialogEscapeAllowed({ menuOpen: true })).toBe(false);
    expect(dialogEscapeAllowed({ menuOpen: false })).toBe(true);
    expect(dialogEscapeAllowed({ menuOpen: false, busy: true })).toBe(false);
  });
  it("the open menu is anchored right and scrolls inside itself", () => {
    const html = renderToStaticMarkup(<StreamMenu stream={stream()} onPick={() => undefined} initiallyOpen />);
    expect(html).toMatch(/role="menu"[^>]*class="absolute right-0 [^"]*max-h-80[^"]*overflow-y-auto/);
    expect(html).not.toContain("left-0");
  });
  it("an insight's requisition missing from the filter options is used and locked, labelled by its code", () => {
    const opts = [{ id: "other", label: "RQ-9 - Agent", branch: "Pune", code: "RQ-9" }];
    expect(presetOptions(opts, { id: R, code: "RQ-1" }, false)).toEqual({ requisitions: [{ id: R, label: "RQ-1", branch: "", code: "RQ-1" }], lock: true });
    expect(presetOptions([{ id: R, label: "RQ-1 - Agent", branch: "Pune", code: "RQ-1" }], { id: R, code: "" }, false).requisitions[0]).toEqual({ id: R, label: "RQ-1 - Agent", branch: "Pune", code: "RQ-1" });
    expect(presetOptions(opts, null, false)).toEqual({ requisitions: opts, lock: false });
    const analytics = { groups: [{ requisitionId: R, requisition: "RQ-1" }], scatter: [] } as unknown as Parameters<typeof requisitionCodeOf>[1];
    expect(requisitionCodeOf(R, analytics, [])).toBe("RQ-1");
    expect(requisitionCodeOf(R, null, [{ id: R, label: "x", branch: "", code: "RQ-7" }])).toBe("RQ-7");
    expect(requisitionCodeOf(R, null, [])).toBe("");
    const locked = renderToStaticMarkup(<CreateStreamForm requisitions={presetOptions([], { id: R, code: "RQ-1" }, false).requisitions} lockRequisition today={TODAY}
      form={{ requisitionId: R, sourceType: "meta_live", originId: "", openFrom: "2026-10-09", openDays: "7", dailyInvites: "", open: false, override: false, reason: "" }}
      origins={[]} originsLoading={false} originsError={null} readiness={{ loading: false, error: null, problems: [], neverOverride: [] }} errors={[]} showErrors={false} serverError={null} busy={false} onChange={() => undefined} idPrefix="p" />);
    expect(locked).toContain(">RQ-1<");
    expect(locked).not.toContain("<select");
    const unknown = renderToStaticMarkup(<CreateStreamForm requisitions={presetOptions([], { id: R, code: "" }, false).requisitions} lockRequisition today={TODAY}
      form={{ requisitionId: R, sourceType: "meta_live", originId: "", openFrom: "2026-10-09", openDays: "7", dailyInvites: "", open: false, override: false, reason: "" }}
      origins={[]} originsLoading={false} originsError={null} readiness={{ loading: false, error: null, problems: [], neverOverride: [] }} errors={[]} showErrors={false} serverError={null} busy={false} onChange={() => undefined} idPrefix="p" />);
    expect(unknown).toContain("code is not known here");
    expect(unknown).not.toContain("No live campaign is linked");
  });
});
