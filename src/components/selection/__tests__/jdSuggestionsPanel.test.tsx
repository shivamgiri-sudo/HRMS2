import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import CriteriaSummary from "../CriteriaSummary";
import { versionLine } from "../completenessModel";
import { JdSuggestionsView, type ViewProps } from "../JdSuggestionsPanel";
import type { JdSuggestionsData, JdSuggestionView } from "../jdSuggestionsModel";

const edu: JdSuggestionView = { id: "a1", key: "education_min", mode: "must", value: { level: "Graduate" }, plain: "Minimum qualification: Graduate", phrase: "Graduation with good typing speed",
  matched: "Graduation", field: "skills_required", confidence: "high", why: "a stated qualification is a requirement" };
const typing: JdSuggestionView = { ...edu, id: "t1", key: "typing", mode: "prefer", value: { wpm: null }, plain: "Typing speed: you set the minimum wpm (the text gives no number)", matched: "good typing speed", confidence: "medium", why: "says \"good\"", needs: "wpm" };
const data = (o: Partial<JdSuggestionsData> = {}): JdSuggestionsData => ({
  suggestions: [edu, typing], dismissed: [], unparsed: [{ field: "business_justification", phrase: "Married Not allowed", reason: "Marital status is not a selection rule" }], skipped: [],
  current: { approvalStatus: "approved", legacy: true, completeness: { score: 8, label: "incomplete", missing: [], enrolmentReady: false }, undecided: [], structuredEmpty: true, hasText: true, versionNo: 2, versionId: "v2" },
  permissions: { read: true, edit: true, export: true, approve: true, override: true }, ...o,
});
const noop = () => undefined;
const props = (o: Partial<ViewProps> = {}): ViewProps => ({
  data: data(), values: {}, onValue: noop, reason: "", onReason: noop, busy: false, error: null, message: null,
  preview: { source: "he", outcome: { shortlist: 12, review: 3, rejected: 40, systemExcluded: 2 }, loading: false }, onSource: noop,
  confirm: null, onAccept: noop, onDismiss: noop, onRestore: noop, onAcceptAll: noop, onConfirm: noop, onCancel: noop, ...o,
});
const html = (o: Partial<ViewProps> = {}) => renderToStaticMarkup(<JdSuggestionsView {...props(o)} />);

describe("JdSuggestionsView", () => {
  it("each suggestion: the exact phrase, the rule in words, MUST/PREFER as a word, confidence with an icon", () => {
    const h = html();
    expect(h).toContain("Suggested from the requisition text");
    expect(h).toContain("Skills: “Graduation with good typing speed”");
    expect(h).toContain("Minimum qualification: Graduate");
    expect(h).toContain(">MUST<");
    expect(h).toContain(">PREFER<");
    expect(h).toContain("Sure");
    expect(h).toContain("Likely");
    expect(h).toContain("a stated qualification is a requirement");
  });
  it("writers: Accept / Dismiss per suggestion with labels, the number input, the reason field, Accept all; 44px targets", () => {
    const h = html();
    expect(h).toContain('aria-label="Accept: Minimum qualification: Graduate"');
    expect(h).toContain('aria-label="Dismiss: Minimum qualification: Graduate"');
    expect(h).toContain("Minimum typing speed (wpm)");
    expect(h).toMatch(/<input[^>]*type="number"[^>]*min="10"[^>]*max="120"/);
    expect(h).toContain("Reason (required for an approved requisition)");
    expect(h).toContain("Accept all (2)");
    expect(h).toContain("min-h-11");
    expect(h).toMatch(/focus-visible:ring-2/);
    // typing has no number yet: its Accept is disabled and says why
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Accept: Typing speed/);
  });
  it("view-only (CEO) and closed requisitions: no accept or dismiss controls", () => {
    for (const d of [data({ permissions: { read: true, edit: false, export: false, approve: false, override: false } }), data({ current: { ...data().current, approvalStatus: "closed" } })]) {
      const h = html({ data: d });
      expect(h).toContain("Minimum qualification: Graduate");
      expect(h).not.toContain("Accept");
      expect(h).not.toContain("Dismiss");
      expect(h).not.toContain("<input");
    }
    expect(html({ data: data({ current: { ...data().current, approvalStatus: "closed" } }) })).toContain("Closed requisition: read-only");
  });
  it("live preview counts, and the accept-all confirmation with before and after", () => {
    expect(html()).toContain("12 shortlisted, 3 to review, 40 not matching");
    const h = html({ confirm: { ids: ["a1", "t1"], before: { shortlist: 12, review: 3, rejected: 40, systemExcluded: 2 }, after: { shortlist: 5, review: 9, rejected: 41, systemExcluded: 2 }, loading: false, leavesLegacy: true } });
    expect(h).toContain('role="alertdialog"');
    expect(h).toContain("Accept 2 suggestions?");
    expect(h).toContain("Now: 12 shortlisted, 3 to review, 40 not matching");
    expect(h).toContain("After: 5 shortlisted, 9 to review, 41 not matching");
    expect(h).toContain("switch to the criteria engine");
    expect(h).toContain("Confirm");
    expect(h).toContain("Cancel");
  });
  it("honest empty state, dismissed list with Show again, and what was not used", () => {
    const h = html({ data: data({ suggestions: [], dismissed: [typing] }) });
    expect(h).toContain("Nothing left to suggest: 1 dismissed.");
    expect(h).toContain('aria-label="Show again: Typing speed: you set the minimum wpm (the text gives no number)"');
    expect(html()).toContain("Married Not allowed");
    expect(html()).toContain("Marital status is not a selection rule");
    expect(html({ data: data({ suggestions: [], current: { ...data().current, hasText: false }, unparsed: [] }) })).toContain("This requisition has no free text");
  });
  it("errors are announced", () => {
    expect(html({ error: "A reason is required" })).toContain('role="alert"');
  });
});

describe("CriteriaSummary with criteria found in text", () => {
  const sum = { completeness: { score: 8, label: "incomplete" as const, missing: ["age"], enrolmentReady: false }, rules: [], legacy: true, version: null };
  it("says 'Criteria found in text: N suggestions' instead of 'criteria incomplete'", () => {
    const h = renderToStaticMarkup(<CriteriaSummary data={sum} textHint="Criteria found in text: 2 suggestions" />);
    expect(h).toContain("Criteria found in text: 2 suggestions");
    expect(h).not.toContain("Enrolment blocked: criteria incomplete");
    expect(h).not.toContain("Incomplete · 8");
    expect(h).toContain('aria-hidden="true"');
  });
  it("without a hint nothing changes", () => {
    expect(renderToStaticMarkup(<CriteriaSummary data={sum} />)).toContain("Enrolment blocked: criteria incomplete");
  });
  it("versions saved from suggestions say so", () => {
    expect(versionLine({ versionNo: 4, at: "2026-10-09T10:00:00Z", by: "u", source: "jd_suggestion" }, new Date("2026-10-09T10:30:00Z"))).toBe("Version 4, changed 30 min ago from requisition text suggestions");
  });
});
