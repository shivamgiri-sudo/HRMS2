import { describe, expect, it } from "vitest";
import { buildPositiveSignals } from "../daily-brief-positive-signals.module.js";
import type { AttendanceSummary } from "../daily-brief.types.js";
import type { KpiPerformanceModuleResult } from "../daily-brief-kpi.module.js";
import type { QualityModuleResult } from "../daily-brief-quality.module.js";

function attendance(overrides: Partial<AttendanceSummary> = {}): AttendanceSummary {
  return {
    recordDate: "2026-08-18",
    present: 5,
    halfDay: 0,
    absent: 0,
    missingPunch: 0,
    lateCount: 0,
    expectedToWork: 5,
    attendancePct: 100,
    ...overrides,
  };
}

function kpi(overrides: Partial<KpiPerformanceModuleResult> = {}): KpiPerformanceModuleResult {
  return {
    employeeSignals: [],
    performanceAlerts: { unacknowledgedCount: 0, items: [] },
    coaching: { dueOrOverdueCount: 0, completedD1Count: 0, dueOrOverdue: [], completedD1: [] },
    trainingNeeds: { openedD1Count: 0, resolvedD1Count: 0, openedD1: [], resolvedD1: [] },
    sourceHealth: [],
    ...overrides,
  };
}

function quality(overrides: Partial<QualityModuleResult> = {}): QualityModuleResult {
  return {
    detailLevel: "summary",
    teamSize: 5,
    auditedEmployeeCount: 0,
    auditCoveragePct: null,
    avgQualityPct: null,
    scoredCallCount: 0,
    topPerformers: [],
    trailingBaseline: null,
    deterioration: null,
    parameterFailRates: null,
    sourceHealth: [],
    ...overrides,
  };
}

describe("daily-brief-positive-signals.module", () => {
  it("returns no signals when there is genuinely nothing positive to report (never fabricates)", () => {
    const signals = buildPositiveSignals(
      attendance({ attendancePct: 62, lateCount: 3, expectedToWork: 5 }),
      kpi(),
      quality(),
    );
    expect(signals).toEqual([]);
  });

  it("100% attendance and zero late marks both surface with high confidence", () => {
    const signals = buildPositiveSignals(attendance(), kpi(), quality());
    expect(signals.map((s) => s.key)).toEqual(
      expect.arrayContaining(["attendance_100pct", "zero_late_marks"]),
    );
    expect(signals.every((s) => s.confidence === "high")).toBe(true);
  });

  it("does not claim 100% attendance when no one was expected to work (avoids a vacuous positive)", () => {
    const signals = buildPositiveSignals(
      attendance({ expectedToWork: 0, attendancePct: null, lateCount: 0 }),
      kpi(),
      quality(),
    );
    expect(signals.find((s) => s.key === "attendance_100pct")).toBeUndefined();
    // lateCount also gated on expectedToWork > 0 for the same reason.
    expect(signals.find((s) => s.key === "zero_late_marks")).toBeUndefined();
  });

  it("KPI target-exceeded signal reflects the KPI module's own above_or_at_target classification", () => {
    const signals = buildPositiveSignals(
      attendance({ attendancePct: 80, lateCount: 1 }),
      kpi({
        employeeSignals: [
          {
            employeeId: "e1", employeeCode: "MAS001", fullName: "Alice",
            metricId: "m1", metricCode: "CSAT", metricName: "Customer Satisfaction",
            direction: "higher_is_better", d1Value: 95, targetValue: 90, minThreshold: null,
            observation: "above_or_at_target", sevenDayBaselineAvg: null, sevenDayBaselineSampleCount: 0,
            trendVsBaseline: null, note: "",
          },
        ],
      }),
      quality(),
    );
    const kpiSignal = signals.find((s) => s.key === "kpi_target_exceeded");
    expect(kpiSignal).toBeDefined();
    expect(kpiSignal?.value).toBe(1);
  });

  it("quality improvement only surfaces when the quality module already cleared its own sample gate", () => {
    // deterioration is null here — mirrors buildQualityModule never populating it
    // below MIN_SCORED_CALLS_FOR_SIGNAL. No positive should be fabricated.
    const signals = buildPositiveSignals(
      attendance({ attendancePct: 80, lateCount: 1 }),
      kpi(),
      quality({ avgQualityPct: 92, trailingBaseline: { avgQualityPct: 80, scoredCallCount: 1 }, deterioration: null, scoredCallCount: 1 }),
    );
    expect(signals.find((s) => s.key === "quality_improved_vs_baseline")).toBeUndefined();
  });

  it("quality improvement surfaces once the module reports an adequate-sample delta at/above the material floor", () => {
    const signals = buildPositiveSignals(
      attendance({ attendancePct: 80, lateCount: 1 }),
      kpi(),
      quality({
        avgQualityPct: 92,
        trailingBaseline: { avgQualityPct: 85, scoredCallCount: 5 },
        deterioration: { isMaterial: false, deltaPoints: 7, note: "improved" },
        scoredCallCount: 5,
      }),
    );
    const qualitySignal = signals.find((s) => s.key === "quality_improved_vs_baseline");
    expect(qualitySignal).toBeDefined();
    expect(qualitySignal?.value).toBe(7);
  });

  it("caps output at 5 signals", () => {
    const signals = buildPositiveSignals(
      attendance(),
      kpi({
        employeeSignals: [
          { employeeId: "e1", employeeCode: "MAS001", fullName: "A", metricId: "m1", metricCode: "CSAT", metricName: "CSAT", direction: "higher_is_better", d1Value: 95, targetValue: 90, minThreshold: null, observation: "above_or_at_target", sevenDayBaselineAvg: 80, sevenDayBaselineSampleCount: 3, trendVsBaseline: "improved", note: "" },
        ],
      }),
      quality({
        avgQualityPct: 92,
        trailingBaseline: { avgQualityPct: 85, scoredCallCount: 5 },
        deterioration: { isMaterial: false, deltaPoints: 7, note: "improved" },
        scoredCallCount: 5,
      }),
    );
    expect(signals.length).toBeLessThanOrEqual(5);
  });
});
