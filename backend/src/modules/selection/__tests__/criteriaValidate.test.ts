import { describe, expect, it } from "vitest";
import { validateCriteria } from "../criteria-validate.js";
import type { SelectionRules } from "../selection-types.js";
import { onfidoRow } from "./fixtures/rows.js";

const sr = (rules: SelectionRules["rules"]): SelectionRules => ({ schema: 1, rules });
const errors = (o: Parameters<typeof onfidoRow>[0]) => validateCriteria(onfidoRow(o)).filter((i) => i.level === "error").map((i) => i.text).join(" | ");
const warnings = (o: Parameters<typeof onfidoRow>[0]) => validateCriteria(onfidoRow(o)).filter((i) => i.level === "warning").map((i) => i.text).join(" | ");

describe("validation errors", () => {
  it("clean row has no issues", () => expect(validateCriteria(onfidoRow())).toEqual([]));
  it("age min > max", () => expect(errors({ ageMin: 40, ageMax: 30 })).toMatch(/age.*40.*30/i));
  it("age band entirely under 18", () => expect(errors({ ageMin: 14, ageMax: 17 })).toMatch(/under 18/));
  it("experience min > max", () => expect(errors({ experienceMinYears: 5, experienceMaxYears: 2 })).toMatch(/experience/i));
  it("salary min > max", () => expect(errors({ salaryMin: 30000, salaryMax: 20000 })).toMatch(/salary/i));
  it("radius out of range", () => {
    expect(errors({ radiusKm: 0 })).toMatch(/radius/i);
    expect(errors({ radiusKm: 250 })).toMatch(/radius/i);
  });
  it("every source excluded", () => expect(errors({ selectionRules: sr({ sources: { mode: "must", value: { exclude: ["meta_live", "meta_old", "he"] } } }) })).toMatch(/every source/));
  it("same employer in include and exclude", () => expect(errors({ selectionRules: sr({ employer_include: { mode: "prefer", weight: 5, value: ["Acme"] }, employer_exclude: { mode: "must", value: ["acme"] } }) })).toMatch(/include and exclude/));
  it("a target city outside the branch area while lives-in-branch-area is MUST", () => {
    expect(errors({ targetLocations: ["Noida", "Surat"], selectionRules: sr({ location_region: { mode: "must" } }) })).toMatch(/Surat/);
    expect(errors({ targetLocations: ["Noida", "Surat"] })).toBe("");
  });
  it("night shift MUST with day-only shift text", () => {
    expect(errors({ nightShiftRequired: 1, shiftRequirement: "Day shift 9am" })).toMatch(/day/i);
    expect(errors({ nightShiftRequired: 1, shiftRequirement: "Day and night rotational" })).toBe("");
  });
  it("certificate MUST with an unknown certificate code", () => expect(errors({ screeningConfig: { certifications: ["XYZ"] } as never })).toMatch(/XYZ/));
  it("form answer rule with an empty field", () => expect(errors({ screeningConfig: { custom_field_rules: [{ field: " ", op: "is_yes", value: "" }] } as never })).toMatch(/form answer/i));
  it("a MUST rule whose value is blank", () => expect(errors({ selectionRules: sr({ education_min: { mode: "must" } }) })).toMatch(/education.*no value/i));
});

describe("validation warnings", () => {
  it("every MUST rule lets missing data pass", () => expect(warnings({ ageMin: 18, educationRequirement: "12th", selectionRules: sr({ age: { mode: "must", missing: "pass" }, education_min: { mode: "must", missing: "pass" } }) })).toMatch(/every MUST/i));
  it("experience min above what the age band allows", () => expect(warnings({ experienceMinYears: 10, ageMax: 25 })).toMatch(/experience/i));
  it("typing above 60 wpm", () => expect(warnings({ screeningConfig: { min_typing_speed_wpm: 70 } as never })).toMatch(/typing/i));
  it("more than 10 skills with all", () => expect(warnings({ skillsRequired: "a,b,c,d,e,f,g,h,i,j,k", selectionRules: sr({ skills: { mode: "prefer", weight: 5, value: { match: "all" } } }) })).toMatch(/skills/i));
  it("DRA on a non-collections process", () => {
    expect(warnings({ screeningConfig: { certifications: ["DRA"] } as never })).toMatch(/DRA/);
    expect(warnings({ processName: "SBI Credit Cards Collections", screeningConfig: { certifications: ["DRA"] } as never })).toBe("");
  });
  it("notice period MUST (low coverage)", () => expect(warnings({ selectionRules: sr({ notice_period: { mode: "must", value: { maxDays: 30 } } }) })).toMatch(/notice/i));
  it("age MUST with missing review while Live Meta campaigns run", () => {
    expect(warnings({ ageMin: 18, hasLiveMetaCampaign: true, selectionRules: sr({ age: { mode: "must", missing: "review" } }) })).toMatch(/Meta/);
    expect(warnings({ ageMin: 18, hasLiveMetaCampaign: true, selectionRules: sr({ age: { mode: "must", missing: "review", missingBySource: { meta_live: "pass" } } }) })).toBe("");
  });
  it("selection_rules warnings pass through", () => expect(warnings({ selectionRules: sr({ skills: { mode: "prefer", weight: 0 } }) })).toMatch(/no effect/));
});
