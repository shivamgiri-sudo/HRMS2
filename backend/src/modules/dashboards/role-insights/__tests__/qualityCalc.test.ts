import { describe, expect, it } from "vitest";
import {
  QA_PARAMETERS, coveragePct, defectRates, failRatePct, pendingAudits, qualityHealth, scoreTone,
} from "../providers/qualityCalc.js";

describe("fail rate by parameter", () => {
  /** September 2026 'answered within 5 seconds': 19,056 rows, 8,550 NULL (not evaluated), 10,506 evaluated of which ~200 failed. */
  const row = { f0: 200, n0: 10_506 };

  it("divides failures by EVALUATED calls, not by all rows", () => {
    const [d] = defectRates(row);
    expect(d.param).toBe("call_answered_within_5_seconds");
    expect(d.failRate).toBe(1.9);
    expect(d.evaluated).toBe(10_506);
  });

  it("the old COALESCE(col,0) formula would have counted every un-evaluated call as a failure", () => {
    const allRows = 19_056;
    const evaluatedPass = 10_506 - 200; // passed calls
    const oldFormula = 100 - (evaluatedPass / allRows) * 100; // AVG(COALESCE(col,0)) * 100
    expect(Math.round(oldFormula * 10) / 10).toBe(45.9);
    expect(defectRates(row)[0].failRate).toBeLessThan(oldFormula / 10);
  });

  it("drops parameters evaluated on too few calls and sorts worst first", () => {
    const out = defectRates({ f0: 1, n0: 10, f1: 40, n1: 100, f2: 5, n2: 100 });
    expect(out.map((d) => d.param)).toEqual([QA_PARAMETERS[1].col, QA_PARAMETERS[2].col]);
  });
});

describe("coverage and pending audits", () => {
  it("coverage = scored / analysed, capped at 100, null without volume", () => {
    expect(coveragePct(11_390, 19_324)).toBe(58.9);
    expect(coveragePct(500, 100)).toBe(100);
    expect(coveragePct(10, 0)).toBeNull();
    expect(coveragePct(null, 100)).toBeNull();
  });
  it("pending = analysed - audited, floored at zero when the two sources disagree", () => {
    expect(pendingAudits(19_324, 11_390)).toBe(7_934);
    expect(pendingAudits(100, 150)).toBe(0);
    expect(pendingAudits(null, 5)).toBeNull();
  });
  it("fail rate is of scored calls, null when none were scored", () => {
    expect(failRatePct(3_450, 11_390)).toBe(30.3);
    expect(failRatePct(0, 0)).toBeNull();
    expect(failRatePct(null, 10)).toBeNull();
  });
});

describe("quality health", () => {
  it("is null with fewer than two components", () => {
    expect(qualityHealth({ avgScore: 80, coverage: null, failRate: null })).toBeNull();
  });
  it("blends score vs the 85% target, coverage and pass rate", () => {
    expect(qualityHealth({ avgScore: 85, coverage: 100, failRate: 0 })?.score).toBe(100);
    expect(qualityHealth({ avgScore: 68.16, coverage: null, failRate: 30.3 })?.score).toBe(Math.round((((68.16 / 85) * 100) * 0.5 + (100 - 60.6) * 0.25) / 0.75));
  });
  it("score tone bands", () => {
    expect(scoreTone(null)).toBe("slate");
    expect(scoreTone(90)).toBe("green");
    expect(scoreTone(80)).toBe("amber");
    expect(scoreTone(60)).toBe("red");
  });
});
