import { describe, expect, it } from "vitest";
import { applyPatch } from "../criteria.service.js";
import { compileCriteria } from "../compile-criteria.js";
import { validateCriteria } from "../criteria-validate.js";
import { patchFromSuggestions, suggestFromText, type JdRequisition, type JdSuggestion } from "../jd-suggestions.js";
import { onfidoRow } from "./fixtures/rows.js";
import { readFileSync } from "node:fs";

interface RealRow {
  code: string; branchName: string; processName: string; approvalStatus: string; activeStatus: number; educationRequirement: string | null; skillsRequired: string | null;
  jobDescription: string | null; shiftRequirement: string | null; nightShiftRequired: number; rotationalShift: number; screeningConfig: unknown; businessJustification: string | null;
}
const real = JSON.parse(readFileSync(new URL("./fixtures/jd-requisition-texts.json", import.meta.url), "utf8")) as { rows: RealRow[] };
const row = (o: Partial<JdRequisition> = {}): JdRequisition => ({ ...onfidoRow({ skillsRequired: null, approvalStatus: "approved" }), jobDescription: null, businessJustification: null, ...o });
const fromReal = (r: RealRow): JdRequisition => row({
  id: r.code, code: r.code, branchName: r.branchName, branchCity: r.branchName.startsWith("AHMEDABAD") ? "Ahmedabad" : "Noida", processName: r.processName, approvalStatus: r.approvalStatus,
  educationRequirement: r.educationRequirement, skillsRequired: r.skillsRequired, jobDescription: r.jobDescription, shiftRequirement: r.shiftRequirement,
  nightShiftRequired: r.nightShiftRequired, rotationalShift: r.rotationalShift, screeningConfig: r.screeningConfig as JdRequisition["screeningConfig"], businessJustification: r.businessJustification,
});
const realRow = (code: string) => fromReal(real.rows.find((r) => r.code === code)!);
/** key mode value matched: the compact view the assertions use. */
const brief = (s: JdSuggestion) => `${s.key} ${s.mode.toUpperCase()} ${JSON.stringify(s.value)} <${s.matched}>`;
const briefs = (r: JdRequisition) => suggestFromText(r).suggestions.map(brief);

describe("the 9 approved + active requisitions on prod (real texts)", () => {
  it("AHMEDABAD-SBI-1: no text, so nothing to suggest (its DRA config stays as it is)", () => {
    expect(suggestFromText(realRow("AHMEDABAD-SBI-1"))).toEqual({ suggestions: [], unparsed: [], skipped: [] });
  });
  it.each(["NOIDA-Onfido-17", "NOIDA-Onfido-18"])("%s 'Graduation with good typing speed': graduate MUST, typing PREFER without a number", (code) => {
    const out = suggestFromText(realRow(code));
    expect(out.suggestions.map(brief)).toEqual([
      'education_min MUST {"level":"Graduate"} <Graduation>',
      'typing PREFER {"wpm":null} <good typing speed>',
    ]);
    expect(out.suggestions[0]).toMatchObject({ phrase: "Graduation with good typing speed", field: "skills_required", confidence: "high" });
    expect(out.suggestions[1]).toMatchObject({ needs: "wpm", confidence: "medium" });
    expect(out.unparsed).toEqual([]);
  });
  it.each(["NOIDA-Onfido-20", "NOIDA-Onfido-21", "NOIDA-Onfido-22", "NOIDA-Onfido-23", "NOIDA-Onfido-24"])("%s 'Graduation with good typing skills'", (code) => {
    expect(briefs(realRow(code)).map((b) => b.toLowerCase())).toEqual([
      'education_min must {"level":"graduate"} <graduation>',
      'typing prefer {"wpm":null} <good typing skills>',
    ]);
  });
  it("REQ-2608-LRD0: sales MUST, English and Hindi PREFER, immediate joiner, and 'Age Criteria : 28 yrs' from the justification", () => {
    const out = suggestFromText(realRow("REQ-2608-LRD0"));
    expect(out.suggestions.map(brief)).toEqual([
      'skills MUST {"keyword":"Sales"} <hardcore sales background>',
      'english PREFER {"level":"basic"} <Comfortable with english>',
      'languages PREFER {"languages":["Hindi"]} <hindi>',
      'notice_period PREFER {"maxDays":0} <Immediate Joiner>',
      'age MUST {"min":null,"max":28} <Age Criteria : 28 yrs>',
    ]);
    expect(out.suggestions.find((s) => s.key === "age")).toMatchObject({ field: "business_justification", confidence: "low" });
    expect(out.unparsed).toEqual([{ field: "business_justification", phrase: "Married Not allowed", reason: "Marital status is not a selection rule" }]);
  });
});

describe("other approved and closed requisitions (real texts)", () => {
  it("every real text gives a stable, bounded answer and never a number that is not in the text", () => {
    for (const r of real.rows) {
      const a = suggestFromText(fromReal(r));
      expect(suggestFromText(fromReal(r))).toEqual(a);
      const text = [r.skillsRequired, r.jobDescription, r.shiftRequirement, r.businessJustification].join("\n");
      for (const s of a.suggestions) {
        expect(text).toContain(s.phrase);
        for (const n of JSON.stringify(s.value).match(/\d+/g) ?? []) if (n !== "0") expect(text).toContain(n);
      }
    }
  });
  it("REQ-2608-6E4V: communication PREFER, graduate MUST, the rest reported as not understood", () => {
    const out = suggestFromText(realRow("REQ-2608-6E4V"));
    expect(out.suggestions.map(brief)).toEqual([
      'skills PREFER {"keyword":"Communication"} <Good Comm Skills>',
      'education_min MUST {"level":"Graduate"} <graduated>',
      'skills PREFER {"keyword":"Non-voice"} <Non-Voice>',
    ]);
    expect(out.unparsed).toEqual([{ field: "skills_required", phrase: "Punctual towards the basics", reason: "No matching rule; it stays in the Skills text as written" }]);
  });
  it("REQ-2609-DZCV: education already decided (12th pass) is skipped; rotational shift from the justification", () => {
    const out = suggestFromText(realRow("REQ-2609-DZCV"));
    expect(out.suggestions.map(brief)).toEqual([
      'skills PREFER {"keyword":"Communication"} <Good Communication skills>',
      'rotational_shift PREFER {} <rotational and 24*7 shift>',
      'skills PREFER {"keyword":"Voice process"} <Voice>',
      'skills PREFER {"keyword":"Non-voice"} <Non-Voice>',
    ]);
    expect(out.suggestions.some((s) => s.key === "education_min")).toBe(false);
  });
  it("REQ-2607-05ZI: 'required' after the words makes them MUST", () => {
    expect(briefs(realRow("REQ-2607-05ZI"))).toEqual([
      'skills MUST {"keyword":"Communication"} <Good comm skills>',
      'skills MUST {"keyword":"Sales"} <Sales skills>',
    ]);
  });
  it("REQ-2609-KQ6M: 'rotational week offs' is not a shift; 'rotational Shift' is", () => {
    const b = briefs(realRow("REQ-2609-KQ6M"));
    expect(b.filter((x) => x.startsWith("rotational_shift"))).toEqual(["rotational_shift PREFER {} <rotational Shift>"]);
  });
  it("REQ-2608-7A3V: markdown bullets are read as plain text", () => {
    expect(briefs(realRow("REQ-2608-7A3V"))).toEqual(['skills PREFER {"keyword":"Communication"} <Excellent communication skills>', 'skills PREFER {"keyword":"Non-voice"} <Non-Voice>']);
  });
  it("REQ-2609-K7BK: Meta form rules are not structured criteria, so graduate is still suggested", () => {
    expect(briefs(realRow("REQ-2609-K7BK"))[0]).toBe('education_min MUST {"level":"Graduate"} <Graduation>');
  });
  it("test texts are honestly reported, not guessed", () => {
    expect(suggestFromText(realRow("REQ-2607-CYIL"))).toEqual({ suggestions: [], skipped: [], unparsed: [{ field: "skills_required", phrase: "test", reason: "No matching rule; it stays in the Skills text as written" }] });
  });
});

describe("rules of the parser", () => {
  it("no text: no output", () => {
    for (const t of [null, "", "   ", "\n\n", "-", "*"]) expect(suggestFromText(row({ skillsRequired: t, jobDescription: t, businessJustification: t }))).toEqual({ suggestions: [], unparsed: [], skipped: [] });
  });
  it("case and punctuation do not matter", () => {
    for (const t of ["GRADUATE!!", "graduate.", "Graduate;", "  graduation  ", "Grad"]) expect(briefs(row({ skillsRequired: t }))[0]).toMatch(/^education_min MUST \{"level":"Graduate"\}/);
  });
  it("explicit must / soft words / unclear", () => {
    expect(briefs(row({ jobDescription: "Graduate preferred" }))).toEqual(['education_min PREFER {"level":"Graduate"} <Graduate>']);
    expect(briefs(row({ jobDescription: "Typing 30 wpm mandatory" }))).toEqual(['typing MUST {"wpm":30} <Typing 30 wpm>']);
    expect(briefs(row({ jobDescription: "DRA certificate" }))).toEqual(['certificate PREFER {"codes":["DRA"]} <DRA certificate>']);
    expect(briefs(row({ jobDescription: "DRA certificate is must" }))).toEqual(['certificate MUST {"codes":["DRA"]} <DRA certificate>']);
    expect(briefs(row({ jobDescription: "Graduation not mandatory" }))).toEqual(['education_min PREFER {"level":"Graduate"} <Graduation>']);
  });
  it("education levels, the lowest of alternatives", () => {
    expect(briefs(row({ jobDescription: "12th pass" }))).toEqual(['education_min MUST {"level":"12th"} <12th pass>']);
    expect(briefs(row({ jobDescription: "Post graduate (MBA)" }))[0]).toBe('education_min MUST {"level":"Post Graduate"} <Post graduate>');
    expect(briefs(row({ jobDescription: "12th pass or graduate" }))).toEqual(['education_min MUST {"level":"12th"} <12th pass>']);
    expect(briefs(row({ jobDescription: "UG / 10th" }))).toEqual(['education_min MUST {"level":"10th"} <10th>']);
  });
  it("Hindi-English mixes", () => {
    expect(briefs(row({ jobDescription: "12th pass hona chahiye, graduation zaroori nahi" }))).toEqual(['education_min MUST {"level":"12th"} <12th pass>']);
    expect(briefs(row({ jobDescription: "English bolna aana chahiye" }))).toEqual(['languages PREFER {"languages":["English"]} <English>']);
    expect(briefs(row({ jobDescription: "raat ki shift" }))).toEqual(["night_shift PREFER {} <raat ki shift>"]);
    expect(briefs(row({ jobDescription: "umar 18 se 30" }))).toEqual(['age PREFER {"min":18,"max":30} <umar 18 se 30>']);
    expect(briefs(row({ jobDescription: "typing achi honi chahiye" }))).toEqual(['typing PREFER {"wpm":null} <typing achi>']);
  });
  it("numbers only when the text has them", () => {
    expect(briefs(row({ jobDescription: "typing speed 25+ wpm" }))).toEqual(['typing PREFER {"wpm":25} <typing speed 25+ wpm>']);
    expect(briefs(row({ jobDescription: "2-4 years experience in BPO" }))).toEqual(['experience PREFER {"min":2,"max":4} <2-4 years experience>', 'skills PREFER {"keyword":"BPO"} <BPO>']);
    expect(briefs(row({ jobDescription: "Minimum 1 year experience" }))).toEqual(['experience MUST {"min":1,"max":null} <Minimum 1 year experience>']);
    expect(briefs(row({ jobDescription: "Experienced only" }))).toEqual(['experience MUST {"min":null,"max":null} <Experienced>']);
    expect(suggestFromText(row({ jobDescription: "Experienced only" })).suggestions[0].needs).toBe("years");
    expect(briefs(row({ jobDescription: "Age 18-35" }))).toEqual(['age PREFER {"min":18,"max":35} <Age 18-35>']);
    expect(briefs(row({ jobDescription: "age below 30" }))).toEqual(['age PREFER {"min":null,"max":29} <age below 30>']);
    expect(briefs(row({ jobDescription: "Max age 35 years" }))).toEqual(['age PREFER {"min":null,"max":35} <Max age 35>']);
    expect(suggestFromText(row({ jobDescription: "2 years" }))).toEqual({ suggestions: [], skipped: [], unparsed: [{ field: "job_description", phrase: "2 years", reason: "Not understood" }] });
  });
  it("freshers", () => {
    expect(briefs(row({ jobDescription: "Freshers welcome" }))).toEqual(["experience OFF {} <Freshers welcome>"]);
    expect(briefs(row({ jobDescription: "Fresher or experienced both can apply" }))).toEqual(["experience OFF {} <Fresher or experienced>"]);
    expect(briefs(row({ jobDescription: "Freshers only" }))).toEqual(['experience MUST {"min":null,"max":0} <Freshers only>']);
  });
  it("contradictions are reported, never resolved by guessing", () => {
    const out = suggestFromText(row({ skillsRequired: "Freshers only", jobDescription: "3 years experience required" }));
    expect(out.suggestions).toEqual([]);
    expect(out.unparsed.map((u) => [u.phrase, u.reason])).toEqual([
      ["Freshers only", 'Contradicts "3 years experience required"'],
      ["3 years experience required", 'Contradicts "Freshers only"'],
    ]);
    const shift = suggestFromText(row({ skillsRequired: "Night shift", jobDescription: "Day shift only" }));
    expect(shift.suggestions).toEqual([]);
    expect(shift.unparsed).toHaveLength(2);
  });
  it("shifts", () => {
    expect(briefs(row({ shiftRequirement: "Night" }))).toEqual(["night_shift MUST {} <Night>"]);
    expect(briefs(row({ jobDescription: "US shift" }))).toEqual(["night_shift PREFER {} <US shift>"]);
    expect(briefs(row({ jobDescription: "Day shift only" }))).toEqual([`night_shift OFF {"shift":"Day"} <Day shift>`]);
    expect(briefs(row({ jobDescription: "6 days working with rotational week off" }))).toEqual([]);
  });
  it("cities: residence words make a rule; the branch's own city as job location does not", () => {
    expect(briefs(row({ jobDescription: "Candidates from Noida/Ghaziabad only" }))).toEqual(['location_cities MUST {"cities":["Noida","Ghaziabad"]} <Noida/Ghaziabad>']);
    expect(suggestFromText(row({ jobDescription: "Job location: Noida" })).suggestions).toEqual([]);
    expect(suggestFromText(row({ jobDescription: "Job location: Pune" })).unparsed).toEqual([{ field: "job_description", phrase: "Job location: Pune", reason: "The job location is not the branch city (Noida)" }]);
  });
  it("certificates: known codes are suggested, unknown codes are reported", () => {
    expect(briefs(row({ jobDescription: "NISM certified" }))).toEqual(['certificate PREFER {"codes":["NISM"]} <NISM certified>']);
    expect(suggestFromText(row({ jobDescription: "CFA certified" })).unparsed).toEqual([{ field: "job_description", phrase: "CFA certified", reason: "CFA is not a certificate the screening can check" }]);
  });
  it("gender is never suggested", () => {
    expect(suggestFromText(row({ jobDescription: "Female candidates only" }))).toEqual({ suggestions: [], skipped: [], unparsed: [{ field: "job_description", phrase: "Female candidates only", reason: "Gender is set only where the client contract requires it (criteria editor)" }] });
  });
  it("skips what the structured fields already decide, and says so", () => {
    const out = suggestFromText(row({ educationRequirement: "12th", nightShiftRequired: 1, screeningConfig: { certifications: ["DRA"], min_typing_speed_wpm: 30 }, jobDescription: "Graduate, night shift, DRA certified, typing 40 wpm" }));
    expect(out.suggestions).toEqual([]);
    expect(out.skipped.map((s) => s.key)).toEqual(["education_min", "night_shift", "certificate", "typing"]);
    expect(suggestFromText(row({ selectionRules: { schema: 1, rules: { age: { mode: "off", decided: true } } }, jobDescription: "Age 18-30" })).suggestions).toEqual([]);
  });
  it("very long text: bounded and still read", () => {
    const long = `${"lorem ipsum dolor sit amet. ".repeat(1500)}\nGraduate`;
    const t = Date.now();
    const out = suggestFromText(row({ jobDescription: long }));
    expect(Date.now() - t).toBeLessThan(1500);
    expect(out.unparsed).toEqual([{ field: "job_description", phrase: "lorem ipsum dolor sit amet", reason: "Not understood" }]);
    expect(out.suggestions.map(brief)).toEqual(['education_min MUST {"level":"Graduate"} <Graduate>']);
    // beyond 50,000 characters a field is not read
    expect(suggestFromText(row({ jobDescription: `${"x ".repeat(30_000)}\nGraduate` })).suggestions).toEqual([]);
  });
  it("ids are stable per text and differ when the text changes", () => {
    const a = suggestFromText(row({ skillsRequired: "Graduation with good typing speed" })).suggestions;
    const b = suggestFromText(row({ skillsRequired: "Graduation with good typing speed", id: "other" })).suggestions;
    const c = suggestFromText(row({ skillsRequired: "Graduation with very good typing speed" })).suggestions;
    expect(a.map((s) => s.id)).toEqual(b.map((s) => s.id));
    expect(a[1].id).not.toBe(c[1].id);
    expect(new Set(a.map((s) => s.id)).size).toBe(a.length);
  });
});

describe("patchFromSuggestions (what accepting writes)", () => {
  const apply = (r: JdRequisition, ids: string[] | "all", values: Record<string, number> = {}) => {
    const s = suggestFromText(r).suggestions;
    const picked = ids === "all" ? s : s.filter((x) => ids.includes(x.key));
    return patchFromSuggestions(r, picked, Object.fromEntries(picked.filter((p) => values[p.key] !== undefined).map((p) => [p.id, values[p.key]])));
  };
  it("Onfido: graduate + typing 25 (HR's number) becomes columns, config and rule modes", () => {
    const r = realRow("NOIDA-Onfido-17");
    const { patch, errors } = apply(r, "all", { typing: 25 });
    expect(errors).toEqual([]);
    expect(patch).toEqual({
      educationRequirement: "Graduate", screeningConfig: { min_typing_speed_wpm: 25 },
      selectionRules: { schema: 1, rules: { education_min: { mode: "must", decided: true }, typing: { mode: "prefer", decided: true, weight: 10 } } },
    });
    const next = applyPatch(r, patch);
    expect(validateCriteria(next).filter((i) => i.level === "error")).toEqual([]);
    const c = compileCriteria(next);
    expect(c.rules.find((x) => x.key === "education_min")).toMatchObject({ mode: "must" });
    expect(c.rules.find((x) => x.key === "typing")).toMatchObject({ mode: "prefer" });
    expect(next.screeningConfig).toEqual({ auto_notify: true, min_typing_speed_wpm: 25 });
  });
  it("a suggestion without a number cannot be accepted without HR's value", () => {
    const { errors } = apply(realRow("NOIDA-Onfido-17"), ["typing"]);
    expect(errors).toEqual(["Typing speed needs a number (wpm): the text gives none"]);
    expect(apply(realRow("NOIDA-Onfido-17"), ["typing"], { typing: 500 }).errors).toEqual(["Typing speed must be between 10 and 120 wpm"]);
  });
  it("after accepting, the same text suggests nothing more for those rules (idempotent)", () => {
    const r = realRow("REQ-2608-LRD0");
    const { patch, errors } = apply(r, "all");
    expect(errors).toEqual([]);
    const next = { ...r, ...applyPatch(r, patch) };
    expect(suggestFromText(next).suggestions).toEqual([]);
    expect(next.skillsRequired).toBe("Must be hardcore sales background\nComfortable with english and hindi\nImmediate Joiner\nSales");
    expect(next.screeningConfig).toEqual({ written_english_level: "basic", language_requirements: [{ language: "Hindi", skills: ["speak"] }] });
    expect(next.selectionRules?.rules.skills).toEqual({ mode: "must", decided: true, value: { match: "any" } });
    expect(next.selectionRules?.rules.notice_period).toEqual({ mode: "prefer", decided: true, weight: 5, value: { maxDays: 0 } });
    expect(next.ageMax).toBe(28);
  });
  it("night shift from the shift text sets the flag; day shift decides 'no night shift'", () => {
    const n = apply(row({ shiftRequirement: "Night" }), "all").patch;
    expect(n).toEqual({ nightShiftRequired: 1, selectionRules: { schema: 1, rules: { night_shift: { mode: "must", decided: true } } } });
    const d = apply(row({ jobDescription: "Day shift only" }), "all").patch;
    expect(d).toEqual({ shiftRequirement: "Day", selectionRules: { schema: 1, rules: { night_shift: { mode: "off", decided: true } } } });
  });
  it("existing rules and config are kept; lists are merged", () => {
    const r = row({ targetLocations: null, screeningConfig: { auto_notify: true, certifications: ["IRDA"], language_requirements: [{ language: "English", skills: ["speak"] }] },
      selectionRules: { schema: 1, rules: { age: { mode: "must", decided: true } } }, ageMin: 18, ageMax: 30, jobDescription: "DRA certificate mandatory. Hindi speaking. Candidates from Noida" });
    const { patch } = apply(r, "all");
    expect(patch.screeningConfig).toEqual({ certifications: ["IRDA", "DRA"], language_requirements: [{ language: "English", skills: ["speak"] }, { language: "Hindi", skills: ["speak"] }] });
    expect(patch.targetLocations).toEqual(["Noida"]);
    expect(patch.selectionRules?.rules.age).toEqual({ mode: "must", decided: true });
    expect(patch.selectionRules?.rules.certificate).toEqual({ mode: "must", decided: true, value: { level: "declared" } });
  });
});
