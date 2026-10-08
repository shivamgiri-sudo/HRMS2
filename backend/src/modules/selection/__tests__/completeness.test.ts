import { describe, expect, it } from "vitest";
import { compileCriteria } from "../compile-criteria.js";
import { applyTemplate } from "../templates.js";
import { onfidoRow } from "./fixtures/rows.js";

describe("completeness", () => {
  it("skills + salary + default sources = 24, incomplete", () => {
    const c = compileCriteria(onfidoRow());
    expect(c.completeness.score).toBe(24);
    expect(c.completeness.missing).toEqual(expect.arrayContaining(["location_cities", "education_min", "night_shift", "age", "experience", "english", "typing", "notice_period"]));
  });

  it("the four S-O6 facts make it enrolment ready; >= 80 with the rest is complete", () => {
    const ready = compileCriteria(onfidoRow({ targetLocations: ["Noida"], educationRequirement: "12th", nightShiftRequired: 1, ageMin: 18, ageMax: 35 }));
    expect(ready.completeness.enrolmentReady).toBe(true);
    expect(ready.completeness.score).toBe(84);
    expect(ready.completeness.label).toBe("complete");
  });

  it("shift text alone decides shift; rotational alone decides shift", () => {
    expect(compileCriteria(onfidoRow({ shiftRequirement: "Day 9 to 6" })).decided).toContain("night_shift");
    expect(compileCriteria(onfidoRow({ rotationalShift: 1 })).decided).toContain("night_shift");
  });

  it("partial between 40 and 80, or >= 80 while not enrolment ready", () => {
    const c = compileCriteria(onfidoRow({ targetLocations: ["Noida"], educationRequirement: "12th", experienceMinYears: 0 }));
    expect(c.completeness.score).toBe(62);
    expect(c.completeness.label).toBe("partial");
  });

  it("a template that asks for a certificate brings its weight back and rescales to 100", () => {
    const row = onfidoRow({ skillsRequired: null });
    const { patch } = applyTemplate(row, "dra_collections", { replaceFilled: true });
    const full = compileCriteria({ ...row, ...patch, skillsRequired: "Collections" });
    const withoutCert = compileCriteria({ ...row, ...patch, skillsRequired: "Collections", screeningConfig: { ...(patch.screeningConfig ?? {}), certifications: [] } as never,
      selectionRules: { ...patch.selectionRules!, rules: { ...patch.selectionRules!.rules, certificate: undefined } } });
    expect(withoutCert.completeness.missing).toContain("certificate");
    // decided: location 15, education 15, age 15, experience 8, salary 8, skills 8, sources 8, certificate 4 = 81 of 104
    expect(full.completeness.score).toBe(Math.round((81 / 104) * 100));
    expect(withoutCert.completeness.score).toBe(Math.round((77 / 104) * 100));
  });

  it("without a certificate template, certificate never appears in missing", () => {
    expect(compileCriteria(onfidoRow()).completeness.missing).not.toContain("certificate");
  });
});
