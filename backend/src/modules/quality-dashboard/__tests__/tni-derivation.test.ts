import { describe, it, expect } from "vitest";
import {
  classifySkillFinding, isSystemic, evidenceNote, PARAMETER_RULES,
  type SkillParameterRule,
} from "../tni-derivation.service.js";

const rule = PARAMETER_RULES.find((r) => r.key === "accuracy") as SkillParameterRule;

describe("classifySkillFinding", () => {
  it("raises nothing below the minimum sample, no matter how bad the rate", () => {
    // 4 scored, 4 failed — a 100% fail rate on evidence too thin to trust.
    expect(classifySkillFinding(rule, 4, 4)).toBeNull();
  });

  it("raises nothing at or under the threshold", () => {
    expect(classifySkillFinding(rule, 10, 3)).toBeNull(); // exactly 30%
  });

  it("raises a MEDIUM finding just over the threshold", () => {
    const r = classifySkillFinding(rule, 10, 4); // 40%
    expect(r).toEqual({ severity: "MEDIUM", coachingType: "ONE_ON_ONE" });
  });

  /**
   * MAS61561, 2026-09-08: 127 scored calls, 127 accuracy failures — a real
   * number from live data. A 100% fail rate on that much evidence is treated as
   * a possible calibration problem, not auto-assigned as one person's coaching.
   */
  it("flags EXTREME_REVIEW rather than a normal finding on real-shaped extreme evidence", () => {
    const r = classifySkillFinding(rule, 127, 127);
    expect(r).toEqual({ severity: "EXTREME_REVIEW", coachingType: "ONE_ON_ONE" });
  });

  it("does not flag EXTREME_REVIEW when the sample is too small, even at 100%", () => {
    const r = classifySkillFinding(rule, 6, 6); // above minSample(5) but below EXTREME_MIN_SAMPLE(20)
    expect(r).toEqual({ severity: "MEDIUM", coachingType: "ONE_ON_ONE" });
  });
});

describe("isSystemic", () => {
  it("is false below the minimum flagged-agent count even at 100% share", () => {
    expect(isSystemic(2, 2)).toBe(false); // 2 of 2 = 100%, but fewer than 3 agents
  });

  it("is false when the share is under the systemic threshold", () => {
    expect(isSystemic(3, 20)).toBe(false); // 15%
  });

  it("is true once both the count and the share clear their bars", () => {
    expect(isSystemic(4, 10)).toBe(true); // 40%, 4 agents
  });

  it("never divides by zero", () => {
    expect(isSystemic(0, 0)).toBe(false);
  });
});

describe("evidenceNote", () => {
  it("states the fail rate a manager can verify against the same window", () => {
    const note = evidenceNote(rule, 50, 18, "2026-08-09", "2026-09-08");
    expect(note).toBe('18 of 50 audits failed "accuracy" between 2026-08-09 and 2026-09-08 (36%)');
  });
});

describe("PARAMETER_RULES", () => {
  it("does not include competitor_named or the VOC-negative flags", () => {
    // Deliberate exclusion: those are evidence about the call's subject, not the
    // agent, and a training need built from them would misdirect coaching effort.
    const keys = PARAMETER_RULES.map((r) => r.key);
    expect(keys).not.toContain("competitor_named");
    expect(keys).not.toContain("voc_logistics_neg");
    expect(keys).not.toContain("voc_product_neg");
  });

  it("scores profanity as an occurrence count, not a rate", () => {
    const profanity = PARAMETER_RULES.find((r) => r.key === "profanity");
    expect(profanity?.kind).toBe("event");
  });
});
