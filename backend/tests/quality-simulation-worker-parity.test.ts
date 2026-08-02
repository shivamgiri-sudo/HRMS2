import { describe, it, expect, vi, beforeEach } from "vitest";

const execute = vi.fn();
vi.mock("../src/db/mysql.js", () => ({ db: { execute: (...a: unknown[]) => execute(...a) } }));

const { simulateQualityTarget } = await import("../src/modules/quality-dashboard/quality-target-simulation.js");
const { evaluateCoachingTrigger, DEFAULT_COACHING_THRESHOLDS } =
  await import("../src/modules/quality-dashboard/coaching-trigger.js");

/**
 * The simulation exists to answer "if I approve this target, who gets coached?"
 * That answer is worthless unless it is the answer the weekly worker will
 * actually give. A simulation that disagrees with the evaluator is worse than
 * no simulation: it is a confident wrong number that someone approves a policy
 * against.
 *
 * These are the four ways the two used to disagree. Each is now a test rather
 * than a comment, because all four were invisible — the simulation returned a
 * plausible count every time.
 *
 *   1. the simulation banded on the CONFIGURED thresholds while the evaluator
 *      used hardcoded 0.9/0.75, so per-process thresholds were decorative
 *   2. the simulation coerced a NULL average to 0, making unassessed employees
 *      the worst performers on the process; the worker raises nothing for them
 *   3. the simulation ignored the fatal flag entirely
 *   4. the minimum-audit rule was applied in two places with two shapes
 *
 * The fix is not "keep them in step" — it is that the simulation now CALLS
 * evaluateCoachingTrigger. These tests hold that wiring in place.
 */

const proc = [[{ id: "p1", process_name: "Neemans" }], []];
const rows = (rs: unknown[]) => [rs, []];

beforeEach(() => execute.mockReset());

function historyRow(over: Record<string, unknown> = {}) {
  return {
    employee_id: "e1", employee_code: "MAS1", avg_quality: 50, audit_count: 10,
    from_d: "2026-07-01", to_d: "2026-07-28", ...over,
  };
}

describe("the simulation agrees with the evaluator, employee by employee", () => {
  it("matches on a spread of scores against the same configuration", async () => {
    // Deliberately straddles both bands and the boundary.
    const scores = [20, 40, 44, 45, 49.5, 50, 60, 80];
    execute
      .mockResolvedValueOnce(proc)
      .mockResolvedValueOnce(rows(scores.map((s, i) =>
        historyRow({ employee_id: `e${i}`, employee_code: `MAS${i}`, avg_quality: s }))));

    const result = await simulateQualityTarget({
      processId: "p1", targetScore: 55,
      warningThresholdPct: 90, criticalThresholdPct: 75, minAuditCount: 3,
    });

    for (const emp of result.employees) {
      const expected = evaluateCoachingTrigger({
        qualityPercentage: emp.avgQuality,
        fatalTriggered: false,
        targetPercentage: 55,
        consecutiveShortfalls: 0,
        sampleSize: emp.auditCount,
        thresholds: { warningRatio: 0.9, criticalRatio: 0.75, minSample: 3 },
      }) !== null;

      expect(
        emp.wouldTrigger,
        `${emp.employeeCode} scored ${emp.avgQuality} against target 55: simulation said ` +
        `${emp.wouldTrigger}, evaluator said ${expected}`,
      ).toBe(expected);
    }

    expect(result.wouldTrigger).toBe(result.employees.filter((e) => e.wouldTrigger).length);
  });

  it("honours NON-default thresholds — the divergence that made them decorative", async () => {
    // 48 of 55 is 87.3%: below a configured warning of 90, ABOVE a configured
    // warning of 85. If the evaluator ignored the configuration it would report
    // a trigger in both cases.
    execute
      .mockResolvedValueOnce(proc)
      .mockResolvedValueOnce(rows([historyRow({ avg_quality: 48 })]));

    const lenient = await simulateQualityTarget({
      processId: "p1", targetScore: 55,
      warningThresholdPct: 85, criticalThresholdPct: 70, minAuditCount: 3,
    });

    expect(lenient.employees[0].wouldTrigger).toBe(false);
    expect(evaluateCoachingTrigger({
      qualityPercentage: 48, fatalTriggered: false, targetPercentage: 55,
      consecutiveShortfalls: 0, sampleSize: 10,
      thresholds: { warningRatio: 0.85, criticalRatio: 0.70, minSample: 3 },
    })).toBeNull();

    // Same employee, same score, stricter band: now it triggers.
    execute.mockReset();
    execute
      .mockResolvedValueOnce(proc)
      .mockResolvedValueOnce(rows([historyRow({ avg_quality: 48 })]));
    const strict = await simulateQualityTarget({
      processId: "p1", targetScore: 55,
      warningThresholdPct: 90, criticalThresholdPct: 75, minAuditCount: 3,
    });
    expect(strict.employees[0].wouldTrigger).toBe(true);
  });

  it("never judges an unassessed employee", async () => {
    // Used to be coerced to 0, which read as the worst score on the process.
    execute
      .mockResolvedValueOnce(proc)
      .mockResolvedValueOnce(rows([historyRow({ avg_quality: null })]));

    const result = await simulateQualityTarget({ processId: "p1", targetScore: 55 });

    expect(result.unassessed).toBe(1);
    expect(result.employeesEvaluated).toBe(0);
    expect(result.wouldTrigger).toBe(0);
    expect(result.criticalCount).toBe(0);
    expect(result.notes.join(" ")).toMatch(/unscored audit is a process failure/);

    // And the evaluator agrees.
    expect(evaluateCoachingTrigger({
      qualityPercentage: null, fatalTriggered: false, targetPercentage: 55,
      consecutiveShortfalls: 0, sampleSize: 10,
    })).toBeNull();
  });

  it("applies the audit minimum the same way on both sides", async () => {
    execute
      .mockResolvedValueOnce(proc)
      .mockResolvedValueOnce(rows([
        historyRow({ employee_id: "few", employee_code: "FEW", avg_quality: 10, audit_count: 2 }),
        historyRow({ employee_id: "many", employee_code: "MANY", avg_quality: 10, audit_count: 3 }),
      ]));

    const result = await simulateQualityTarget({
      processId: "p1", targetScore: 55, minAuditCount: 3,
    });

    // The one below the minimum is reported, not judged...
    expect(result.insufficientAudits).toBe(1);
    expect(result.employees.map((e) => e.employeeCode)).toEqual(["MANY"]);
    // ...which is exactly what the evaluator does with the same sample size.
    expect(evaluateCoachingTrigger({
      qualityPercentage: 10, fatalTriggered: false, targetPercentage: 55,
      consecutiveShortfalls: 0, sampleSize: 2, thresholds: { minSample: 3 },
    })).toBeNull();
    expect(evaluateCoachingTrigger({
      qualityPercentage: 10, fatalTriggered: false, targetPercentage: 55,
      consecutiveShortfalls: 0, sampleSize: 3, thresholds: { minSample: 3 },
    })).not.toBeNull();
  });
});

describe("the evaluator's own defaults are unchanged", () => {
  it("still falls back to 0.9 / 0.75 / 3 when no thresholds are given", () => {
    // Every existing caller relies on this; making thresholds configurable must
    // not silently move the bar for anyone who has not configured one.
    expect(DEFAULT_COACHING_THRESHOLDS).toEqual({
      warningRatio: 0.9, criticalRatio: 0.75, minSample: 3,
    });

    // 49.5 / 55 is exactly 0.9 — not short.
    expect(evaluateCoachingTrigger({
      qualityPercentage: 49.5, fatalTriggered: false, targetPercentage: 55,
      consecutiveShortfalls: 0, sampleSize: 10,
    })).toBeNull();

    expect(evaluateCoachingTrigger({
      qualityPercentage: 49.4, fatalTriggered: false, targetPercentage: 55,
      consecutiveShortfalls: 0, sampleSize: 10,
    })).not.toBeNull();
  });

  it("still raises a fatal regardless of thresholds or sample size", () => {
    // A compliance event, not a performance average — so no configuration
    // should be able to suppress it.
    expect(evaluateCoachingTrigger({
      qualityPercentage: 100, fatalTriggered: true, targetPercentage: 55,
      consecutiveShortfalls: 0, sampleSize: 1,
      thresholds: { warningRatio: 0.1, criticalRatio: 0.05, minSample: 99 },
    })).toMatchObject({ priority: "critical", sessionType: "quality" });
  });

  it("still refuses to judge without a target", () => {
    for (const targetPercentage of [null, 0]) {
      expect(evaluateCoachingTrigger({
        qualityPercentage: 10, fatalTriggered: false, targetPercentage,
        consecutiveShortfalls: 0, sampleSize: 10,
      })).toBeNull();
    }
  });
});
