/** Reason chips on the walk-in board: pure model + static markup (node env). Tap behaviour on touch devices and focus after save need the live check. */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/hrmsApi", () => ({ hrmsApi: { get: vi.fn(() => new Promise(() => undefined)), post: vi.fn() } }));

import BoardTab from "../BoardTab";
import OutcomeReasons, { OutcomeReasonsView, type ReasonsViewProps } from "../OutcomeReasons";
import { createInFlightGuard } from "../command/inFlight";
import {
  REASON_CHIPS, NOTE_MAX, groupByDrive, outcomeWord, reasonBody, saveErrorText, savedText, type OutcomeList, type OutcomeRow,
} from "../outcomeReasonsModel";

const row = (o: Partial<OutcomeRow> = {}): OutcomeRow => ({
  matchId: "m1", leadId: "l1", name: "Asha", mobileMasked: "xxxxxx3210", driveId: "d1", driveDate: "2026-10-14", branch: "Pune", requisitionCode: "REQ-1",
  outcome: "no_show", slotAt: "2026-10-14 10:30:00", reason: null, note: null, ...o,
});
const list = (rows: OutcomeRow[], o: Partial<OutcomeList> = {}): OutcomeList => ({ enabled: true, rows, truncated: false, partial: false, ...o });
const noop = () => undefined;
const view = (data: OutcomeList | null, o: Partial<ReasonsViewProps> = {}) =>
  renderToStaticMarkup(<OutcomeReasonsView data={data} loading={false} error={null} onPick={noop} onNoteToggle={noop} onNoteChange={noop} onNoteSave={noop} onRetry={noop} {...o} />);

describe("model", () => {
  it("chips, grouping, words, texts", () => {
    expect(REASON_CHIPS.map((c) => c.label)).toEqual(["Distance", "Got another job", "Salary", "Timing", "Not interested", "Other"]);
    expect(REASON_CHIPS.map((c) => c.code)).toEqual(["distance", "other_job", "salary", "timing", "not_interested", "other"]);
    const g = groupByDrive([row(), row({ matchId: "m2" }), row({ matchId: "m3", driveId: "d2", branch: "Noida", requisitionCode: "REQ-2", driveDate: "2026-10-13" })]);
    expect(g.map((x) => [x.driveId, x.title, x.rows.length])).toEqual([["d1", "Pune · REQ-1 · Wed 14 Oct", 2], ["d2", "Noida · REQ-2 · Tue 13 Oct", 1]]);
    expect([outcomeWord("no_show"), outcomeWord("declined")]).toEqual(["Did not come", "Declined"]);
    expect(savedText("Asha", "Salary", true)).toBe("Changed for Asha to Salary");
    expect(savedText("Asha", "Distance", false)).toBe("Saved for Asha: Distance");
  });
  it("reasonBody omits a blank note and cuts to 140", () => {
    expect(reasonBody("other", "  ")).toEqual({ reason: "other" });
    expect(reasonBody("other", "x".repeat(200)).note).toHaveLength(NOTE_MAX);
    expect(reasonBody("salary", "  hi ")).toEqual({ reason: "salary", note: "hi" });
  });
  it("saveErrorText", () => {
    const m = "Only a no-show or a decline can have a reason";
    expect(saveErrorText({ status: 409, message: m })).toBe(m);
    expect(saveErrorText({ status: 404 })).toBe("This candidate is no longer visible to you; reload");
    expect(saveErrorText({ status: 403 })).toBe("You do not have permission to record reasons");
    expect(saveErrorText(new Error("boom"))).toBe("Could not save; try again");
  });
  it("a guard runs the handler once while the first call is pending", async () => {
    const g = createInFlightGuard();
    let release: () => void = noop;
    const handler = vi.fn(() => new Promise<void>((res) => { release = res; }));
    const first = g.run(handler), second = g.run(handler);
    expect(handler).toHaveBeenCalledTimes(1);
    release();
    await first; await second;
    await g.run(async () => undefined);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(g.busy).toBe(false);
  });
});

describe("markup", () => {
  const two = list([row({ reason: "distance" }), row({ matchId: "m2", name: "Ravi", mobileMasked: "xxxxxx1111", outcome: "declined" })]);
  it("two rows: twelve chips, one pressed beside its word, labelled groups, masked mobiles", () => {
    const h = view(two);
    expect((h.match(/aria-pressed=/g) ?? []).length).toBe(12);
    expect((h.match(/aria-pressed="true"/g) ?? []).length).toBe(1);
    const pressed = h.slice(h.indexOf('aria-pressed="true"'));
    expect(pressed.slice(0, pressed.indexOf("</button>"))).toMatch(/<svg.*<\/svg>Distance$/);
    expect(h).toContain('aria-label="Reason for Asha"');
    expect(h).toContain('aria-label="Reason for Ravi"');
    expect(h).toContain("xxxxxx3210");
    expect(h).not.toMatch(/\d{10}/);
    expect(h).toContain("Did not come or declined (last 3 days)");
    expect(h).toContain("Did not come");
    expect(h).toContain("Declined");
    expect(h).toContain("Pune · REQ-1 · Wed 14 Oct");
  });
  it("every button has a focus ring and a 44px target below sm", () => {
    const buttons = view(two, { noteOpen: { m1: true } }).split("<button").slice(1).map((x) => x.slice(0, x.indexOf(">")));
    expect(buttons.length).toBeGreaterThan(12);
    for (const b of buttons) { expect(b).toContain("focus-visible:ring-2"); expect(b).toContain("min-h-11"); }
  });
  it("note editor: labelled input with maxLength and counter, save disabled until a reason exists", () => {
    const h = view(list([row()]), { noteOpen: { m1: true }, noteText: { m1: "abc" } });
    expect(h).toContain('maxLength="140"');
    expect(h).toContain("3 of 140");
    expect(h).toContain("Note for Asha");
    expect(h).toContain("Pick a reason first");
    expect(view(list([row({ reason: "salary" })]), { noteOpen: { m1: true } })).not.toContain("Pick a reason first");
  });
  it("switch off renders nothing", () => {
    expect(view({ enabled: false, rows: [], truncated: false, partial: false })).toBe("");
  });
  it("empty, loading, error and partial states", () => {
    expect(view(list([]))).toContain("Nobody missed a slot or declined in the last 3 days");
    const sk = view(null, { loading: true });
    expect(sk).toContain('aria-busy="true"');
    expect(sk).toContain("height:160px");
    expect(view(null, { loading: true, expectOn: false })).toBe("");
    const er = view(null, { error: "Request failed" });
    expect(er).toContain('role="alert"');
    expect(er).toContain("Retry");
    expect(view(list([row()], { partial: true }))).toContain("Partial result");
    expect(view(list([row()], { truncated: true }))).toContain("Showing the first 300");
  });
  it("the status line carries the save result", () => {
    expect(view(two, { status: "Saved for Asha: Distance" })).toContain("Saved for Asha: Distance</p>");
  });
  it("the stateful component draws a skeleton first", () => {
    expect(renderToStaticMarkup(<OutcomeReasons />)).toContain('aria-busy="true"');
  });
});

describe("BoardTab", () => {
  it("still renders the existing board header", () => {
    const h = renderToStaticMarkup(<BoardTab />);
    expect(h).toContain("refreshes every 30 seconds");
    expect(h).toContain("Refresh board");
  });
});
