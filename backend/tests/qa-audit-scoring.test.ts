import { describe, it, expect } from "vitest";
import { scoreQaAudit, type QaFormParameter, type QaParameterScore } from "../src/modules/quality-dashboard/qa-audit-scoring.js";

/**
 * There is no quality schema in mas_hrms at all — QA_EVALUATION and
 * QA_CALIBRATION have been granted to qa, manager and branch_head since June
 * with no route and no table behind them, so manually-audited processes had
 * nowhere to record a score.
 *
 * These pin the three rules that decide whether a manual score is honest.
 */

const P = (id: string, maxScore: number, isFatal = false): QaFormParameter => ({ id, maxScore, isFatal });
const S = (formParameterId: string, score: number | null, notApplicable = false): QaParameterScore =>
  ({ formParameterId, score, notApplicable });

describe("straightforward scoring", () => {
  it("sums the scored parameters and reports a percentage", () => {
    const result = scoreQaAudit([P("a", 10), P("b", 10)], [S("a", 8), S("b", 7)]);
    expect(result).toMatchObject({ totalScore: 15, maxScore: 20, qualityPercentage: 75 });
  });

  it("rounds to two places rather than carrying float noise", () => {
    const result = scoreQaAudit([P("a", 3)], [S("a", 1)]);
    expect(result.qualityPercentage).toBe(33.33);
  });
});

describe("not-applicable parameters", () => {
  it("removes them from BOTH numerator and denominator", () => {
    // Counting an N/A as zero is how an unassessed parameter starts looking
    // like a failed one — the same mistake that put 1,383 unscored audits in a
    // fatal-rate denominator and reported 0% for unreviewed work.
    const result = scoreQaAudit(
      [P("a", 10), P("b", 10)],
      [S("a", 8), S("b", null, true)],
    );
    expect(result).toMatchObject({ totalScore: 8, maxScore: 10, qualityPercentage: 80 });
  });

  it("treats a missing score the same as not-applicable", () => {
    // A parameter the auditor never touched cannot be assessed either.
    const result = scoreQaAudit([P("a", 10), P("b", 10)], [S("a", 9)]);
    expect(result).toMatchObject({ maxScore: 10, qualityPercentage: 90, notApplicableCount: 1 });
  });

  it("reports how many were assessed, so the gap stays visible", () => {
    const result = scoreQaAudit(
      [P("a", 5), P("b", 5), P("c", 5)],
      [S("a", 5), S("b", null, true), S("c", null, true)],
    );
    expect(result).toMatchObject({ assessedCount: 1, notApplicableCount: 2 });
  });

  it("returns no percentage at all when nothing applied", () => {
    // Absent is honest. 0% says they failed; 100% says they were perfect.
    // Neither is true of a call nobody could assess.
    const result = scoreQaAudit([P("a", 10)], [S("a", null, true)]);
    expect(result.qualityPercentage).toBeNull();
    expect(result.fatalTriggered).toBe(false);
  });
});

describe("fatal parameters", () => {
  it("zeroes the entire audit when a fatal parameter scores zero", () => {
    // Averaging a fatal away would let a call that breached compliance pass.
    const result = scoreQaAudit(
      [P("a", 10), P("fatal", 10, true)],
      [S("a", 10), S("fatal", 0)],
    );
    expect(result).toMatchObject({ fatalTriggered: true, qualityPercentage: 0 });
  });

  it("leaves the raw totals intact so the breach can be explained", () => {
    // The percentage is zero, but "9 of 20 before the fatal" is what an agent
    // needs to see in a coaching conversation.
    const result = scoreQaAudit(
      [P("a", 10), P("fatal", 10, true)],
      [S("a", 9), S("fatal", 0)],
    );
    expect(result.totalScore).toBe(9);
    expect(result.maxScore).toBe(20);
  });

  it("does not trigger when the fatal parameter is passed", () => {
    const result = scoreQaAudit(
      [P("a", 10), P("fatal", 10, true)],
      [S("a", 8), S("fatal", 10)],
    );
    expect(result).toMatchObject({ fatalTriggered: false, qualityPercentage: 90 });
  });

  it("does not trigger when the fatal parameter did not apply to the call", () => {
    // A compliance step that was never reached is not a breach of it.
    const result = scoreQaAudit(
      [P("a", 10), P("fatal", 10, true)],
      [S("a", 8), S("fatal", null, true)],
    );
    expect(result).toMatchObject({ fatalTriggered: false, qualityPercentage: 80 });
  });

  it("triggers on a negative score as well as zero", () => {
    const result = scoreQaAudit([P("fatal", 10, true)], [S("fatal", -1)]);
    expect(result.fatalTriggered).toBe(true);
  });
});

describe("edge cases that must not throw", () => {
  it("handles a form with no parameters", () => {
    expect(scoreQaAudit([], [])).toMatchObject({ qualityPercentage: null, assessedCount: 0 });
  });

  it("ignores scores for parameters not on the form", () => {
    // A stale client payload must not inflate a score.
    const result = scoreQaAudit([P("a", 10)], [S("a", 5), S("ghost", 10)]);
    expect(result).toMatchObject({ totalScore: 5, maxScore: 10 });
  });
});
