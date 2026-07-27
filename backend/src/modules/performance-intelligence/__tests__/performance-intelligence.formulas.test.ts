import { describe, expect, it } from "vitest";
import type {
  MetricFact,
  PerformanceMetricCode,
  PerformanceMetricResult,
} from "../performance-intelligence.contracts.js";
import {
  aggregateMetricFacts,
  calculateAchievement,
} from "../performance-intelligence.formulas.js";

function metricMeta(metricCode: string) {
  if (["CALLS", "REVENUE", "SALES_COUNT"].includes(metricCode)) {
    return {
      aggregationMethod: "sum",
      unit: metricCode === "REVENUE" ? "currency" : "count",
    };
  }
  if (["AHT", "AOV", "QUALITY_SCORE", "FATAL_RATE"].includes(metricCode)) {
    return {
      aggregationMethod: metricCode === "QUALITY_SCORE" ? "ratio" : "ratio",
      unit: metricCode === "AHT" ? "seconds" : metricCode === "AOV" ? "currency" : "percent",
    };
  }
  return { aggregationMethod: "average", unit: "percent" };
}

function fact(
  metricCode: PerformanceMetricCode,
  actualValue: number | null,
  overrides: Partial<MetricFact> = {},
): MetricFact {
  const meta = metricMeta(metricCode);
  return {
    employeeId: "employee-1",
    metricCode,
    metricName: metricCode,
    unit: meta.unit,
    aggregationMethod: meta.aggregationMethod,
    decimalPlaces: 2,
    displayOrder: 100,
    scoreDate: "2026-07-01",
    actualValue,
    numeratorValue: null,
    denominatorValue: null,
    targetValue: metricCode === "AHT" ? 100 : 90,
    weightage: 100,
    maxAchievementPct: 120,
    direction: metricCode === "AHT" || metricCode === "FATAL_RATE"
      ? "lower_is_better"
      : "higher_is_better",
    sourceSystem: "test-source",
    sourceRecordCount: 1,
    formulaVersion: null,
    computedAt: "2026-07-01T12:00:00.000Z",
    ...overrides,
  };
}

function byCode(
  results: PerformanceMetricResult[],
  metricCode: PerformanceMetricCode,
): PerformanceMetricResult {
  const result = results.find((row) => row.metricCode === metricCode);
  if (!result) throw new Error(`Missing result for ${metricCode}`);
  return result;
}

describe("aggregateMetricFacts", () => {
  it("sums call volume", () => {
    const result = aggregateMetricFacts([
      fact("CALLS", 10),
      fact("CALLS", 15),
    ]);

    expect(byCode(result, "CALLS").value).toBe(25);
  });

  it("uses the stored numerator and denominator for AHT", () => {
    const result = aggregateMetricFacts([
      fact("AHT", 100, {
        numeratorValue: 200,
        denominatorValue: 2,
        formulaVersion: "AHT_WEIGHTED:v1",
      }),
      fact("AHT", 50, {
        numeratorValue: 150,
        denominatorValue: 3,
        formulaVersion: "AHT_WEIGHTED:v1",
      }),
    ]);

    expect(byCode(result, "AHT").value).toBe(70);
    expect(byCode(result, "AHT").calculationStatus).toBe("verified");
  });

  it("calculates percentage metrics from their stored components", () => {
    const result = aggregateMetricFacts([
      fact("QUALITY_SCORE", 80, {
        numeratorValue: 80,
        denominatorValue: 100,
        formulaVersion: "QUALITY_WEIGHTED:v1",
      }),
      fact("QUALITY_SCORE", 90, {
        numeratorValue: 45,
        denominatorValue: 50,
        formulaVersion: "QUALITY_WEIGHTED:v1",
      }),
    ]);

    expect(byCode(result, "QUALITY_SCORE").value).toBeCloseTo(83.33, 2);
  });

  it("sums revenue and sales while deriving AOV from stored sales components", () => {
    const result = aggregateMetricFacts([
      fact("REVENUE", 1200, {
        numeratorValue: 1200,
        sourceRecordCount: 2,
        formulaVersion: "REVENUE_TOTAL:v1",
      }),
      fact("REVENUE", 800, {
        numeratorValue: 800,
        sourceRecordCount: 1,
        formulaVersion: "REVENUE_TOTAL:v1",
      }),
      fact("SALES_COUNT", 3, {
        numeratorValue: 3,
        formulaVersion: "SALES_TOTAL:v1",
      }),
      fact("AOV", 0, {
        numeratorValue: 2000,
        denominatorValue: 3,
        formulaVersion: "AOV_WEIGHTED:v1",
      }),
    ]);

    expect(byCode(result, "REVENUE")).toMatchObject({ value: 2000, unit: "currency" });
    expect(byCode(result, "SALES_COUNT").value).toBe(3);
    expect(byCode(result, "AOV")).toMatchObject({ value: 666.67, unit: "currency" });
  });

  it("does not label a component-free fallback as verified", () => {
    const result = aggregateMetricFacts([
      fact("QUALITY_SCORE", 80),
      fact("QUALITY_SCORE", 90),
    ]);

    expect(byCode(result, "QUALITY_SCORE").value).toBe(85);
    expect(byCode(result, "QUALITY_SCORE").calculationStatus).toBe("legacy_unverified");
  });

  it("supports a process-specific custom metric without a code deployment", () => {
    const result = aggregateMetricFacts([
      fact("EXTRACTION_ACCURACY", 98.4, {
        metricName: "Extraction Accuracy",
        aggregationMethod: "average",
        unit: "percent",
        displayOrder: 5,
        weightage: 30,
        targetValue: 98,
      }),
    ]);

    expect(byCode(result, "EXTRACTION_ACCURACY")).toMatchObject({
      label: "Extraction Accuracy",
      value: 98.4,
      weightage: 30,
      displayOrder: 5,
    });
  });

  it("returns a missing result when facts contain no usable value", () => {
    const result = aggregateMetricFacts([fact("ADHERENCE", null)]);

    expect(byCode(result, "ADHERENCE")).toMatchObject({
      value: null,
      calculationStatus: "missing",
      status: "missing",
    });
  });
});

describe("calculateAchievement", () => {
  it("reverses and caps achievement for lower-is-better metrics", () => {
    expect(calculateAchievement(80, 100, "lower_is_better")).toBe(120);
  });

  it("uses direct target achievement for higher-is-better metrics", () => {
    expect(calculateAchievement(90, 100, "higher_is_better")).toBe(90);
  });

  it("returns null when target arithmetic is invalid", () => {
    expect(calculateAchievement(null, 100, "higher_is_better")).toBeNull();
    expect(calculateAchievement(10, 0, "higher_is_better")).toBeNull();
  });
});
