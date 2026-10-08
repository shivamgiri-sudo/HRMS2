import { describe, expect, it } from "vitest";
import { compileCriteria } from "../compile-criteria.js";
import { parseSelectionRules } from "../selection-rules.schema.js";
import { applyTemplate, TEMPLATES } from "../templates.js";
import type { SelectionRules } from "../selection-types.js";
import { K7BK_CONFIG, onfidoRow } from "./fixtures/rows.js";

const rulesOf = (sr: SelectionRules["rules"], extra: Partial<SelectionRules> = {}): SelectionRules => ({ schema: 1, rules: sr, ...extra });

describe("legacy compile (no selection_rules)", () => {
  it("Onfido-like row with skills only: skills PREFER, core facts undecided, incomplete, not enrolment ready", () => {
    const c = compileCriteria(onfidoRow());
    expect(c.legacy).toBe(true);
    expect(c.rules.filter((r) => r.key === "skills").map((r) => r.mode)).toEqual(["prefer"]);
    expect(c.undecided).toEqual(["education_min", "experience", "age", "location_cities", "night_shift"]);
    expect(c.completeness.label).toBe("incomplete");
    expect(c.completeness.enrolmentReady).toBe(false);
  });

  it("the K7BK Meta config compiles to two form_answer MUST rules, missing = pass, Meta sources only", () => {
    const c = compileCriteria(onfidoRow({ screeningConfig: K7BK_CONFIG as never }));
    const fa = c.rules.filter((r) => r.key === "form_answer");
    expect(fa).toHaveLength(2);
    for (const r of fa) expect(r).toMatchObject({ mode: "must", missing: "pass", only: ["meta_live", "meta_old"] });
  });

  it("splits today's two screeners: Meta rules from columns/config (missing pass), drive rules from the matcher requisition (missing review)", () => {
    const c = compileCriteria(onfidoRow({ ageMin: 18, ageMax: 35, educationRequirement: "Graduate", nightShiftRequired: 1 }));
    const meta = c.rules.filter((r) => r.only?.includes("meta_live")).map((r) => r.key);
    const he = c.rules.filter((r) => r.only?.includes("he")).map((r) => r.key);
    expect(meta).toEqual(expect.arrayContaining(["age", "education_min"]));
    expect(meta).not.toContain("night_shift");
    expect(he).toEqual(expect.arrayContaining(["age", "education_min", "night_shift", "location_region"]));
    for (const r of c.rules.filter((x) => x.only?.includes("he") && x.key !== "salary_fit")) expect(r.missing).toBe("review");
    for (const r of c.rules.filter((x) => x.only?.includes("meta_live"))) expect(r.missing).toBe("pass");
  });

  it("legacy defaults never reject on missing data", () => {
    const c = compileCriteria(onfidoRow({ ageMin: 18, ageMax: 35, educationRequirement: "Graduate", nightShiftRequired: 1, experienceMinYears: 1, salaryMax: 20000,
      screeningConfig: { gender: "female", certifications: ["DRA"], language_requirements: [{ language: "Hindi", skills: ["speak"] }], min_typing_speed_wpm: 25, written_english_level: "basic", ...K7BK_CONFIG } as never }));
    for (const r of c.rules) {
      expect(r.missing).not.toBe("fail");
      for (const v of Object.values(r.missingBySource ?? {})) expect(v).not.toBe("fail");
    }
  });

  it("tolerates language requirements stored as plain strings (seen on the rig data) and gender 'any'", () => {
    const c = compileCriteria(onfidoRow({ screeningConfig: { gender: "any", language_requirements: ["Hindi"], min_typing_speed_wpm: 20 } as never }));
    const langs = c.rules.find((r) => r.key === "languages" && r.only?.includes("meta_live"));
    expect(langs?.required).toEqual({ langs: [{ language: "Hindi", skills: [] }] });
    expect(langs?.requiredText).toBe("Hindi");
    expect(c.rules.some((r) => r.key === "gender")).toBe(false);
  });

  it("matchReq equals today's line-up requisition (no JD document)", () => {
    const c = compileCriteria(onfidoRow({ ageMin: 18, educationRequirement: "12th pass" }));
    expect(c.matchReq).toMatchObject({ ageMin: 18, minEducationRank: 3, nightShift: false, processName: "Onfido", salaryMax: 18000 });
  });
});

describe("compile with selection_rules", () => {
  it("an explicit No requirement for age counts as decided and compiles no age rule", () => {
    const c = compileCriteria(onfidoRow({ selectionRules: rulesOf({ age: { mode: "off", decided: true } }) }));
    expect(c.decided).toContain("age");
    expect(c.undecided).not.toContain("age");
    expect(c.rules.some((r) => r.key === "age")).toBe(false);
  });

  it("rules apply to every source, in the default order, with HR's mode/weight/missing", () => {
    const c = compileCriteria(onfidoRow({ educationRequirement: "Graduate", ageMin: 18, ageMax: 30,
      selectionRules: rulesOf({ education_min: { mode: "must", missing: "fail" }, age: { mode: "must", missingBySource: { meta_live: "pass" } }, skills: { mode: "prefer", weight: 20, value: { match: "all" } } }) }));
    const keys = c.rules.map((r) => r.key);
    expect(keys.indexOf("age")).toBeLessThan(keys.indexOf("education_min"));
    expect(c.rules.find((r) => r.key === "education_min")).toMatchObject({ mode: "must", missing: "fail", required: { rank: 5 } });
    expect(c.rules.find((r) => r.key === "age")).toMatchObject({ missing: "review", missingBySource: { meta_live: "pass" } });
    expect(c.rules.find((r) => r.key === "skills")).toMatchObject({ mode: "prefer", weight: 20 });
    expect(c.rules.every((r) => r.only === undefined)).toBe(true);
  });

  it("a column value without a setting uses the catalogue default (age MUST, missing review; Meta pass)", () => {
    const c = compileCriteria(onfidoRow({ ageMin: 18, selectionRules: rulesOf({}) }));
    expect(c.rules.find((r) => r.key === "age")).toMatchObject({ mode: "must", missing: "review", missingBySource: { meta_live: "pass", meta_old: "pass" } });
  });

  it("matchReq follows the compiled rules: education MUST graduate -> minEducationRank 5; an age switched off -> no band", () => {
    const c = compileCriteria(onfidoRow({ educationRequirement: "Graduate", ageMin: 18, ageMax: 35, selectionRules: rulesOf({ education_min: { mode: "must" }, age: { mode: "off", decided: true } }) }));
    expect(c.matchReq.minEducationRank).toBe(5);
    expect(c.matchReq.ageMin ?? null).toBeNull();
    expect(c.matchReq.ageMax ?? null).toBeNull();
  });

  it("explicit order wins over the default order", () => {
    const c = compileCriteria(onfidoRow({ educationRequirement: "Graduate", ageMin: 18, selectionRules: rulesOf({ education_min: { mode: "must" }, age: { mode: "must" } }, { order: ["education_min", "age"] }) }));
    expect(c.rules.map((r) => r.key).slice(0, 2)).toEqual(["education_min", "age"]);
  });
});

describe("criteria hash", () => {
  const sr1 = rulesOf({ age: { mode: "must" }, skills: { mode: "prefer", weight: 5 } });
  const sr2 = rulesOf({ skills: { weight: 5, mode: "prefer" }, age: { mode: "must" } } as never);
  it("is stable across key order", () => {
    expect(compileCriteria(onfidoRow({ ageMin: 18, selectionRules: sr1 })).hash).toBe(compileCriteria(onfidoRow({ ageMin: 18, selectionRules: sr2 })).hash);
    expect(compileCriteria(onfidoRow()).hash).toMatch(/^[0-9a-f]{64}$/);
  });
  it("changes when one value changes", () => {
    expect(compileCriteria(onfidoRow({ ageMin: 18, selectionRules: sr1 })).hash).not.toBe(compileCriteria(onfidoRow({ ageMin: 19, selectionRules: sr1 })).hash);
  });
  it("does not depend on the version id", () => {
    expect(compileCriteria(onfidoRow(), { versionId: "v1" }).hash).toBe(compileCriteria(onfidoRow(), { versionId: "v2" }).hash);
  });
});

describe("templates", () => {
  it("night_shift_bpo on the Onfido row (replaceFilled false): skills untouched, the rest filled, enrolment ready", () => {
    const row = onfidoRow();
    const { patch, skipped } = applyTemplate(row, "night_shift_bpo", { replaceFilled: false, now: new Date("2026-10-09T10:00:00Z"), appliedBy: "u1" });
    expect(skipped).toContain("skills");
    expect(patch.skillsRequired).toBeUndefined();
    expect(patch).toMatchObject({ educationRequirement: "Graduate", nightShiftRequired: 1, ageMin: 18, ageMax: 35 });
    const c = compileCriteria({ ...row, ...patch });
    expect(c.completeness.enrolmentReady).toBe(true);
    expect(c.templateId).toBe("night_shift_bpo");
  });
  it("replaceFilled true overwrites filled fields", () => {
    const { patch, skipped } = applyTemplate(onfidoRow({ educationRequirement: "12th" }), "night_shift_bpo", { replaceFilled: true });
    expect(patch.educationRequirement).toBe("Graduate");
    expect(skipped).toEqual([]);
  });
  it("never overwrites an existing selection rule or screening key unless asked", () => {
    const row = onfidoRow({ screeningConfig: { written_english_level: "advanced", x: 1 } as never, selectionRules: rulesOf({ age: { mode: "off", decided: true } }) });
    const { patch, skipped } = applyTemplate(row, "night_shift_bpo", { replaceFilled: false });
    expect(patch.selectionRules?.rules.age).toEqual({ mode: "off", decided: true });
    expect(patch.screeningConfig).toMatchObject({ written_english_level: "advanced", x: 1, min_typing_speed_wpm: 25 });
    expect(skipped).toEqual(expect.arrayContaining(["age", "english"]));
  });
  it("every template compiles without missing = fail and parses as valid selection_rules", () => {
    for (const t of TEMPLATES) {
      const { patch } = applyTemplate(onfidoRow({ skillsRequired: null }), t.id, { replaceFilled: true });
      expect(parseSelectionRules(patch.selectionRules).ok, t.id).toBe(true);
      const c = compileCriteria({ ...onfidoRow({ skillsRequired: null }), ...patch });
      for (const r of c.rules) {
        expect(r.missing, `${t.id} ${r.key}`).not.toBe("fail");
        for (const v of Object.values(r.missingBySource ?? {})) expect(v).not.toBe("fail");
      }
    }
  });
  it("unknown template id throws", () => {
    expect(() => applyTemplate(onfidoRow(), "nope", { replaceFilled: false })).toThrow(/template/);
  });
});
