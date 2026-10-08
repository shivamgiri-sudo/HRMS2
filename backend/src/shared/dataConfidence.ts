type ConfidenceSignal = {
  key?: string;
  present?: boolean;
  weight?: number;
  quality?: number;
};

export type DataConfidenceResult = {
  confidence_score: number;
  missing_items: string[];
  risk_level: "low" | "medium" | "high" | "critical";
};

export type DataConfidenceInput =
  | Array<string | boolean | number | null | undefined | ConfidenceSignal>
  | {
      requiredFields?: string[];
      availableFields?: string[];
      staleSources?: string[];
      missingMappings?: string[];
      syncStatus?: "healthy" | "warning" | "delayed" | "failed" | string;
      lastUpdatedAt?: string | Date | null;
      signals?: Array<string | boolean | number | null | undefined | ConfidenceSignal>;
      completeness?: number;
      freshness?: number;
      consistency?: number;
      sourceReliability?: number;
      sampleSize?: number;
      expectedSampleSize?: number;
      penalties?: number;
    };

function clamp(value: number, min = 0, max = 100): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function normalizePercent(value: number | undefined, fallback = 0): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  return clamp(value <= 1 ? value * 100 : value);
}

function signalScore(signal: string | boolean | number | null | undefined | ConfidenceSignal): { score: number; weight: number } {
  if (signal == null) return { score: 0, weight: 1 };
  if (typeof signal === "boolean") return { score: signal ? 100 : 0, weight: 1 };
  if (typeof signal === "number") return { score: normalizePercent(signal), weight: 1 };
  if (typeof signal === "string") return { score: signal.trim() ? 100 : 0, weight: 1 };

  const weight = signal.weight && signal.weight > 0 ? signal.weight : 1;
  const score = signal.present === false ? 0 : normalizePercent(signal.quality, signal.present ? 100 : 0);
  return { score, weight };
}

function calculateSignalConfidence(signals: Array<string | boolean | number | null | undefined | ConfidenceSignal>): number {
  if (signals.length === 0) return 0;

  let weightedScore = 0;
  let totalWeight = 0;
  for (const signal of signals) {
    const item = signalScore(signal);
    weightedScore += item.score * item.weight;
    totalWeight += item.weight;
  }

  return totalWeight > 0 ? weightedScore / totalWeight : 0;
}

function riskLevel(score: number): DataConfidenceResult["risk_level"] {
  if (score >= 85) return "low";
  if (score >= 65) return "medium";
  if (score >= 40) return "high";
  return "critical";
}

function freshnessFrom(lastUpdatedAt: string | Date | null | undefined): number | undefined {
  if (!lastUpdatedAt) return undefined;
  const updated = lastUpdatedAt instanceof Date ? lastUpdatedAt : new Date(lastUpdatedAt);
  if (Number.isNaN(updated.getTime())) return undefined;
  const ageHours = Math.max(0, (Date.now() - updated.getTime()) / 36e5);
  if (ageHours <= 4) return 100;
  if (ageHours <= 24) return 85;
  if (ageHours <= 72) return 65;
  if (ageHours <= 168) return 45;
  return 20;
}

function syncPenalty(status: string | undefined): number {
  const normalized = String(status ?? "").toLowerCase();
  if (!normalized || normalized === "healthy" || normalized === "ok" || normalized === "success") return 0;
  if (normalized === "warning" || normalized === "partial") return 5;
  if (normalized === "delayed" || normalized === "stale") return 12;
  if (normalized === "failed" || normalized === "error") return 25;
  return 8;
}

function calculateScore(input: DataConfidenceInput): number {
  if (Array.isArray(input)) return Math.round(calculateSignalConfidence(input));

  const components: Array<{ score: number; weight: number }> = [];

  if (input.requiredFields) {
    const required = new Set(input.requiredFields);
    const available = new Set(input.availableFields ?? []);
    components.push({
      score: required.size === 0 ? 100 : clamp((Array.from(required).filter((field) => available.has(field)).length / required.size) * 100),
      weight: 4,
    });
  }

  if (input.signals) components.push({ score: calculateSignalConfidence(input.signals), weight: 3 });
  if (input.completeness != null) components.push({ score: normalizePercent(input.completeness), weight: 3 });
  const freshness = input.freshness ?? freshnessFrom(input.lastUpdatedAt);
  if (freshness != null) components.push({ score: normalizePercent(freshness), weight: 2 });
  if (input.consistency != null) components.push({ score: normalizePercent(input.consistency), weight: 2 });
  if (input.sourceReliability != null) components.push({ score: normalizePercent(input.sourceReliability), weight: 2 });

  if (input.sampleSize != null && input.expectedSampleSize != null && input.expectedSampleSize > 0) {
    components.push({
      score: clamp((input.sampleSize / input.expectedSampleSize) * 100),
      weight: 1,
    });
  }

  if (components.length === 0) return 0;

  const weighted = components.reduce((sum, item) => sum + item.score * item.weight, 0);
  const weight = components.reduce((sum, item) => sum + item.weight, 0);
  return Math.round(clamp(weighted / weight - (input.penalties ?? 0) - syncPenalty(input.syncStatus)));
}

export function calculateDataConfidence(input: DataConfidenceInput): DataConfidenceResult {
  const score = calculateScore(input);
  const missingItems = new Set<string>();

  if (!Array.isArray(input)) {
    const available = new Set(input.availableFields ?? []);
    for (const field of input.requiredFields ?? []) {
      if (!available.has(field)) missingItems.add(field);
    }
    for (const source of input.staleSources ?? []) missingItems.add(`stale:${source}`);
    for (const mapping of input.missingMappings ?? []) missingItems.add(`mapping:${mapping}`);
    if (input.syncStatus && syncPenalty(input.syncStatus) >= 12) missingItems.add(`sync:${input.syncStatus}`);
  }

  return {
    confidence_score: score,
    missing_items: Array.from(missingItems),
    risk_level: riskLevel(score),
  };
}
