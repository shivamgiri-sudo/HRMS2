import { describe, expect, it } from "vitest";
import { scoreLead } from "../../hiring-engine/he-matcher.js";
import { compileCriteria } from "../compile-criteria.js";
import { evaluate, explain } from "../evaluate.js";
import { baseFacts, compiled, NOW, ok, rule } from "./fixtures/facts.js";
import { onfidoRow } from "./fixtures/rows.js";

const AGE = rule("age", { min: 18, max: 35 });
const EDU = rule("education_min", { text: "12th", rank: 3, soft: false });
const NIGHT = rule("night_shift", {});

describe("combinations", () => {
  it("two MUST fails -> fail, both listed", () => {
    const e = evaluate(baseFacts({ age: ok(40), educationRank: ok(2) }), compiled([AGE, EDU]), NOW);
    expect(e.verdict).toBe("fail");
    expect(e.failed.map((r) => r.key)).toEqual(["age", "education_min"]);
  });
  it("one fail + one review -> fail, review reasons kept for display", () => {
    const e = evaluate(baseFacts({ age: ok(40) }), compiled([AGE, EDU]), NOW);
    expect(e.verdict).toBe("fail");
    expect(e.reviewReasons).toEqual(["Minimum qualification: unknown: not on record"]);
  });
  it("only reviews -> review", () => {
    expect(evaluate(baseFacts(), compiled([AGE, EDU]), NOW).verdict).toBe("review");
  });
  it("a per-source missing override gives one person different verdicts in two sources", () => {
    const r = rule("age", { min: 18, max: 35 }, { missing: "review", missingBySource: { meta_live: "pass" } });
    expect(evaluate(baseFacts({ sourceKind: "meta_live", subSource: "meta_live" }), compiled([r]), NOW).verdict).toBe("pass");
    expect(evaluate(baseFacts({ sourceKind: "he", subSource: "naukri_import" }), compiled([r]), NOW).verdict).toBe("review");
    const sub = rule("age", { min: 18, max: 35 }, { missing: "pass", missingBySource: { he: "review", naukri_import: "fail" } });
    expect(evaluate(baseFacts({ subSource: "naukri_import" }), compiled([sub]), NOW).verdict).toBe("fail");
    expect(evaluate(baseFacts({ subSource: "candidate" }), compiled([sub]), NOW).verdict).toBe("review");
  });
  it("PREFER weights move the score, never the verdict", () => {
    const pref = rule("skills", { skills: ["excel"], match: "any" }, { mode: "prefer", weight: 20 });
    const yes = evaluate(baseFacts({ skillsText: ok("excel") }), compiled([pref]), NOW);
    const no = evaluate(baseFacts({ skillsText: ok("tally") }), compiled([pref]), NOW);
    const base = evaluate(baseFacts(), compiled([]), NOW).score;
    expect([yes.verdict, no.verdict]).toEqual(["pass", "pass"]);
    expect(yes.score).toBe(Math.min(100, base + 20));
    expect(no.score).toBe(Math.max(0, base - 10));
  });
  it("relocation turns 'elsewhere' into a pass only when the rule allows it and the person said so", () => {
    const facts = baseFacts({ locationText: ok("surat gujarat"), relocationOk: ok(true) });
    const req = { branchName: "NOIDA-2", branchCity: "Noida", branchState: "Uttar Pradesh" };
    expect(evaluate(facts, compiled([rule("location_region", { ...req, relocationOk: false })]), NOW).verdict).toBe("fail");
    expect(evaluate(facts, compiled([rule("location_region", { ...req, relocationOk: true })]), NOW).verdict).toBe("pass");
  });
  it("lives-in-these-cities: a listed city passes; another known place fails; a state or neighbourhood alone is unknown", () => {
    const r = rule("location_cities", { cities: ["Noida", "Ghaziabad"], relocationOk: false });
    const v = (t: string) => evaluate(baseFacts({ locationText: ok(t) }), compiled([r]), NOW);
    expect(v("sector 62 noida").verdict).toBe("pass");
    expect(v("surat gujarat").verdict).toBe("fail");
    expect(v("laxmi nagar delhi").verdict).toBe("fail"); // same region, but not a listed city
    expect(v("uttar pradesh").verdict).toBe("review");
    expect(v("uttar pradesh").unknown[0].actualText).toMatch(/names none of Noida, Ghaziabad/);
  });

  it("a verified certificate adds its bonus to the score", () => {
    const r = rule("certificate", { code: "DRA", level: "declared", verifiedBonus: 15 });
    const base = evaluate(baseFacts(), compiled([]), NOW).score;
    const e = evaluate(baseFacts({ certificates: ok([{ code: "DRA", level: "verified" as const }]) }), compiled([r]), NOW);
    expect(e.passed[0].effect).toBe("+15");
    expect(e.score).toBe(Math.min(100, base + 15));
  });
});

describe("system rules", () => {
  it.each([["legacy_employee"], ["test"]])("%s fails with systemBlock before any rule, and the rules are still explained", (rt) => {
    const e = evaluate(baseFacts({ recordType: rt, age: ok(25) }), compiled([AGE]), NOW);
    expect(e).toMatchObject({ verdict: "fail", systemBlock: rt });
    expect(e.failed[0]).toMatchObject({ key: "system", mode: "system" });
    expect(e.passed.map((r) => r.key)).toEqual(["age"]);
  });
  it("invalid mobile, eligibility blocks, booked, other journey", () => {
    expect(evaluate(baseFacts({ mobileValid: false }), compiled([]), NOW).systemBlock).toBe("invalid_mobile");
    expect(evaluate(baseFacts({ system: { ...baseFacts().system, eligibility: { ok: false, blocks: ["opted_out"], priority: 0 } } }), compiled([]), NOW).systemBlock).toBe("opted_out");
    expect(evaluate(baseFacts({ system: { ...baseFacts().system, bookedFor: "r9" } }), compiled([]), NOW).systemBlock).toBe("already_booked");
    expect(evaluate(baseFacts({ system: { ...baseFacts().system, inOtherJourney: "r9" } }), compiled([]), NOW).systemBlock).toBe("in_other_journey");
  });
  it("legacy-scoped rules apply only to their sources", () => {
    const r = rule("night_shift", {}, { only: ["he"] });
    expect(evaluate(baseFacts({ sourceKind: "meta_live", subSource: "meta_live", nightShiftOk: ok(false) }), compiled([r]), NOW).verdict).toBe("pass");
    expect(evaluate(baseFacts({ nightShiftOk: ok(false) }), compiled([r]), NOW).verdict).toBe("fail");
  });
});

describe("explain", () => {
  it("failed education shows actual 10th, required 12th or above", () => {
    const c = compileCriteria(onfidoRow({ educationRequirement: "12th", selectionRules: { schema: 1, rules: { education_min: { mode: "must" } } } }));
    const e = evaluate(baseFacts({ educationRank: ok(2) }), c, NOW);
    const r = e.failed.find((x) => x.key === "education_min")!;
    expect(r).toMatchObject({ actualText: "10th", requiredText: "12th or above" });
    expect(explain(r)).toBe("Minimum qualification: 10th (required 12th or above) - fail");
  });
  it("WorkIndia education reads as unknown because the import sets Graduate for everyone", () => {
    const e = evaluate(baseFacts({ subSource: "workindia_import", educationRank: { value: null, quality: "source_default", from: "workindia.education" } }), compiled([EDU]), NOW);
    expect(e.unknown[0].actualText).toBe("unknown: import sets Graduate for everyone");
  });
  it("Meta people are checked with the screener's own words", () => {
    const metaInput = { parsedAge: 41, parsedEducation: null, parsedExperienceYr: null, parsedGender: null, rawFields: {} };
    const e = evaluate(baseFacts({ sourceKind: "meta_live", subSource: "meta_live", metaInput }), compiled([AGE]), NOW);
    expect(e.failed[0].actualText).toBe("Age 41 above maximum 35");
  });
});

describe("determinism and robustness", () => {
  it("the same inputs give a deep-equal result; shuffled rules give the same verdict", () => {
    const f = baseFacts({ age: ok(30), nightShiftOk: ok(false) });
    expect(evaluate(f, compiled([AGE, EDU, NIGHT]), NOW)).toEqual(evaluate(f, compiled([AGE, EDU, NIGHT]), NOW));
    expect(evaluate(f, compiled([NIGHT, AGE, EDU]), NOW).verdict).toBe(evaluate(f, compiled([AGE, EDU, NIGHT]), NOW).verdict);
  });
  it("contradictory compiled criteria (age 40-30) fail every person with the reason, never crash", () => {
    const bad = rule("age", { min: 40, max: 30 });
    for (const f of [baseFacts(), baseFacts({ age: ok(35) }), baseFacts({ sourceKind: "meta_live", subSource: "meta_live", metaInput: { parsedAge: 35, parsedEducation: null, parsedExperienceYr: null, parsedGender: null, rawFields: {} } })]) {
      const e = evaluate(f, compiled([bad]), NOW);
      expect(e.verdict).toBe("fail");
      expect(e.failed[0].actualText).toBe("criteria contradict: 40 > 30");
    }
  });
  it("factsHash changes with the facts and not with the criteria", () => {
    const a = evaluate(baseFacts({ age: ok(30) }), compiled([AGE]), NOW).factsHash;
    expect(evaluate(baseFacts({ age: ok(30) }), compiled([]), NOW).factsHash).toBe(a);
    expect(evaluate(baseFacts({ age: ok(31) }), compiled([AGE]), NOW).factsHash).not.toBe(a);
  });
});

describe("score", () => {
  it("with no PREFER rules the score equals scoreLead (non-strict) rankScore for 20 fixtures", () => {
    const matchReq = { ageMin: 18, ageMax: 35, minEducationRank: 3, nightShift: true, branchCity: "Noida", branchState: "Uttar Pradesh", minTypingWpm: 25, englishLevel: "basic" as const };
    for (let i = 0; i < 20; i++) {
      const match = { age: 16 + i * 2, educationRank: (i % 6) + 1, experienceYears: i % 4, nightShiftOk: i % 3 === 0 ? null : i % 2 === 0, city: i % 2 ? "Noida" : "Surat", state: i % 2 ? null : "Gujarat", typingWpm: i % 5 ? 20 + i : null, englishLevel: (["basic", "intermediate", "advanced"] as const)[i % 3] };
      const e = evaluate(baseFacts({ match }), compiled([AGE, EDU], { matchReq }), NOW);
      expect(e.score, String(i)).toBe(scoreLead(match, { ...matchReq, strict: false }).rankScore);
    }
  });
});
