import { describe, expect, it } from "vitest";
import {
  acceptAllState, canWrite, emptyText, fieldLabel, modeLabel, needsValueError, outcomeLine, rowsOf, textHint, type JdSuggestionsData, type JdSuggestionView,
} from "../jdSuggestionsModel";

const s = (o: Partial<JdSuggestionView> = {}): JdSuggestionView => ({
  id: "a1", key: "education_min", mode: "must", value: { level: "Graduate" }, plain: "Minimum qualification: Graduate", phrase: "Graduation with good typing speed", matched: "Graduation",
  field: "skills_required", confidence: "high", why: "a stated qualification is a requirement", ...o,
});
const typing = s({ id: "t1", key: "typing", mode: "prefer", value: { wpm: null }, plain: "Typing speed: you set the minimum wpm (the text gives no number)", matched: "good typing speed", confidence: "medium", why: "says \"good\"", needs: "wpm" });
const data = (o: Partial<JdSuggestionsData> = {}): JdSuggestionsData => ({
  suggestions: [s(), typing], dismissed: [], unparsed: [], skipped: [],
  current: { approvalStatus: "approved", legacy: true, completeness: { score: 8, label: "incomplete", missing: [], enrolmentReady: false }, undecided: ["education_min"], structuredEmpty: true, hasText: true, versionNo: 3, versionId: "v3" },
  permissions: { read: true, edit: true, export: true, approve: true, override: true }, ...o,
});

describe("words", () => {
  it("mode and field in plain words, never colour alone", () => {
    expect(modeLabel("must")).toBe("MUST");
    expect(modeLabel("prefer")).toBe("PREFER");
    expect(modeLabel("off")).toBe("No requirement");
    expect(fieldLabel("skills_required")).toBe("Skills");
    expect(fieldLabel("business_justification")).toBe("Justification");
  });
  it("rows carry the exact phrase, the rule, mode, confidence and whether HR must type a number", () => {
    const r = rowsOf(data(), {});
    expect(r).toEqual([
      expect.objectContaining({ id: "a1", source: "Skills: “Graduation with good typing speed”", rule: "Minimum qualification: Graduate", mode: "MUST", confidence: "Sure", needs: null, acceptable: true }),
      expect.objectContaining({ id: "t1", mode: "PREFER", confidence: "Likely", needs: { label: "Minimum typing speed (wpm)", min: 10, max: 120 }, acceptable: false }),
    ]);
    expect(rowsOf(data(), { t1: "25" })[1].acceptable).toBe(true);
  });
  it("number checks", () => {
    expect(needsValueError("wpm", "")).toBe("Type the minimum typing speed");
    expect(needsValueError("wpm", "500")).toBe("Between 10 and 120");
    expect(needsValueError("years", "2")).toBeNull();
  });
});

describe("states", () => {
  it("criteria found in text instead of criteria incomplete", () => {
    expect(textHint(data())).toBe("Criteria found in text: 2 suggestions");
    expect(textHint(data({ suggestions: [s()] }))).toBe("Criteria found in text: 1 suggestion");
    expect(textHint(data({ current: { ...data().current, structuredEmpty: false } }))).toBeNull();
    expect(textHint(data({ suggestions: [] }))).toBeNull();
  });
  it("honest empty states", () => {
    expect(emptyText(data({ suggestions: [], current: { ...data().current, hasText: false } }))).toBe("This requisition has no free text (skills, job description, shift or justification) to read.");
    expect(emptyText(data({ suggestions: [] }))).toBe("Nothing to suggest: the text names no criteria the rules can use, or they are already set.");
    expect(emptyText(data({ suggestions: [], dismissed: [typing] }))).toBe("Nothing left to suggest: 1 dismissed.");
    expect(emptyText(data())).toBeNull();
  });
  it("writers only, and never on a closed requisition", () => {
    expect(canWrite(data())).toBe(true);
    expect(canWrite(data({ permissions: { read: true, edit: false, export: false, approve: false, override: false } }))).toBe(false);
    expect(canWrite(data({ current: { ...data().current, approvalStatus: "closed" } }))).toBe(false);
  });
  it("accept all: every number typed, and a reason on an approved requisition", () => {
    expect(acceptAllState(data(), {}, "")).toEqual({ ok: false, why: "Type the numbers the text does not give (1)" });
    expect(acceptAllState(data(), { t1: "25" }, "")).toEqual({ ok: false, why: "A reason is required to change an approved requisition" });
    expect(acceptAllState(data(), { t1: "25" }, "Owner confirmed")).toEqual({ ok: true, why: null });
    expect(acceptAllState(data({ current: { ...data().current, approvalStatus: "draft" } }), { t1: "25" }, "")).toEqual({ ok: true, why: null });
  });
  it("preview counts in words", () => {
    expect(outcomeLine({ shortlist: 12, review: 3, rejected: 40, systemExcluded: 2 })).toBe("12 shortlisted, 3 to review, 40 not matching");
  });
});
