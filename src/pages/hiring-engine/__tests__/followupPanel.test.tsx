/** Follow-up pipeline panel: pure model tables and static markup (node env). Clicks, the confirm dialog and the lazy load need the live check. */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/hrmsApi", () => ({ hrmsApi: { get: vi.fn(() => new Promise(() => undefined)), post: vi.fn() } }));

import FollowupPanel, { FollowupPanelView, type PanelData } from "../command/FollowupPanel";
import {
  OFF_SENTENCE, attentionView, callFileRows, markCalledText, retryOkText, rowName, isFollowupOff, maskedMobile, modeText, reportText, retryErrorText, retryHint, scrubText, showRetry, sourceFunnelRows, stateLabel,
} from "../command/followupPanelModel";
import type { AttentionGroup, AttentionRow, FollowupStatus, RequisitionSources } from "../command/driveCommandTypes";

const row = (over: Partial<AttentionRow> = {}): AttentionRow => ({
  id: "r1", name: "Asha", mobileMasked: "xxxxxx3210", requisitionId: "q1", sourceType: "meta_live", error: "131049", attempts: 2, updatedAt: "2026-10-07T08:30:00.000Z",
  outcomeUnknown: false, retryable: true, retryReason: null, ...over,
});
const status = (over: Partial<FollowupStatus> = {}): FollowupStatus => ({ mode: "live", callFiles: [], report: { running: true, last: null }, ...over });
const data = (over: Partial<PanelData> = {}): PanelData => ({
  status: status(), summary: { mode: "live", data: [{ sourceType: "meta_live", total: 10, open: 6, stopped: 4 }] }, attention: [], sources: null, failed: [], ...over,
});
const noop = () => undefined;
const view = (d: PanelData | null, over: Partial<React.ComponentProps<typeof FollowupPanelView>> = {}) =>
  renderToStaticMarkup(<FollowupPanelView expanded loading={false} error={null} data={d} onToggle={noop} onReload={noop} onRetry={noop} onMarkCalled={noop} {...over} />);

describe("showRetry / retryHint / stateLabel", () => {
  const cases: Array<[boolean, boolean, boolean]> = [[true, true, false], [false, false, false], [true, false, true], [false, true, false]];
  it.each(cases)("retryable=%s outcomeUnknown=%s -> %s", (retryable, outcomeUnknown, want) => {
    expect(showRetry({ retryable, outcomeUnknown })).toBe(want);
  });
  it.each([
    ["outcome_unknown", "The send may already have happened; check before acting"], ["already_sent", "Already sent"],
    ["already_in_file", "Already in a calling file"], [null, null],
  ] as const)("hint %s", (reason, text) => expect(retryHint({ retryReason: reason })).toBe(text));
  it("labels unknown outcome and already sent in words", () => {
    expect(stateLabel({ outcomeUnknown: true, retryReason: "outcome_unknown" })).toBe("Outcome unknown: a message may already have gone out");
    expect(stateLabel({ outcomeUnknown: false, retryReason: "already_sent" })).toMatch(/^Already sent/);
    expect(stateLabel({ outcomeUnknown: false, retryReason: null })).toBeNull();
  });
});

describe("retryErrorText", () => {
  it.each([
    [{ status: 403, message: "Forbidden" }, "Only an admin can retry"],
    [{ status: 409, message: "already_sent" }, "already sent"],
    [{ status: 409, message: "not_retryable" }, "not retryable"],
    [{ status: 409, message: "stopped" }, "stopped"],
    [{ status: 409, message: "outcome_unknown" }, "outcome unknown"],
    [{ status: 409, message: "<b>x</b> 9876543210" }, "Retry failed"],
    [{ status: 500, message: "boom 9876543210" }, "Retry failed"],
    [new Error("net"), "Retry failed"], [null, "Retry failed"],
  ])("%j", (e, text) => expect(retryErrorText(e)).toBe(text));
});

describe("modes and report", () => {
  it("modeText", () => {
    expect(modeText("off")).toBe("Off: nothing is enrolled");
    expect(modeText("dry_run")).toBe("Dry run: rows are enrolled and logged, nothing is sent");
    expect(modeText("live")).toBe("Live: messages are being sent");
  });
  it("isFollowupOff", () => {
    expect(isFollowupOff(["live", "off"])).toBe(true);
    expect(isFollowupOff([null, "live"], false)).toBe(true);
    expect(isFollowupOff([null, null])).toBe(false);
    expect(isFollowupOff(["dry_run", "live"], true)).toBe(false);
  });
  it.each([
    [{ running: false, last: null }, "Not running in this process (mode off)"],
    [{ running: true, last: null }, "No report since the last restart (outcome unknown since restart)"],
    [{ running: true, last: { slot: "2026-10-07 08:30", ok: true, tries: 1 } }, "Today's 08:30 report sent"],
    [{ running: true, last: { slot: "2026-10-07 08:30", ok: false, tries: 3 } }, "Report failed after 3 tries"],
    [{ running: true, last: { slot: "2026-10-06 08:30", ok: true, tries: 1 } }, "The 08:30 report of 2026-10-06 sent"],
  ])("reportText %j", (r, text) => expect(reportText(r, "2026-10-07")).toBe(text));
});

describe("scrubText / maskedMobile", () => {
  it.each([
    ["call 9876543210 now", "call # now"], ["12345 stays", "12345 stays"], ["code 131049 failed", "code 131049 failed"], ["id 123456 and 1310499", "id # and #"], ["mail a.b@x.com failed", "mail [email] failed"],
    ["line1\nline2", "line1 line2"], [null, ""], ["a@", "a@"],
    ["call 98765 43210 now", "call # now"], ["call 98765-43210 now", "call # now"], ["call 987-654-3210", "call #"], ["+91 98765 43210", "+#"],
    ["(#131049) failed", "(#131049) failed"], ["131049", "131049"], ["code 131049-12 x", "code # x"], ["x131049 y", "x# y"], ["131 049 failed", "# failed"],
    ["on 2026-10-07 at 10:30", "on 2026-10-07 at 10:30"], ["retry 3 - 5 times", "retry 3 - 5 times"], ["12345 678", "#"],
  ])("%j", (input, out) => expect(scrubText(input)).toBe(out));
  it("truncates long text by code point and keeps markup inert text", () => {
    const t = scrubText(`${"😀".repeat(300)}`);
    expect(Array.from(t)).toHaveLength(120);
    expect(t.endsWith("…")).toBe(true);
  });
  it("masks a bare number the server forgot to mask and keeps masked values", () => {
    expect(maskedMobile("9876543210")).toBe("xxxxxx3210");
    expect(maskedMobile("xxxxxx3210")).toBe("xxxxxx3210");
    expect(maskedMobile(null)).toBe("–");
  });
});

describe("callFileRows / sourceFunnelRows / attentionView", () => {
  it("call-file rows use a dash for null and scrub errors", () => {
    const r = callFileRows(status({ callFiles: [{ id: "b1", createdAt: "2026-10-07T08:30:00.000Z", rows: 12, status: "sent", error: null }, { id: "b2", createdAt: "bad", rows: 0, status: "failed", error: "smtp 5551234567 a@b.co" }] }));
    expect(r[0]).toMatchObject({ rows: "12", status: "sent", error: "–" });
    expect(r[0].when).toContain("IST");
    expect(r[1]).toMatchObject({ when: "–", error: "smtp # [email]" });
    expect(callFileRows(null)).toEqual([]);
  });
  it("funnel: summary only, then with requisition sources summed per type", () => {
    const summary = [{ sourceType: "meta_live" as const, total: 10, open: 6, stopped: 4 }];
    expect(sourceFunnelRows(null, summary)).toEqual([{ sourceType: "meta_live", label: "Live Meta", cells: { total: 10, open: 6, stopped: 4 } }]);
    const mk = (n: number) => ({ sourceType: "meta_live", qualified: n, emailed: n, whatsapped: 0, replied: 0, confirmed: 1, called: 0, arrived: 0, selected: 0, joined: 0, leads: n });
    const src = { rows: [mk(2), mk(3)] } as unknown as RequisitionSources;
    const out = sourceFunnelRows(src, summary);
    expect(out[0].cells).toMatchObject({ total: 10, qualified: 5, emailed: 5, confirmed: 2 });
    expect(sourceFunnelRows(null, [])).toEqual([]);
  });
  it("attention view tolerates junk", () => {
    expect(attentionView(null)).toEqual([]);
    expect(attentionView([null, { channel: "call", cause: "x", count: 1, rows: [null, { id: "" }] }])[0].rows).toEqual([]);
  });
});

const GROUPS: AttentionGroup[] = [
  { channel: "whatsapp", cause: "131049", count: 2, rows: [
    row({ id: "a1", name: "Asha" }),
    row({ id: "a2", name: "Ravi", error: "outcome unknown", outcomeUnknown: true, retryable: false, retryReason: "outcome_unknown" }),
  ] },
];

describe("FollowupPanelView markup", () => {
  it("collapsed by default: a button with aria-expanded=false and no body", () => {
    const html = renderToStaticMarkup(<FollowupPanel />);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Follow-up pipeline");
    expect(html).not.toContain("id=\"followup-panel-body\"");
    expect(html).not.toContain("aria-controls");
  });
  it("expanded: one Retry for two rows, hint, label, masked mobile and no 10-digit number", () => {
    const html = view(data({ attention: GROUPS }));
    expect(html).toContain('aria-expanded="true"');
    expect(html.match(/>Retry</g)?.length ?? 0).toBe(1);
    expect(html).toContain("The send may already have happened; check before acting");
    expect(html).toContain("Outcome unknown: a message may already have gone out");
    expect(html).toContain("xxxxxx3210");
    expect(html).not.toMatch(/\d{10}/);
    expect(html).toContain("WhatsApp: 131049 (2)");
  });
  it("already-sent and in-file rows have no Retry; Mark called only on the call channel", () => {
    const g: AttentionGroup[] = [
      { channel: "whatsapp", cause: "c", count: 1, rows: [row({ retryable: false, retryReason: "already_sent" })] },
      { channel: "call", cause: "d", count: 1, rows: [row({ id: "c1", retryable: false, retryReason: "already_in_file" })] },
    ];
    const html = view(data({ attention: g }));
    expect(html).not.toContain(">Retry<");
    expect(html).toContain("Already sent");
    expect(html).toContain("Already in a calling file");
    expect(html.match(/Mark called/g)?.length).toBe(1);
  });
  it("mode off: one sentence with the mode and no tables", () => {
    const html = view(data({ status: status({ mode: "off" }), summary: { mode: "off", data: [] } }));
    expect(html).toContain(`${OFF_SENTENCE}. Mode: off.`);
    expect(html).not.toContain("<table");
    expect(html).not.toContain("Needs attention");
  });
  it("analytics qualifiedTracked=false also shows the off sentence", () => {
    expect(view(data(), { qualifiedTracked: false })).toContain(OFF_SENTENCE);
  });
  it("empty attention and no calling files give meaningful empty states", () => {
    const html = view(data());
    expect(html).toContain("Nothing needs attention");
    expect(html).toContain("No calling files yet.");
    expect(html).toContain("Total");
  });
  it("partial: banner names the failed sections and the loaded ones still render", () => {
    const html = view(data({ attention: null, failed: ["the needs-attention list"] }));
    expect(html).toContain("Partial result: could not load the needs-attention list.");
    expect(html).toContain("The needs-attention list could not be loaded.");
    expect(html).toContain("Funnel by source type");
  });
  it("report line says unknown since restart when last is null", () => {
    expect(view(data())).toContain("outcome unknown since restart");
    expect(view(data({ status: status({ report: { running: false, last: null } }) }))).toContain("Not running in this process (mode off)");
  });
  it("loading skeleton and error with Retry", () => {
    expect(view(null, { loading: true })).toContain("Loading the follow-up pipeline");
    const err = view(null, { error: "Request failed for 9876543210" });
    expect(err).toContain('role="alert"');
    expect(err).toContain(">Retry<");
    expect(err).not.toMatch(/\d{10}/);
  });
  it("server text is inert: markup in an error is escaped and long text truncated", () => {
    const evil = `<img src=x onerror=alert(1)> ${"long ".repeat(100)} a@b.com 123456789`;
    const html = view(data({ attention: [{ channel: "email", cause: "<script>x</script>", count: 1, rows: [row({ error: evil })] }] }));
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("a@b.com");
    expect(html).not.toContain("123456789");
    expect(html).toContain("…");
  });
  it("action result is announced next to its row", () => {
    const html = view(data({ attention: GROUPS }), { result: { id: "a1", ok: false, text: "Only an admin can retry" } });
    expect(html).toContain('role="status"');
    expect(html).toContain("Only an admin can retry");
  });
  it("a successful retry is announced in the panel-level status line even after the row left the list", () => {
    const html = view(data({ attention: [] }), { result: { id: "gone", ok: true, text: retryOkText({ success: true }, rowName(GROUPS, "a1")) } });
    expect(html).toMatch(/<p role="status"[^>]*>Retry queued for /);
    expect(view(data({ attention: [] }), { result: null })).toMatch(/<p role="status"[^>]*><\/p>/); // mounted, empty
  });
  it("the active row's buttons show a busy word and every row's buttons are disabled", () => {
    const calls: AttentionGroup[] = [{ ...GROUPS[0], channel: "call" }];
    const html = view(data({ attention: calls }), { busy: { id: "a1", kind: "retry" } });
    expect(html).toContain("Retrying…");
    expect(html).not.toContain("Marking…");
    expect(html.match(/<button type="button" class="[^"]*" disabled=""/g)).toHaveLength(3); // a1 retry + mark, a2 mark
    const marking = view(data({ attention: calls }), { busy: { id: "a1", kind: "mark" } });
    expect(marking).toContain("Marking…");
    expect(marking.match(/Marking…/g)).toHaveLength(1);
  });
  it("result texts name the masked row and say when nothing changed", () => {
    expect(rowName([{ channel: "email", cause: "x", count: 1, rows: [row({ id: "z", name: "Asha" })] }], "z")).toBe("Asha (xxxxxx3210)");
    expect(rowName([], "z")).toBe("this row");
    expect(retryOkText({}, "Asha (xxxxxx3210)")).toBe("Retry queued for Asha (xxxxxx3210)");
    expect(markCalledText({ updated: 0 }, "Asha")).toBe("Nothing changed: the row is not in a calling file");
    expect(markCalledText({ updated: 1 }, "Asha")).toBe("Marked Asha as called");
  });
});
