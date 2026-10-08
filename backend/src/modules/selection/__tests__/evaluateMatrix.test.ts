import { describe, expect, it } from "vitest";
import { evaluate } from "../evaluate.js";
import type { CandidateFacts, FactValue, MissingPolicy, RuleKey, RuleMode } from "../selection-types.js";
import { baseFacts, compiled, NOW, ok, rule } from "./fixtures/facts.js";

// Generated rule matrix: every rule key x fact state x mode x missing policy, checked against one truth table written here.
type State = "pass" | "fail" | "unknown-missing" | "unknown-placeholder" | "unknown-ambiguous";
const STATES: State[] = ["pass", "fail", "unknown-missing", "unknown-placeholder", "unknown-ambiguous"];
const MODES: RuleMode[] = ["must", "prefer", "off"];
const POLICIES: MissingPolicy[] = ["review", "fail", "pass"];
const unk = (s: State): FactValue<never> => ({ value: null, quality: s === "unknown-missing" ? "missing" : s === "unknown-placeholder" ? "placeholder" : "ambiguous", from: "test" });

/** For each key: the required value, and how to put the facts into a state. null = the state cannot occur for this key. */
type Setter = (f: CandidateFacts, s: State) => CandidateFacts | null;
const fact = <K extends keyof CandidateFacts>(k: K, passV: unknown, failV: unknown): Setter => (f, s) =>
  ({ ...f, [k]: s === "pass" ? ok(passV) : s === "fail" ? ok(failV) : unk(s) });
const SPECS: Record<RuleKey, { required: unknown; set: Setter }> = {
  age: { required: { min: 18, max: 35 }, set: fact("age", 25, 40) },
  education_min: { required: { text: "12th", rank: 3, soft: false }, set: fact("educationRank", 5, 2) },
  experience: { required: { min: 1, max: 5 }, set: fact("experienceYears", 2, 0) },
  night_shift: { required: {}, set: fact("nightShiftOk", true, false) },
  rotational_shift: { required: {}, set: fact("rotationalOk", true, false) },
  location_region: { required: { branchName: "NOIDA-2", branchCity: "Noida", branchState: "Uttar Pradesh", relocationOk: false }, set: fact("locationText", "sector 62 noida", "surat gujarat") },
  location_cities: { required: { cities: ["Noida", "Ghaziabad"], relocationOk: false }, set: fact("locationText", "indirapuram ghaziabad", "surat") },
  location_radius: { required: { km: 10, lat: 28.6, lng: 77.3 }, set: (f, s) => (s === "pass" ? { ...f, match: { lat: 28.61, lng: 77.31 } } : s === "fail" ? { ...f, match: { lat: 23.0, lng: 72.5 } } : s === "unknown-missing" ? f : null) },
  gender: { required: { gender: "female" }, set: fact("gender", "female", "male") },
  languages: { required: { langs: [{ language: "Hindi", skills: [] }] }, set: fact("languages", ["hindi", "english"], ["gujarati"]) },
  certificate: { required: { code: "DRA", level: "declared", verifiedBonus: 0 }, set: fact("certificates", [{ code: "DRA", level: "declared" }], []) },
  english: { required: { level: "intermediate" }, set: fact("englishLevel", 3, 1) },
  typing: { required: { wpm: 25 }, set: fact("typingWpm", 30, 20) },
  form_answer: { required: { rule: { field: "x", op: "is_yes", value: "" } }, set: (f, s) => (s === "unknown-missing" ? f : null) },
  notice_period: { required: { maxDays: 30 }, set: fact("noticeDays", 15, 90) },
  salary_fit: { required: { max: 20000, maxRatio: 1.25, expectationOnly: false }, set: (f, s) => ({ ...fact("salaryMonthly", 20000, 40000)(f, s)!, salaryIsExpectation: true }) },
  employer_exclude: { required: { names: ["Acme"] }, set: fact("employers", ["Concentrix"], ["Acme Corp"]) },
  employer_include: { required: { names: ["Acme"] }, set: fact("employers", ["Acme"], ["Concentrix"]) },
  ex_employee: { required: { value: "exclude" }, set: (f, s) => (s === "pass" ? f : s === "fail" ? { ...f, system: { ...f.system, exEmployee: "clean" } } : null) },
  skills: { required: { skills: ["excel", "typing"], match: "all" }, set: fact("skillsText", "excel and typing", "excel") },
  education_stream: { required: { streams: ["commerce"] }, set: fact("stream", "commerce", "arts") },
  education_completed: { required: { value: "completed" }, set: fact("educationStatus", "completed", "dropped") },
  rejected_other_process: { required: {}, set: (f, s) => (s === "pass" ? f : s === "fail" ? { ...f, system: { ...f.system, rejectedOtherProcess: true } } : null) },
  record_age: { required: { maxDays: 30 }, set: fact("recordUpdatedAt", "2026-10-01 00:00:00", "2025-01-01 00:00:00") },
  contact_recent: { required: { days: 7 }, set: (f, s) => (s === "pass" ? f : s === "fail" ? { ...f, lastFirstContactAt: "2026-10-08 10:00:00" } : null) },
  valid_email: { required: {}, set: (f, s) => (s === "pass" ? { ...f, email: ok("a@b.com") } : s === "fail" ? { ...f, email: { value: null, quality: "ambiguous", from: "t" } } : s === "unknown-missing" ? f : null) },
  sources: { required: { include: [], exclude: ["workindia_import"] }, set: (f, s) => (s === "pass" ? f : s === "fail" ? { ...f, subSource: "workindia_import" } : null) },
  relocation_ok: { required: {}, set: () => null }, // a modifier of the location rules, never a rule of its own (covered in evaluate.test)
};

const W = 10;
function oracle(key: RuleKey, s: State, mode: RuleMode, missing: MissingPolicy): { verdict: "pass" | "fail" | "review"; delta: number } {
  if (mode === "off") return { verdict: "pass", delta: 0 };
  const outcome = s === "pass" ? "pass" : s === "fail" ? "fail" : "unknown";
  if (mode === "must") {
    if (outcome === "pass") return { verdict: "pass", delta: 0 };
    if (outcome === "fail") return { verdict: "fail", delta: 0 };
    return { verdict: missing === "review" ? "review" : missing === "fail" ? "fail" : "pass", delta: 0 };
  }
  if (outcome === "unknown") return { verdict: "pass", delta: 0 };
  if (key === "rejected_other_process") return { verdict: "pass", delta: outcome === "pass" ? 0 : -W };
  return { verdict: "pass", delta: outcome === "pass" ? W : -W / 2 };
}

describe("rule matrix (generated)", () => {
  it("every key x fact state x mode x missing gives the truth-table verdict and score effect", () => {
    let n = 0;
    for (const key of Object.keys(SPECS) as RuleKey[]) for (const s of STATES) {
      const facts = SPECS[key].set(baseFacts(), s);
      if (!facts) continue;
      const base = evaluate(facts, compiled([]), NOW).score;
      for (const mode of MODES) for (const missing of POLICIES) {
        const rules = mode === "off" ? [] : [rule(key, SPECS[key].required, { mode, missing, weight: mode === "prefer" ? W : 0 })];
        const e = evaluate(facts, compiled(rules), NOW);
        const want = oracle(key, s, mode, missing);
        const label = `${key} ${s} ${mode} ${missing}`;
        expect(e.verdict, label).toBe(want.verdict);
        expect(Math.round((e.score - base) * 10) / 10, label).toBe(Math.max(0, Math.min(100, base + want.delta)) - base);
        if (mode !== "off") expect([...e.passed, ...e.failed, ...e.unknown].map((r) => r.key), label).toEqual([key]);
        if (mode === "must" && s.startsWith("unknown") && missing === "review") expect(e.reviewReasons.length, label).toBe(1);
        n++;
      }
    }
    expect(n).toBeGreaterThan(27 * 2 * 9); // at least pass+fail for every rule
  });

  it("placeholder and ambiguous facts behave exactly like missing ones", () => {
    for (const key of Object.keys(SPECS) as RuleKey[]) {
      const outs = (["unknown-missing", "unknown-placeholder", "unknown-ambiguous"] as State[]).map((s) => SPECS[key].set(baseFacts(), s)).filter(Boolean)
        .map((f) => evaluate(f!, compiled([rule(key, SPECS[key].required, { missing: "review" })]), NOW).verdict);
      expect(new Set(outs).size, key).toBeLessThanOrEqual(1);
    }
  });
});
