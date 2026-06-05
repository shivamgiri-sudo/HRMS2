export type KpiScoringType =
  | "fixed"
  | "client_sla"
  | "historical_baseline"
  | "dynamic"
  | "range"
  | "higher_better"
  | "lower_better"
  | "boolean"
  | "fatal"
  | "threshold"
  | "manual"
  | "calculated"
  | "higher_is_better"
  | "lower_is_better";

export interface KpiScoreInput {
  scoringType: KpiScoringType | string;
  actualValue: number | string | null | undefined;
  targetValue: number | string | null | undefined;
  minValue?: number | string | null;
  maxValue?: number | string | null;
  weightage?: number | string | null;
  fatalRule?: Record<string, unknown> | null;
  thresholdRule?: Record<string, unknown> | null;
}

export interface KpiScoreResult {
  metricScore: number;
  weightedScore: number;
  status: "calculated" | "missing_source" | "fatal_breached" | "threshold_failed";
  note: string;
}

const round2 = (value: number) => (Number.isFinite(value) ? Math.round(value * 100) / 100 : 0);

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function calculateMetricScore(input: KpiScoreInput): KpiScoreResult {
  const actual = toNumber(input.actualValue);
  const target = toNumber(input.targetValue);
  const min = toNumber(input.minValue);
  const max = toNumber(input.maxValue);
  const weightage = toNumber(input.weightage) ?? 0;
  const scoringType = String(input.scoringType || "higher_better");

  if (actual === null && scoringType !== "manual") {
    return { metricScore: 0, weightedScore: 0, status: "missing_source", note: "Actual value missing" };
  }

  let metricScore = 0;
  let note = "Calculated";

  if (scoringType === "lower_better" || scoringType === "lower_is_better") {
    if (actual === 0) {
      metricScore = 100;
      note = "Lower-better zero actual treated as full score";
    } else if (!target || !actual || actual <= 0) {
      metricScore = 0;
      note = "Invalid lower-better target/actual";
    } else {
      metricScore = (target / actual) * 100;
    }
  } else if (scoringType === "range") {
    metricScore = actual !== null && min !== null && max !== null && actual >= min && actual <= max ? 100 : 0;
    if (metricScore === 0) note = "Actual outside configured range";
  } else if (scoringType === "boolean") {
    metricScore = actual && actual > 0 ? 100 : 0;
  } else if (scoringType === "fatal") {
    const allowedValue = Number(input.fatalRule?.allowedValue ?? target ?? 0);
    if ((actual ?? 0) > allowedValue) {
      const cap = input.fatalRule?.capFinalScore;
      metricScore = typeof cap === "number" ? cap : 0;
      return { metricScore: round2(metricScore), weightedScore: round2((metricScore * weightage) / 100), status: "fatal_breached", note: "Fatal threshold breached" };
    }
    metricScore = 100;
  } else if (scoringType === "threshold") {
    const minRequired = Number(input.thresholdRule?.minRequired ?? target ?? 0);
    if ((actual ?? 0) < minRequired) return { metricScore: 0, weightedScore: 0, status: "threshold_failed", note: "Threshold not met" };
    metricScore = 100;
  } else {
    if (!target || target <= 0) {
      metricScore = 0;
      note = "Invalid target";
    } else {
      metricScore = ((actual ?? 0) / target) * 100;
    }
  }

  const cappedScore = Math.max(0, Math.min(metricScore, 120));
  return { metricScore: round2(cappedScore), weightedScore: round2((cappedScore * weightage) / 100), status: "calculated", note };
}

export function ratingForScore(score: number): string {
  if (score >= 95) return "Outstanding";
  if (score >= 85) return "Exceeds";
  if (score >= 75) return "Meets";
  if (score >= 60) return "Needs Improvement";
  return "Critical";
}
