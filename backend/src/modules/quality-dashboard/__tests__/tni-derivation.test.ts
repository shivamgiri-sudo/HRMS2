import { describe, it, expect } from "vitest";
import {
  classifySkillFinding, effectiveThreshold, isSystemic, evidenceNote, PARAMETER_RULES,
  type SkillParameterRule,
} from "../tni-derivation.service.js";

const rule = PARAMETER_RULES.find((r) => r.key === "accuracy") as SkillParameterRule;

/**
 * effectiveThreshold, not the classification math, is the piece that actually
 * matters here: a flat 30% rate threshold was tried first and was wrong.
 * Checked against real data (2026-08-09 to 2026-09-08), "accuracy" runs a 49.9%
 * org-wide fail rate — a flat 30% bar there flags almost every agent, because
 * the org average alone clears it. A margin above the parameter's own baseline
 * finds agents worse than typical, whatever typical is this window.
 */
describe("effectiveThreshold", () => {
  it("adds the margin on top of a real, high org baseline", () => {
    // accuracy's real 2026-08-09..2026-09-08 baseline, verified live.
    expect(effectiveThreshold(rule, 0.499)).toBeCloseTo(0.649, 5);
  });

  it("floors at MIN_EFFECTIVE_THRESHOLD when the baseline is low", () => {
    // A 5% baseline + 15pp margin would be 20% — too low a bar to mean anything.
    expect(effectiveThreshold(rule, 0.05)).toBe(0.30);
  });

  it("does not floor when baseline+margin already clears the floor", () => {
    expect(effectiveThreshold(rule, 0.30)).toBeCloseTo(0.45, 5);
  });
});

describe("classifySkillFinding", () => {
  const threshold = 0.30; // a fixed, explicit threshold — this function no longer computes one itself

  it("raises nothing below the minimum sample, no matter how bad the rate", () => {
    // 4 scored, 4 failed — a 100% fail rate on evidence too thin to trust.
    expect(classifySkillFinding(rule, 4, 4, threshold)).toBeNull();
  });

  it("raises nothing at or under the threshold", () => {
    expect(classifySkillFinding(rule, 10, 3, threshold)).toBeNull(); // exactly 30%
  });

  it("raises a MEDIUM finding just over the threshold", () => {
    const r = classifySkillFinding(rule, 10, 4, threshold); // 40%
    expect(r).toEqual({ severity: "MEDIUM", coachingType: "ONE_ON_ONE" });
  });

  /**
   * MAS61561, 2026-09-08: 118 scored calls, 118 accuracy failures — a real
   * number from live data (persisted, then re-verified after this fix). A 100%
   * fail rate on that much evidence is treated as a possible calibration
   * problem, not auto-assigned as one person's coaching, REGARDLESS of where
   * the threshold sits — 100% clears any reasonable bar.
   */
  it("flags EXTREME_REVIEW rather than a normal finding on real-shaped extreme evidence", () => {
    const r = classifySkillFinding(rule, 118, 118, threshold);
    expect(r).toEqual({ severity: "EXTREME_REVIEW", coachingType: "ONE_ON_ONE" });
  });

  it("does not flag EXTREME_REVIEW when the sample is too small, even at 100%", () => {
    const r = classifySkillFinding(rule, 6, 6, threshold); // above minSample(5) but below EXTREME_MIN_SAMPLE(20)
    expect(r).toEqual({ severity: "MEDIUM", coachingType: "ONE_ON_ONE" });
  });

  /**
   * The actual bug this fix corrects: at accuracy's real baseline (49.9%) with
   * the corrected effective threshold (64.9%), an agent at exactly the org
   * average no longer raises a finding — before this fix, a flat 30% bar would
   * have flagged them for being merely typical.
   */
  it("does not flag an agent who is only at the (high) org average, once the threshold reflects that average", () => {
    const realisticThreshold = effectiveThreshold(rule, 0.499); // 0.649
    expect(classifySkillFinding(rule, 500, 250, realisticThreshold)).toBeNull(); // 50% fail, below 64.9%
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

  /**
   * A bare "58%" is unreadable without knowing what's typical — the whole
   * reason effectiveThreshold exists is that "typical" varies wildly by
   * parameter. Naming the baseline in the note is what makes the number mean
   * something to the person reading it, not just to the code that raised it.
   */
  it("names the org baseline the agent is being compared against, when given one", () => {
    const note = evidenceNote(rule, 500, 290, "2026-08-09", "2026-09-08", 0.499);
    expect(note).toBe(
      '290 of 500 audits failed "accuracy" between 2026-08-09 and 2026-09-08 (58%), ' +
      'vs an org-wide baseline of 49.9% for this parameter',
    );
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
