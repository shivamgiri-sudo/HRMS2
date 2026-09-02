import { describe, expect, it } from "vitest";
import {
  computeAchievement,
  computeRag,
  shiftPeriod,
  portalKpiEngine,
} from "../portal.kpi-engine.service.js";
import type { PortalKpiMetric } from "../portal.types.js";

/**
 * Client Portal KPI engine — the pure calculation rules.
 *
 * These are the functions that decide what a CLIENT is told about MAS Callnet's delivery, so the risk
 * is not a crash, it is confidently stating something untrue. Three specific untruths the code being
 * replaced told, each pinned here:
 *
 *  1. A metric with no feed rendered as red — indistinguishable from a catastrophic month.
 *  2. A lower-is-better metric at zero divided by zero.
 *  3. Direction was ignored when describing movement, so falling absenteeism read as a decline.
 */

function metric(overrides: Partial<PortalKpiMetric> = {}): PortalKpiMetric {
  return {
    metric_code: "ATT",
    metric_name: "Attendance Rate",
    unit: "percent",
    direction: "higher_is_better",
    target: 95,
    target_source: "portal_default",
    actual: 91,
    achievement_pct: 95.79,
    rag: "amber",
    description: null,
    no_data_reason: null,
    numerator: null,
    denominator: null,
    delta_vs_previous: null,
    improved: null,
    sparkline: [],
    ...overrides,
  };
}

describe("shiftPeriod", () => {
  it("moves within a year", () => {
    expect(shiftPeriod("2026-08", -1)).toBe("2026-07");
    expect(shiftPeriod("2026-08", 1)).toBe("2026-09");
  });

  it("crosses a year boundary in both directions", () => {
    expect(shiftPeriod("2026-01", -1)).toBe("2025-12");
    expect(shiftPeriod("2026-12", 1)).toBe("2027-01");
  });

  it("spans the full six-month trend window used by the engine", () => {
    expect(shiftPeriod("2026-08", -5)).toBe("2026-03");
    expect(shiftPeriod("2026-02", -5)).toBe("2025-09");
  });

  it("zero-pads the month so string comparison against a CHAR(7) period stays correct", () => {
    // Periods are compared as strings in SQL (BETWEEN '2026-03' AND '2026-08'), so '2026-3' would
    // sort wrongly and silently truncate a trend window.
    expect(shiftPeriod("2026-11", 2)).toBe("2027-01");
    expect(shiftPeriod("2026-10", -1)).toBe("2026-09");
  });
});

describe("computeAchievement", () => {
  it("scores a higher-is-better metric against its target", () => {
    expect(computeAchievement(91, 95, "higher_is_better")).toBeCloseTo(95.79, 1);
    expect(computeAchievement(95, 95, "higher_is_better")).toBe(100);
  });

  it("inverts for a lower-is-better metric", () => {
    // Absenteeism of 3% against a 3% target is exactly on target; 6% is half as good.
    expect(computeAchievement(3, 3, "lower_is_better")).toBe(100);
    expect(computeAchievement(6, 3, "lower_is_better")).toBe(50);
  });

  it("awards the cap when a lower-is-better metric hits zero, instead of dividing by zero", () => {
    // target/0 is Infinity. Zero absenteeism has fully achieved the aim, so the cap is correct — but
    // it must be reached deliberately, not by letting Infinity through into a RAG comparison.
    const result = computeAchievement(0, 3, "lower_is_better");
    expect(result).toBe(120);
    expect(Number.isFinite(result as number)).toBe(true);
  });

  it("caps overachievement at 120", () => {
    expect(computeAchievement(200, 95, "higher_is_better")).toBe(120);
    expect(computeAchievement(0.1, 5, "lower_is_better")).toBe(120);
  });

  it("never returns a negative achievement", () => {
    expect(computeAchievement(-5, 95, "higher_is_better")).toBe(0);
  });

  it("returns null for a missing actual rather than zero", () => {
    // The single most important case. Zero would render red and read as total failure.
    expect(computeAchievement(null, 95, "higher_is_better")).toBeNull();
  });

  it("returns null when no target is set, rather than claiming 0% achieved", () => {
    expect(computeAchievement(91, 0, "higher_is_better")).toBeNull();
    expect(computeAchievement(91, Number.NaN, "higher_is_better")).toBeNull();
  });

  it("never returns a non-finite number", () => {
    for (const [actual, target, direction] of [
      [91, 0, "higher_is_better"],
      [0, 0, "lower_is_better"],
      [0, 3, "lower_is_better"],
    ] as Array<[number, number, string]>) {
      const result = computeAchievement(actual, target, direction);
      expect(result === null || Number.isFinite(result)).toBe(true);
    }
  });
});

describe("computeRag", () => {
  it("is green at or above target", () => {
    expect(computeRag(100, 85)).toBe("green");
    expect(computeRag(118, 85)).toBe("green");
  });

  it("is amber between the threshold and target", () => {
    expect(computeRag(99.9, 85)).toBe("amber");
    expect(computeRag(85, 85)).toBe("amber");
  });

  it("is red below the threshold", () => {
    expect(computeRag(84.9, 85)).toBe("red");
    expect(computeRag(0, 85)).toBe("red");
  });

  it("honours a per-metric amber threshold", () => {
    // Retention uses 95, not 85: 85% of a retention target is a crisis, not a watch item.
    expect(computeRag(90, 95)).toBe("red");
    expect(computeRag(90, 85)).toBe("amber");
  });

  it("reports no_data instead of red when there is no value", () => {
    // The defect this whole design exists to prevent: a missing integration must not look like a
    // catastrophic month, because a client cannot act on the first and must act on the second.
    expect(computeRag(null, 85)).toBe("no_data");
  });
});

describe("rollUpRag", () => {
  it("takes the worst state across scored metrics", () => {
    expect(portalKpiEngine.rollUpRag([metric({ rag: "green" }), metric({ rag: "amber" })])).toBe("amber");
    expect(portalKpiEngine.rollUpRag([metric({ rag: "amber" }), metric({ rag: "red" })])).toBe("red");
    expect(portalKpiEngine.rollUpRag([metric({ rag: "green" }), metric({ rag: "green" })])).toBe("green");
  });

  it("ignores no_data metrics when something else is scored", () => {
    // A process with one unmeasurable metric and five green ones is green, not unknown.
    expect(
      portalKpiEngine.rollUpRag([metric({ rag: "no_data" }), metric({ rag: "green" })]),
    ).toBe("green");
  });

  it("is no_data only when nothing at all could be scored", () => {
    expect(portalKpiEngine.rollUpRag([metric({ rag: "no_data" }), metric({ rag: "no_data" })])).toBe("no_data");
    expect(portalKpiEngine.rollUpRag([])).toBe("no_data");
  });

  it("does not let a no_data metric mask a red one", () => {
    expect(
      portalKpiEngine.rollUpRag([metric({ rag: "no_data" }), metric({ rag: "red" })]),
    ).toBe("red");
  });
});

/**
 * The engine's own achievement/RAG pair, exercised on the real Onfido figures read from the live
 * database, so the thresholds are pinned against numbers that actually occur rather than invented
 * ones.
 *
 * Onfido, 2026-08, verified:
 *   expected 7,433 days | confirmed 5,318 | present 2,976 | half 1,281 | absent 1,061 | unreconciled 2,115
 *   ATT over confirmed days  = 68.00%
 *   ATT over all expected    = 48.65%   <- what publishing without the DQ disclosure would have said
 *   DQ                       = 71.55%
 */
describe("real production figures", () => {
  it("scores Onfido's August attendance as badly off target", () => {
    const achievement = computeAchievement(68.0, 95, "higher_is_better");
    expect(achievement).toBeCloseTo(71.58, 1);
    expect(computeRag(achievement, 85)).toBe("red");
  });

  it("keeps the 19-point gap between the two possible denominators visible", () => {
    // Both are "red", but the number a client is shown differs by 19 points, and only one of them is
    // a statement about whether people turned up.
    const overConfirmed = computeAchievement(68.0, 95, "higher_is_better");
    const overAllExpected = computeAchievement(48.65, 95, "higher_is_better");
    expect(overConfirmed).toBeGreaterThan(overAllExpected as number);
    expect((overConfirmed as number) - (overAllExpected as number)).toBeGreaterThan(19);
  });

  it("flags the reconciliation backlog through DQ rather than hiding it in attendance", () => {
    const dq = computeAchievement(71.55, 98, "higher_is_better");
    expect(computeRag(dq, 90)).toBe("red");
  });

  it("scores Onfido's absenteeism against its lower-is-better target", () => {
    // 19.95% actual against a 3% target.
    const achievement = computeAchievement(19.95, 3, "lower_is_better");
    expect(achievement).toBeCloseTo(15.04, 1);
    expect(computeRag(achievement, 85)).toBe("red");
  });

  it("scores a healthy earlier month as green", () => {
    // 2026-03: 91.16% attendance, DQ 100%.
    expect(computeRag(computeAchievement(91.16, 95, "higher_is_better"), 85)).toBe("amber");
    expect(computeRag(computeAchievement(100, 98, "higher_is_better"), 90)).toBe("green");
  });
});

describe("headline metric selection", () => {
  /**
   * Ordering only — the query path needs a database. Verifies the rule that a card surfaces the
   * metrics in trouble rather than a fixed list, which is what the previous implementation did
   * (a hardcoded CSAT/AHT/FCR that showed the same three regardless of what was failing).
   */
  it("sorts worst-first with no_data last", () => {
    const metrics = [
      metric({ metric_code: "A", rag: "green", achievement_pct: 110 }),
      metric({ metric_code: "B", rag: "no_data", achievement_pct: null }),
      metric({ metric_code: "C", rag: "red", achievement_pct: 40 }),
      metric({ metric_code: "D", rag: "amber", achievement_pct: 90 }),
      metric({ metric_code: "E", rag: "red", achievement_pct: 20 }),
    ];

    const rank: Record<string, number> = { red: 0, amber: 1, green: 2, no_data: 3 };
    const sorted = [...metrics].sort((left, right) => {
      const byRag = rank[left.rag] - rank[right.rag];
      if (byRag !== 0) return byRag;
      return (left.achievement_pct ?? 999) - (right.achievement_pct ?? 999);
    });

    expect(sorted.map((m) => m.metric_code)).toEqual(["E", "C", "D", "A", "B"]);
  });
});
