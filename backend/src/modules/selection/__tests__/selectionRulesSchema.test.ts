import { describe, expect, it } from "vitest";
import { RULE_CATALOGUE, catalogueEntry } from "../rule-catalogue.js";
import { emptySelectionRules, parseSelectionRules, resolveMissing } from "../selection-rules.schema.js";
import { RULE_KEYS, SUB_SOURCES } from "../selection-types.js";

const rules = (r: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ schema: 1, rules: r, ...extra });
const errorsOf = (raw: unknown) => {
  const p = parseSelectionRules(raw);
  return p.ok ? [] : p.errors;
};
const warningsOf = (raw: unknown) => {
  const p = parseSelectionRules(raw);
  if (!p.ok) throw new Error(`expected ok, got ${p.errors.join("; ")}`);
  return p.warnings;
};

describe("parseSelectionRules: plan cases", () => {
  it("null and undefined are legacy (ok, empty)", () => {
    for (const raw of [null, undefined]) {
      const p = parseSelectionRules(raw);
      expect(p).toMatchObject({ ok: true, legacy: true, value: emptySelectionRules() });
    }
  });
  it("an unknown rule key is an error", () => {
    expect(errorsOf(rules({ shoe_size: { mode: "must" } })).join()).toMatch(/shoe_size/);
  });
  it("weight 80 is an error", () => {
    expect(errorsOf(rules({ skills: { mode: "prefer", weight: 80 } })).join()).toMatch(/weight/);
  });
  it("missing: fail is accepted (an explicit HR choice)", () => {
    const p = parseSelectionRules(rules({ education_min: { mode: "must", missing: "fail" } }));
    expect(p.ok).toBe(true);
  });
  it("missingBySource with an unknown source is an error", () => {
    expect(errorsOf(rules({ age: { mode: "must", missingBySource: { linkedin: "pass" } } })).join()).toMatch(/linkedin/);
  });
  it("schema other than 1 is rejected", () => {
    expect(errorsOf({ schema: 2, rules: {} }).join()).toMatch(/schema/);
  });
  it("a JSON string (as mysql2 may return it) parses; broken JSON is an error", () => {
    expect(parseSelectionRules(JSON.stringify(rules({ skills: { mode: "prefer", weight: 5 } }))).ok).toBe(true);
    expect(errorsOf("{not json").join()).toMatch(/JSON/);
  });
  it("unknown top-level and rule-setting fields are errors", () => {
    expect(errorsOf(rules({}, { extra: 1 })).join()).toMatch(/extra/);
    expect(errorsOf(rules({ skills: { mode: "prefer", colour: "red" } })).join()).toMatch(/colour/);
  });
});

describe("rule catalogue", () => {
  it("covers every rule key exactly once with a label, ops and a completeness weight", () => {
    expect(RULE_CATALOGUE.map((e) => e.key).sort()).toEqual([...RULE_KEYS].sort());
    for (const e of RULE_CATALOGUE) {
      expect(e.label.trim().length).toBeGreaterThan(0);
      expect(e.ops.length).toBeGreaterThan(0);
      expect(Number.isInteger(e.completenessWeight)).toBe(true);
    }
  });
  it("completeness weights sum to 100 and sit on the S-O6 keys", () => {
    expect(RULE_CATALOGUE.reduce((s, e) => s + e.completenessWeight, 0)).toBe(100);
    for (const k of ["location_cities", "education_min", "night_shift", "age"] as const) expect(catalogueEntry(k).completenessWeight).toBe(15);
  });
  it("no catalogue default rejects on missing data (unknown never silently rejects)", () => {
    for (const e of RULE_CATALOGUE) {
      expect(e.defaultMissing).not.toBe("fail");
      for (const v of Object.values(e.defaultMissingBySource ?? {})) expect(v).not.toBe("fail");
    }
  });
  it("salary (budget) is the only value locked after approval", () => {
    expect(RULE_CATALOGUE.filter((e) => !e.editableAfterApproval).map((e) => e.key)).toEqual(["salary_fit"]);
  });
  it("default values of value-rules parse", () => {
    for (const e of RULE_CATALOGUE) {
      if (e.defaultValue === undefined) continue;
      expect(parseSelectionRules(rules({ [e.key]: { mode: e.defaultMode === "off" ? "must" : e.defaultMode, value: e.defaultValue, ...(e.defaultMode === "prefer" ? { weight: 5 } : {}) } })).ok, e.key).toBe(true);
    }
  });
});

describe("contradictory or impossible rules", () => {
  it("the same employer in include and exclude (case and spacing ignored)", () => {
    const e = errorsOf(rules({ employer_include: { mode: "prefer", weight: 10, value: ["Teleperformance"] }, employer_exclude: { mode: "must", value: [" teleperformance "] } }));
    expect(e.join()).toMatch(/teleperformance.*include and exclude/i);
  });
  it("every source excluded", () => {
    expect(errorsOf(rules({ sources: { mode: "must", value: { exclude: ["meta_live", "meta_old", "he"] } } })).join()).toMatch(/every source/);
  });
  it("a MUST rule with a weight", () => {
    expect(errorsOf(rules({ age: { mode: "must", weight: 10 } })).join()).toMatch(/weight.*PREFER/);
  });
  it("a PREFER rule that would reject on missing data", () => {
    expect(errorsOf(rules({ skills: { mode: "prefer", weight: 5, missing: "fail" } })).join()).toMatch(/PREFER.*cannot reject/);
    expect(errorsOf(rules({ skills: { mode: "prefer", weight: 5, missingBySource: { naukri_import: "fail" } } })).join()).toMatch(/PREFER.*cannot reject/);
  });
  it("a rule that is on but marked not decided", () => {
    expect(errorsOf(rules({ age: { mode: "must", decided: false } })).join()).toMatch(/decided/);
  });
  it("excluding former employees as a preference", () => {
    expect(errorsOf(rules({ ex_employee: { mode: "prefer", weight: 5, value: "exclude" } })).join()).toMatch(/ex_employee/);
  });
  it("a yes/no rule switched on with value false", () => {
    expect(errorsOf(rules({ valid_email: { mode: "must", value: false } })).join()).toMatch(/turn the rule off/);
    expect(errorsOf(rules({ relocation_ok: { mode: "must", value: false } })).join()).toMatch(/turn the rule off/);
  });
  it("skills 'at least' needs n; n only with 'at least'", () => {
    expect(errorsOf(rules({ skills: { mode: "prefer", weight: 5, value: { match: "at_least" } } })).join()).toMatch(/at least/);
    expect(errorsOf(rules({ skills: { mode: "prefer", weight: 5, value: { match: "any", n: 2 } } })).join()).toMatch(/at least/);
  });
  it("a value on a column-backed rule (the column is the truth)", () => {
    expect(errorsOf(rules({ education_min: { mode: "must", value: "Graduate" } })).join()).toMatch(/column/);
  });
  it("a value-rule switched on without its value", () => {
    expect(errorsOf(rules({ notice_period: { mode: "prefer", weight: 5 } })).join()).toMatch(/needs a value/);
  });
  it("impossible numbers", () => {
    expect(errorsOf(rules({ notice_period: { mode: "must", value: { maxDays: -1 } } }))).not.toEqual([]);
    expect(errorsOf(rules({ salary_fit: { mode: "prefer", weight: 5, value: { maxRatio: 0.5 } } }))).not.toEqual([]);
    expect(errorsOf(rules({ contact_recent: { mode: "must", value: { days: 0 } } }))).not.toEqual([]);
    expect(errorsOf(rules({}, { enrolment: { mode: "hr_approves", standingApprovalDays: 400 } }))).not.toEqual([]);
  });
  it("order with an unknown or repeated key", () => {
    expect(errorsOf(rules({}, { order: ["age", "age"] })).join()).toMatch(/twice/);
    expect(errorsOf(rules({}, { order: ["age", "height"] })).join()).toMatch(/height/);
  });
  it("blank list entries", () => {
    expect(errorsOf(rules({ education_stream: { mode: "prefer", weight: 5, value: ["commerce", " "] } }))).not.toEqual([]);
  });
});

describe("warnings (saved, but shown)", () => {
  it("PREFER with weight 0 has no effect", () => {
    expect(warningsOf(rules({ skills: { mode: "prefer", weight: 0 } })).join()).toMatch(/no effect/);
  });
  it("a missing policy on a PREFER rule is ignored", () => {
    expect(warningsOf(rules({ skills: { mode: "prefer", weight: 5, missing: "review" } })).join()).toMatch(/ignored/);
  });
});

describe("resolveMissing (most specific wins; HR before catalogue)", () => {
  const age = catalogueEntry("age");
  it("catalogue default, then catalogue per-source default", () => {
    expect(resolveMissing("age", undefined, "naukri_import", "he")).toBe(age.defaultMissing);
    expect(resolveMissing("age", undefined, "meta_live", "meta_live")).toBe("pass");
  });
  it("HR general setting beats the catalogue per-source default", () => {
    expect(resolveMissing("age", { mode: "must", missing: "review" }, "meta_live", "meta_live")).toBe("review");
  });
  it("HR per sub-source beats per kind beats general", () => {
    const s = { mode: "must" as const, missing: "review" as const, missingBySource: { he: "pass" as const, naukri_import: "fail" as const } };
    expect(resolveMissing("experience", s, "naukri_import", "he")).toBe("fail");
    expect(resolveMissing("experience", s, "workindia_import", "he")).toBe("pass");
    expect(resolveMissing("experience", s, "meta_old", "meta_old")).toBe("review");
  });
  it("every sub-source resolves for every key", () => {
    for (const k of RULE_KEYS) for (const sub of SUB_SOURCES) expect(["review", "fail", "pass"]).toContain(resolveMissing(k, undefined, sub, "he"));
  });
});
