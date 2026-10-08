import { describe, expect, it } from "vitest";
import {
  bannerItems, canSave, decideNoRequirement, initDraft, isLocked, previewDelta, setColumn, setMode, setMissing, setWeight, skippedText, toPatch,
} from "../criteriaEditorModel";
import type { CriteriaResponse, PreviewResult } from "../selectionTypes";

const resp = (o: Partial<CriteriaResponse["row"]> = {}, rules: CriteriaResponse["compiled"]["rules"] = []): CriteriaResponse => ({
  row: { id: "r1", code: "REQ-K7BK", branchName: "NOIDA-2", branchCity: "Noida", processName: "Onfido", approvalStatus: "approved", educationRequirement: null, skillsRequired: "Excel",
    experienceMinYears: null, experienceMaxYears: null, ageMin: null, ageMax: null, targetLocations: null, radiusKm: null, shiftRequirement: null, nightShiftRequired: 0, rotationalShift: 1,
    salaryMin: 15000, salaryMax: 18000, screeningConfig: { custom_field_rules: [{ field: "are_you_a_graduate", op: "is_yes", value: "", label: "Graduate (must)" }] }, selectionRules: null, ...o },
  compiled: { rules, undecided: [], completeness: { score: 24, label: "incomplete", missing: [], enrolmentReady: false }, legacy: !o.selectionRules, hash: "h" },
  completeness: { score: 24, label: "incomplete", missing: [], enrolmentReady: false }, issues: [], versions: [], permissions: { read: true, edit: true, export: true, approve: true, override: true },
});
const withRules = () => resp({ ageMin: 18, ageMax: 35, selectionRules: { schema: 1, rules: { age: { mode: "must", missing: "review" } } } },
  [{ key: "rotational_shift", label: "OK with rotational shifts", requiredText: "OK with rotational shifts", mode: "must", weight: 0, missing: "review", origin: "column", defaulted: true }]);

describe("initDraft", () => {
  it("decided rules carry their setting; others are undecided; defaulted ones are flagged", () => {
    const d = initDraft(withRules());
    expect(d.rows.age).toMatchObject({ mode: "must", missing: "review", defaulted: false });
    expect(d.rows.rotational_shift).toMatchObject({ mode: "undecided", defaulted: true });
    expect(d.rows.skills.mode).toBe("undecided");
    expect(d.cols.ageMin).toBe("18");
    expect(d.legacy).toBe(false);
  });
});

describe("legacy requisitions (nothing saved in the editor yet)", () => {
  it("an undecided row says how today's screening treats it", () => {
    const d = initDraft(resp({}, [{ key: "age", label: "Age", requiredText: "18 to 32", mode: "must", weight: 0, missing: "review", origin: "column" },
      { key: "skills", label: "Skills", requiredText: "Excel", mode: "prefer", weight: 10, missing: "pass", origin: "column" }]));
    expect(d.rows.age).toMatchObject({ mode: "undecided", today: "MUST" });
    expect(d.rows.skills.today).toBe("PREFER");
    expect(d.rows.typing.today).toBeNull();
    expect(initDraft(withRules()).rows.skills.today).toBeNull();
  });
});

describe("toPatch (only what changed)", () => {
  it("no change -> empty patch", () => expect(toPatch(initDraft(withRules()), initDraft(withRules()))).toEqual({}));
  it("a column change -> that column only, typed", () => {
    const a = initDraft(withRules());
    expect(toPatch(setColumn(a, "ageMax", "40"), a)).toEqual({ ageMax: 40 });
    expect(toPatch(setColumn(a, "targetLocations", "Noida, Ghaziabad "), a)).toEqual({ targetLocations: ["Noida", "Ghaziabad"] });
    expect(toPatch(setColumn(a, "ageMin", ""), a)).toEqual({ ageMin: null });
  });
  it("a rule change -> the whole selection_rules with every decided rule", () => {
    const a = initDraft(withRules());
    const p = toPatch(setWeight(setMode(a, "skills", "prefer"), "skills", 15), a);
    expect(p.selectionRules).toEqual({ schema: 1, rules: { age: { mode: "must", decided: true, missing: "review" }, skills: { mode: "prefer", decided: true, weight: 15, value: { match: "any" } } } });
  });
  it("decide: no requirement", () => {
    const a = initDraft(withRules());
    expect(toPatch(decideNoRequirement(a, "rotational_shift"), a).selectionRules?.rules.rotational_shift).toEqual({ mode: "off", decided: true });
  });
  it("missing policy and per source", () => {
    const a = initDraft(withRules());
    const b = setMissing(a, "age", "review", { meta_live: "pass" });
    expect(toPatch(b, a).selectionRules?.rules.age).toEqual({ mode: "must", decided: true, missing: "review", missingBySource: { meta_live: "pass" } });
  });
});

describe("canSave", () => {
  const base = initDraft(withRules());
  const changed = setColumn(base, "ageMax", "40");
  it("nothing changed", () => expect(canSave(base, base, { reason: "", issues: [], ackWarnings: false })).toMatchObject({ ok: false, why: "Nothing to save" }));
  it("approved + no reason -> cannot save", () => expect(canSave(changed, base, { reason: " ", issues: [], ackWarnings: false })).toMatchObject({ ok: false, why: expect.stringMatching(/reason/) }));
  it("errors block; warnings need ticking", () => {
    expect(canSave(changed, base, { reason: "x", issues: [{ level: "error", keys: ["age"], text: "bad" }], ackWarnings: true }).ok).toBe(false);
    expect(canSave(changed, base, { reason: "x", issues: [{ level: "warning", keys: [], text: "w" }], ackWarnings: false }).ok).toBe(false);
    expect(canSave(changed, base, { reason: "x", issues: [{ level: "warning", keys: [], text: "w" }], ackWarnings: true }).ok).toBe(true);
  });
  it("closed or no edit permission -> read only", () => {
    const closed = initDraft(resp({ approvalStatus: "closed" }));
    expect(canSave(setColumn(closed, "ageMax", "40"), closed, { reason: "x", issues: [], ackWarnings: false })).toMatchObject({ ok: false, why: expect.stringMatching(/read-only/) });
  });
  it("a draft (not approved) needs no reason", () => {
    const d = initDraft(resp({ approvalStatus: "draft" }));
    expect(canSave(setColumn(d, "ageMax", "40"), d, { reason: "", issues: [], ackWarnings: false }).ok).toBe(true);
  });
});

describe("locks", () => {
  it("salary is locked once approved; everything once closed; nothing on a draft", () => {
    expect(isLocked("salary_fit", "approved")).toBe("Change needs re-approval");
    expect(isLocked("age", "approved")).toBeNull();
    expect(isLocked("age", "closed")).toBe("Closed requisitions are read-only");
    expect(isLocked("salary_fit", "draft")).toBeNull();
  });
});

describe("banner and preview delta", () => {
  const prev = (o: Partial<PreviewResult> = {}): PreviewResult => ({ requisitionId: "r1", versionId: "v1", draft: false, source: "he", subSource: "all", start: 40,
    steps: [{ key: "system", label: "S", kind: "system", remaining: 30, failedHere: 10, reviewHere: 0, onlyThisRuleFails: 10, ifRemovedGain: 0 },
      { key: "rotational_shift", label: "R", kind: "must", remaining: 30, failedHere: 0, reviewHere: 22, onlyThisRuleFails: 0, ifRemovedGain: 0 }],
    outcome: { shortlist: 5, review: 25, rejected: 0, systemExcluded: 10 }, scoreBuckets: [], sample: [], capPreview: { seatsLeft: 3, dailyCap: null }, generatedAt: "t", partial: [], ...o });
  it("undecided rules that act as MUST, with how many people they send to review", () => {
    expect(bannerItems(initDraft(withRules()), prev())).toEqual([{ key: "rotational_shift", label: "OK with rotational shifts", review: 22, fail: 0 }]);
    expect(bannerItems(decideNoRequirement(initDraft(withRules()), "rotational_shift"), prev())).toEqual([]);
  });
  it("delta saved vs draft per outcome", () => {
    expect(previewDelta(prev(), prev({ outcome: { shortlist: 27, review: 3, rejected: 0, systemExcluded: 10 } }))).toEqual([
      { label: "Shortlist", saved: 5, draft: 27, change: "+22" }, { label: "Review", saved: 25, draft: 3, change: "-22" },
      { label: "Rejected", saved: 0, draft: 0, change: "0" }, { label: "Never contacted (system)", saved: 10, draft: 10, change: "0" },
    ]);
  });
  it("template skipped text", () => {
    expect(skippedText(["skills", "age"])).toBe("Kept, already filled: Skills, Age");
    expect(skippedText([])).toBe("");
  });
});
