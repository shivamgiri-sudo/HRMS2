import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ApproveBarView, type BarViewProps } from "../ApproveShortlistBar";
import { OverrideBody } from "../OverrideDialog";
import { WhyNotResults } from "../WhyNotLookup";
import { BookedMismatchView } from "../BookedMismatchList";
import type { ApprovalState, WhyNotPerson } from "../selectionTypes";

const all = { read: true, edit: true, export: true, approve: true, override: true };
const view = { read: true, edit: false, export: false, approve: false, override: false };
const noop = () => undefined;
const state: ApprovalState = { lastRun: { runId: "run-1", at: "2026-10-09 17:00:00", versionId: "v2", counts: { picked: 1, review: 1 } }, currentVersion: { id: "v2", versionNo: 2 },
  drift: false, blocker: null, standing: [{ id: "s1", validUntil: "2026-10-12 10:00:00", versionId: "v2", approvedBy: "u", approvedAt: "t" }], permissions: all };
const people = [{ id: "1", maskedMobile: "98xxxxxx10", subSource: "candidate", verdict: "pass", score: 50, status: "picked", reasons: [] },
  { id: "2", maskedMobile: "97xxxxxx11", subSource: "candidate", verdict: "review", score: 0, status: "review", reasons: ["Age: not known"] }];
const bar = (o: Partial<BarViewProps> = {}) => renderToStaticMarkup(<ApproveBarView state={state} people={people} unticked={new Set()} reviewOk={new Set()} onUntick={noop} onReviewOk={noop}
  sourceKind="meta_live" days={7} onDays={noop} busy={false} message={null} error={null} now={new Date("2026-10-09T12:00:00Z")} onRun={noop} onApprove={noop} onStanding={noop} onRevoke={noop} {...o} />);

describe("approve bar view", () => {
  it("untick list with masked mobiles, approve count, standing approval with Revoke", () => {
    const html = bar();
    expect(html).toContain('aria-label="Include 98xxxxxx10"');
    expect(html).toContain("Approve 1 person");
    expect(html).toContain("Standing approval for Live Meta until 2026-10-12 10:00:00");
    expect(html).toContain(">Revoke<");
    expect(html).toContain("Age: not known");
  });
  it("blocked: approve disabled and the reason in words", () => {
    const html = bar({ state: { ...state, blocker: "criteria_incomplete: x" } });
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Approve 1 person/);
    expect(html).toContain("Criteria incomplete: decide location, education, shift and age first");
  });
  it("view-only roles see counts but no write controls", () => {
    const html = bar({ state: { ...state, permissions: view }, people: [] });
    expect(html).toContain("1 shortlisted, 1 for review");
    expect(html).not.toContain("Run the shortlist");
    expect(html).not.toContain("Revoke");
    expect(html).not.toContain("type=\"checkbox\"");
    expect(html).toContain("Only HR can approve shortlists");
  });
});

describe("override dialog body", () => {
  it("reason is mandatory; the system-exclusion warning is shown as text", () => {
    const base = { maskedMobile: "98xxxxxx10", code: "REQ-1", kind: "include" as const, onKind: noop, reason: "", onReason: noop, busy: false, warning: null, error: null, done: false, onSave: noop };
    expect(renderToStaticMarkup(<OverrideBody {...base} />)).toMatch(/<button[^>]*disabled=""[^>]*>Save decision/);
    expect(renderToStaticMarkup(<OverrideBody {...base} />)).toContain("A reason is required");
    const w = renderToStaticMarkup(<OverrideBody {...base} reason="Referred" warning="system exclusion cannot be overridden (current employee)" done />);
    expect(w).toContain("Saved, but this person is still not contacted: system exclusion cannot be overridden (current employee)");
  });
});

describe("why-not results", () => {
  const p: WhyNotPerson = { person: { maskedMobile: "98xxxxxx10", fullMobileIfSearched: "9876543210", name: "Asha", sources: ["candidate"] },
    perRequisition: [{ requisitionId: "r1", code: "REQ-1", verdict: "review", systemBlock: null, explanation: null, failed: [], unknown: [], override: null, lastDecision: null, journey: null }] };
  it("override button only for override roles; never prints the full mobile", () => {
    const html = renderToStaticMarkup(<WhyNotResults people={[p]} permissions={all} onOverride={noop} />);
    expect(html).toContain("Override for REQ-1"); expect(html).toContain("Held for HR review"); expect(html).not.toContain("9876543210");
    expect(renderToStaticMarkup(<WhyNotResults people={[p]} permissions={view} onOverride={noop} />)).not.toContain("Override for");
    expect(renderToStaticMarkup(<WhyNotResults people={[]} permissions={all} onOverride={noop} />)).toContain("Nobody found");
  });
});

describe("booked mismatch", () => {
  it("masked rows, honest empty state", () => {
    expect(renderToStaticMarkup(<BookedMismatchView rows={[{ followupId: "f", maskedMobile: "98xxxxxx10", firstName: "Asha", verdict: "fail", slotAt: "2026-10-10 11:00", matchState: "confirmed" }]} />)).toContain("Fails a MUST rule");
    expect(renderToStaticMarkup(<BookedMismatchView rows={[]} />)).toContain("Nobody booked is affected");
  });
});
