import {
  PERFORMANCE_METRIC_CODES,
  type CalculationStatus,
  type MetricFact,
  type MetricStatus,
  type PerformanceDirection,
  type PerformanceMetricCode,
  type PerformanceMetricResult,
} from "./performance-intelligence.contracts.js";

const METRIC_META: Record<
  PerformanceMetricCode,
  { label: string; unit: PerformanceMetricResult["unit"] }
> = {
  CALLS: { label: "Handled calls", unit: "count" },
  AHT: { label: "Average handle time", unit: "seconds" },
  ADHERENCE: { label: "Schedule adherence", unit: "percent" },
  UTILIZATION: { label: "Utilization", unit: "percent" },
  QUALITY_SCORE: { label: "Quality score", unit: "percent" },
  FATAL_RATE: { label: "Fatal error rate", unit: "percent" },
  CONVERSION_RATE: { label: "Conversion rate", unit: "percent" },
  SALES_COUNT: { label: "Sales count", unit: "count" },
  REVENUE: { label: "Revenue", unit: "currency" },
  AOV: { label: "Average order value", unit: "currency" },
  COD_SHARE: { label: "COD share", unit: "percent" },
  RTO_RATE: { label: "RTO rate", unit: "percent" },
};

const RATIO_METRICS = new Set<PerformanceMetricCode>([
  "ADHERENCE",
  "UTILIZATION",
  "QUALITY_SCORE",
  "FATAL_RATE",
  "CONVERSION_RATE",
  "AOV",
  "COD_SHARE",
  "RTO_RATE",
]);

const SUM_METRICS = new Set<PerformanceMetricCode>([
  "CALLS",
  "SALES_COUNT",
  "REVENUE",
]);

function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function finiteOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function calculateAchievement(
  value: number | null,
  target: number | null,
  direction: PerformanceDirection,
): number | null {
  if (value === null || target === null || target <= 0 || value < 0) return null;
  if (direction === "lower_is_better" && value === 0) return 999.99;

  const raw = direction === "lower_is_better"
    ? (target / value) * 100
    : (value / target) * 100;
  return round(Math.min(raw, 999.99));
}

function metricStatus(
  value: number | null,
  target: number | null,
  achievementPct: number | null,
): MetricStatus {
  if (value === null) return "missing";
  if (target === null || achievementPct === null) return "no_target";
  if (achievementPct >= 100) return "on_track";
  if (achievementPct >= 90) return "watch";
  return "off_track";
}

function aggregateGroup(
  metricCode: PerformanceMetricCode,
  facts: MetricFact[],
): PerformanceMetricResult {
  const actualValues = facts
    .map((fact) => finiteOrNull(fact.actualValue))
    .filter((value): value is number => value !== null);
  const componentFacts = facts.filter((fact) =>
    finiteOrNull(fact.numeratorValue) !== null &&
    finiteOrNull(fact.denominatorValue) !== null,
  );
  const hasVerifiedLineage =
    componentFacts.length > 0 &&
    componentFacts.length === facts.filter((fact) => fact.actualValue !== null).length &&
    componentFacts.every((fact) => Boolean(fact.formulaVersion));

  let value: number | null = null;
  let calculationStatus: CalculationStatus = "missing";

  if (SUM_METRICS.has(metricCode) && actualValues.length > 0) {
    value = round(actualValues.reduce((sum, current) => sum + current, 0));
    calculationStatus = facts.every((fact) => Boolean(fact.formulaVersion))
      ? "verified"
      : "legacy_unverified";
  } else if ((metricCode === "AHT" || RATIO_METRICS.has(metricCode)) && componentFacts.length > 0) {
    const numerator = componentFacts.reduce(
      (sum, fact) => sum + Number(fact.numeratorValue),
      0,
    );
    const denominator = componentFacts.reduce(
      (sum, fact) => sum + Number(fact.denominatorValue),
      0,
    );
    if (denominator > 0) {
      value = round(metricCode === "AHT" || metricCode === "AOV"
        ? numerator / denominator
        : (numerator / denominator) * 100);
      calculationStatus = hasVerifiedLineage ? "verified" : "legacy_unverified";
    }
  }

  if (value === null && actualValues.length > 0) {
    value = round(
      actualValues.reduce((sum, current) => sum + current, 0) / actualValues.length,
    );
    calculationStatus = "legacy_unverified";
  }

  const target = facts
    .map((fact) => finiteOrNull(fact.targetValue))
    .find((candidate): candidate is number => candidate !== null) ?? null;
  const direction = facts[0]?.direction ?? "higher_is_better";
  const achievementPct = calculateAchievement(value, target, direction);
  const sourceSystems = Array.from(new Set(
    facts.map((fact) => fact.sourceSystem?.trim()).filter((source): source is string => Boolean(source)),
  )).sort();
  const latestComputedAt = facts
    .map((fact) => fact.computedAt)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;

  return {
    metricCode,
    ...METRIC_META[metricCode],
    value,
    target,
    achievementPct,
    status: metricStatus(value, target, achievementPct),
    calculationStatus,
    sourceSystems,
    recordCount: facts.reduce(
      (sum, fact) => sum + Math.max(0, Number(fact.sourceRecordCount ?? 0)),
      0,
    ),
    latestComputedAt,
  };
}

export function aggregateMetricFacts(facts: MetricFact[]): PerformanceMetricResult[] {
  const grouped = new Map<PerformanceMetricCode, MetricFact[]>();
  for (const metricCode of PERFORMANCE_METRIC_CODES) grouped.set(metricCode, []);
  for (const fact of facts) {
    grouped.get(fact.metricCode)?.push(fact);
  }

  return PERFORMANCE_METRIC_CODES
    .filter((metricCode) => (grouped.get(metricCode)?.length ?? 0) > 0)
    .map((metricCode) => aggregateGroup(metricCode, grouped.get(metricCode) ?? []));
}
