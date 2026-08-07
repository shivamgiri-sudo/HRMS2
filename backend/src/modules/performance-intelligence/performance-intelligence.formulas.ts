import {
  type CalculationStatus,
  type MetricFact,
  type MetricStatus,
  type PerformanceDirection,
  type PerformanceMetricResult,
} from "./performance-intelligence.contracts.js";

function round(value: number, decimals = 2): number {
  const bounded = Math.max(0, Math.min(6, Math.trunc(decimals)));
  const factor = 10 ** bounded;
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
  maxAchievementPct = 120,
): number | null {
  if (value === null || target === null || target <= 0 || value < 0) return null;
  if (direction === "lower_is_better" && value === 0) return Math.max(0, maxAchievementPct);

  const raw = direction === "lower_is_better"
    ? (target / value) * 100
    : (value / target) * 100;
  return round(Math.min(raw, Math.max(0, maxAchievementPct)));
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

function aggregateGroup(facts: MetricFact[]): PerformanceMetricResult {
  const ordered = [...facts].sort((left, right) =>
    left.scoreDate.localeCompare(right.scoreDate) || left.computedAt.localeCompare(right.computedAt));
  const first = ordered[0];
  const actualFacts = ordered.filter((fact) => finiteOrNull(fact.actualValue) !== null);
  const actualValues = actualFacts.map((fact) => Number(fact.actualValue));
  const componentFacts = actualFacts.filter((fact) =>
    finiteOrNull(fact.numeratorValue) !== null && finiteOrNull(fact.denominatorValue) !== null);
  const method = String(first?.aggregationMethod ?? "average").toLowerCase();
  const decimals = first?.decimalPlaces ?? 2;
  const allFormulaVersioned = actualFacts.length > 0 && actualFacts.every((fact) => Boolean(fact.formulaVersion));

  let value: number | null = null;
  let calculationStatus: CalculationStatus = "missing";

  if (method === "sum" && actualValues.length > 0) {
    value = round(actualValues.reduce((sum, current) => sum + current, 0), decimals);
    calculationStatus = allFormulaVersioned ? "verified" : "legacy_unverified";
  } else if (method === "latest" && actualFacts.length > 0) {
    value = round(Number(actualFacts.at(-1)?.actualValue), decimals);
    calculationStatus = allFormulaVersioned ? "verified" : "legacy_unverified";
  } else if (method === "ratio" && componentFacts.length > 0) {
    const numerator = componentFacts.reduce((sum, fact) => sum + Number(fact.numeratorValue), 0);
    const denominator = componentFacts.reduce((sum, fact) => sum + Number(fact.denominatorValue), 0);
    if (denominator > 0) {
      const multiplier = finiteOrNull(first?.calculationMultiplier) ?? 100;
      value = round((numerator / denominator) * multiplier, decimals);
      calculationStatus = componentFacts.length === actualFacts.length && allFormulaVersioned
        ? "verified"
        : "legacy_unverified";
    }
  } else if (method === "weighted_average" && actualValues.length > 0) {
    const weightedFacts = actualFacts.filter((fact) => finiteOrNull(fact.sourceRecordCount) !== null);
    const totalWeight = weightedFacts.reduce((sum, fact) => sum + Math.max(0, Number(fact.sourceRecordCount)), 0);
    value = totalWeight > 0
      ? round(weightedFacts.reduce(
          (sum, fact) => sum + Number(fact.actualValue) * Math.max(0, Number(fact.sourceRecordCount)),
          0,
        ) / totalWeight, decimals)
      : round(actualValues.reduce((sum, current) => sum + current, 0) / actualValues.length, decimals);
    calculationStatus = allFormulaVersioned ? "verified" : "legacy_unverified";
  } else if (actualValues.length > 0) {
    value = round(actualValues.reduce((sum, current) => sum + current, 0) / actualValues.length, decimals);
    calculationStatus = allFormulaVersioned ? "verified" : "legacy_unverified";
  }

  // Preserve visibility for older facts that do not yet carry numerator/denominator lineage.
  if (value === null && actualValues.length > 0) {
    value = round(actualValues.reduce((sum, current) => sum + current, 0) / actualValues.length, decimals);
    calculationStatus = "legacy_unverified";
  }

  const target = ordered
    .map((fact) => finiteOrNull(fact.targetValue))
    .find((candidate): candidate is number => candidate !== null) ?? null;
  const direction = first?.direction ?? "higher_is_better";
  const maxAchievementPct = Math.max(...ordered.map((fact) => Number(fact.maxAchievementPct ?? 120)), 0);
  const achievementPct = calculateAchievement(value, target, direction, maxAchievementPct || 120);
  const sourceSystems = Array.from(new Set(
    ordered.map((fact) => fact.sourceSystem?.trim()).filter((source): source is string => Boolean(source)),
  )).sort();
  const latestComputedAt = ordered
    .map((fact) => fact.computedAt)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;

  return {
    metricCode: first?.metricCode ?? "UNKNOWN",
    label: first?.metricName ?? first?.metricCode ?? "Metric",
    unit: first?.unit ?? "count",
    value,
    target,
    weightage: Math.max(0, Number(first?.weightage ?? 100)),
    displayOrder: Number(first?.displayOrder ?? 100),
    achievementPct,
    status: metricStatus(value, target, achievementPct),
    calculationStatus,
    sourceSystems,
    recordCount: ordered.reduce(
      (sum, fact) => sum + Math.max(0, Number(fact.sourceRecordCount ?? 0)),
      0,
    ),
    latestComputedAt,
  };
}

export function aggregateMetricFacts(facts: MetricFact[]): PerformanceMetricResult[] {
  const grouped = new Map<string, MetricFact[]>();
  for (const fact of facts) {
    const rows = grouped.get(fact.metricCode) ?? [];
    rows.push(fact);
    grouped.set(fact.metricCode, rows);
  }
  return [...grouped.values()]
    .map(aggregateGroup)
    .sort((left, right) => left.displayOrder - right.displayOrder || left.label.localeCompare(right.label));
}
