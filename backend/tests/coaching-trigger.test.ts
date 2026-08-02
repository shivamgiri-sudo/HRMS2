import { describe, it, expect } from "vitest";
import { evaluateCoachingTrigger, type QualitySignal } from "../src/modules/quality-dashboard/coaching-trigger.js";

/**
 * coaching_session has existed since migration 019 and holds ZERO rows, while
 * 254 agents are scored upstream at an average of 50.1%. The table was modelled
 * and never fed, so a low score has never produced an action.
 *
 * These pin the judgement calls. Whether someone gets coached should be
 * arguable in a test rather than buried in a query.
 */

const signal = (over: Partial<QualitySignal> = {}): QualitySignal => ({
  qualityPercentage: 80,
  fatalTriggered: false,
  targetPercentage: 80,
  consecutiveShortfalls: 0,
  sampleSize: 10,
  ...over,
});

describe("nothing to coach on", () => {
  it("raises nothing when the work was never assessed", () => {
    // 21% of July's audits carry a NULL score. Coaching someone because their
    // audits went unscored punishes them for a process failure that is not
    // theirs.
    expect(evaluateCoachingTrigger(signal({ qualityPercentage: null }))).toBeNull();
  });

  it("raises nothing when the process has no target", () => {
    // Quality runs 23.7% to 72.7% across the ten live clients. Inventing a
    // company-wide bar would flag an entire process as failing.
    expect(evaluateCoachingTrigger(signal({ qualityPercentage: 40, targetPercentage: null }))).toBeNull();
    expect(evaluateCoachingTrigger(signal({ qualityPercentage: 40, targetPercentage: 0 }))).toBeNull();
  });

  it("raises nothing when the agent is at or above target", () => {
    expect(evaluateCoachingTrigger(signal({ qualityPercentage: 85, targetPercentage: 80 }))).toBeNull();
    expect(evaluateCoachingTrigger(signal({ qualityPercentage: 80, targetPercentage: 80 }))).toBeNull();
  });

  it("tolerates a shortfall inside the noise band", () => {
    // 75 against a target of 80 is 93.75% of target — short, but not material.
    expect(evaluateCoachingTrigger(signal({ qualityPercentage: 75, targetPercentage: 80 }))).toBeNull();
  });

  it("does not coach off too few audits", () => {
    // One bad call is an incident, not a pattern. Coaching on it produces noise
    // that gets the whole signal ignored.
    expect(evaluateCoachingTrigger(signal({ qualityPercentage: 40, sampleSize: 2 }))).toBeNull();
  });
});

describe("thresholds are relative to the process target", () => {
  it("does not flag a low absolute score that meets a low target", () => {
    // 40% on a process targeting 40% is on target. A fixed "coach below 60"
    // would condemn a whole process.
    expect(evaluateCoachingTrigger(signal({ qualityPercentage: 40, targetPercentage: 40 }))).toBeNull();
  });

  it("does flag a high absolute score that misses a high target", () => {
    // 60% against a target of 90% is a 33% shortfall, even though 60 sounds fine.
    const t = evaluateCoachingTrigger(signal({ qualityPercentage: 60, targetPercentage: 90 }));
    expect(t?.priority).toBe("high");
  });
});

describe("fatal breaches", () => {
  it("is critical regardless of the score", () => {
    const t = evaluateCoachingTrigger(signal({ fatalTriggered: true, qualityPercentage: 95 }));
    expect(t).toMatchObject({ priority: "critical", sessionType: "quality", raiseTrainingNeed: true });
  });

  it("fires even on a single audit and with no target configured", () => {
    // A compliance event is actionable on its own — it is not an average.
    const t = evaluateCoachingTrigger(
      signal({ fatalTriggered: true, sampleSize: 1, targetPercentage: null, qualityPercentage: null }),
    );
    expect(t?.priority).toBe("critical");
  });
});

describe("escalation", () => {
  it("starts low on a first mild shortfall and asks for no training plan", () => {
    const t = evaluateCoachingTrigger(signal({ qualityPercentage: 70, targetPercentage: 80 }));
    expect(t).toMatchObject({ priority: "low", raiseTrainingNeed: false });
  });

  it("raises to medium once it repeats", () => {
    const t = evaluateCoachingTrigger(
      signal({ qualityPercentage: 70, targetPercentage: 80, consecutiveShortfalls: 2 }),
    );
    expect(t).toMatchObject({ priority: "medium", raiseTrainingNeed: true });
  });

  it("treats a severe shortfall as high immediately", () => {
    // 50 against 80 is 37.5% short — that does not wait for a pattern.
    const t = evaluateCoachingTrigger(signal({ qualityPercentage: 50, targetPercentage: 80 }));
    expect(t).toMatchObject({ priority: "high", sessionType: "quality" });
  });

  it("escalates to a PIP when severe and persistent", () => {
    // Coaching has been tried three times and the number has not moved.
    // Repeating the same session again would be theatre.
    const t = evaluateCoachingTrigger(
      signal({ qualityPercentage: 50, targetPercentage: 80, consecutiveShortfalls: 3 }),
    );
    expect(t).toMatchObject({ priority: "critical", sessionType: "pip" });
  });

  it("does not jump to a PIP on a mild but persistent shortfall", () => {
    // Persistent and mild is a performance conversation, not a PIP.
    const t = evaluateCoachingTrigger(
      signal({ qualityPercentage: 71, targetPercentage: 80, consecutiveShortfalls: 4 }),
    );
    expect(t).toMatchObject({ priority: "high", sessionType: "performance" });
  });

  it("states the shortfall and the evidence in the reason", () => {
    // A coaching row that says only "below target" is not actionable.
    const t = evaluateCoachingTrigger(
      signal({ qualityPercentage: 50, targetPercentage: 80, sampleSize: 12 }),
    );
    expect(t?.reason).toMatch(/38% below target/);
    expect(t?.reason).toMatch(/12 assessed audits/);
  });
});
