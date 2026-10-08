import { describe, expect, it } from "vitest";
import { evaluate } from "../evaluate.js";
import { buildFunnel, pickSample } from "../funnel.js";
import type { CandidateFacts } from "../selection-types.js";
import { baseFacts, compiled, NOW, ok, rule } from "./fixtures/facts.js";

const AGE = rule("age", { min: 18, max: 35 });
const EDU = rule("education_min", { text: "12th", rank: 3, soft: false });
const NIGHT = rule("night_shift", {}, { missing: "pass" });
const SKILL = rule("skills", { skills: ["excel"], match: "any" }, { mode: "prefer", weight: 10 });
const C = compiled([AGE, EDU, NIGHT, SKILL]);

const people: Array<[string, Partial<CandidateFacts>]> = [
  ["pass", { age: ok(25), educationRank: ok(5), nightShiftOk: ok(true), skillsText: ok("excel") }],
  ["pass2", { age: ok(30), educationRank: ok(3), nightShiftOk: ok(true) }],
  ["age-only", { age: ok(40), educationRank: ok(5), nightShiftOk: ok(true) }],
  ["age+edu", { age: ok(40), educationRank: ok(2), nightShiftOk: ok(true) }],
  ["edu-only", { age: ok(20), educationRank: ok(1), nightShiftOk: ok(true) }],
  ["night-only", { age: ok(20), educationRank: ok(4), nightShiftOk: ok(false) }],
  ["review-age", { educationRank: ok(5), nightShiftOk: ok(true) }],
  ["review-age-fails-edu", { educationRank: ok(1) }],
  ["system", { recordType: "legacy_employee", age: ok(25), educationRank: ok(5) }],
];
const evals = people.map(([name, f]) => ({ name, e: evaluate(baseFacts({ personKey: `98765${String(name.length).padStart(5, "0")}`, ...f }), C, NOW) }));

describe("buildFunnel", () => {
  const fun = buildFunnel(evals, C);
  it("starts with system exclusions, then one step per MUST rule in compiled order", () => {
    expect(fun.steps.map((s) => [s.key, s.kind])).toEqual([["system", "system"], ["age", "must"], ["education_min", "must"], ["night_shift", "must"]]);
  });
  it("remaining[k] = remaining[k-1] - failedHere[k]; review people stay in remaining and are counted in reviewHere", () => {
    let prev = people.length;
    for (const s of fun.steps) { expect(s.remaining).toBe(prev - s.failedHere); prev = s.remaining; }
    expect(fun.steps.map((s) => [s.failedHere, s.reviewHere])).toEqual([[1, 0], [2, 2], [2, 0], [1, 0]]);
    expect(prev).toBe(fun.outcome.shortlist + fun.outcome.review);
  });
  it("only-this-rule and if-removed counts", () => {
    const by = Object.fromEntries(fun.steps.map((s) => [s.key, s]));
    expect(by.age).toMatchObject({ onlyThisRuleFails: 1, ifRemovedGain: 1 });
    expect(by.education_min).toMatchObject({ onlyThisRuleFails: 2, ifRemovedGain: 1 }); // edu-only would pass; review-age-fails-edu would go to review
    expect(by.night_shift).toMatchObject({ onlyThisRuleFails: 1, ifRemovedGain: 1 });
  });
  it("outcome and score buckets", () => {
    expect(fun.outcome).toEqual({ shortlist: 2, review: 1, rejected: 5, systemExcluded: 1 });
    expect(fun.scoreBuckets.reduce((n, b) => n + b.n, 0)).toBe(3);
  });
  it("HR overrides: an include passes past every rule, an exclude fails at the override step, a system block is never lifted", () => {
    const withOv = evals.map((x) => (x.name === "age-only" ? { ...x, e: { ...x.e, override: { kind: "include" as const, reason: "known good", actorId: "u", at: "t" } } }
      : x.name === "pass2" ? { ...x, e: { ...x.e, override: { kind: "exclude" as const, reason: "duplicate", actorId: "u", at: "t" } } }
      : x.name === "system" ? { ...x, e: { ...x.e, override: { kind: "include" as const, reason: "x", actorId: "u", at: "t" } } } : x));
    const f2 = buildFunnel(withOv, C);
    expect(f2.steps.at(-1)).toMatchObject({ key: "override", kind: "override", failedHere: 1 });
    expect(f2.outcome).toEqual({ shortlist: 2, review: 1, rejected: 5, systemExcluded: 1 });
    let prev = people.length;
    for (const s of f2.steps) { expect(s.remaining).toBe(prev - s.failedHere); prev = s.remaining; }
  });
});

describe("pickSample", () => {
  it("20 shortlist by score, 15 review, 15 rejected by the step they failed at", () => {
    const many = Array.from({ length: 60 }, (_, i) => evals[i % evals.length]);
    const s = pickSample(many, C);
    expect(s.filter((x) => x.e.verdict === "pass" && !x.e.systemBlock).length).toBeLessThanOrEqual(20);
    expect(s.filter((x) => x.e.verdict === "review").length).toBeLessThanOrEqual(15);
    const rej = s.filter((x) => x.e.verdict === "fail");
    expect(rej.length).toBeLessThanOrEqual(15);
    const steps = rej.map((x) => x.e.systemBlock ? -1 : Math.min(...x.e.failed.filter((r) => r.mode === "must").map((r) => r.index ?? 99)));
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
  });
});
