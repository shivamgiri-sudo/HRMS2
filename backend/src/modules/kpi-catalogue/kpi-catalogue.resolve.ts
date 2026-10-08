/**
 * The one resolution rule for a KPI target / weight, replacing six different orders.
 *
 *   employee override > role + process > process > department > designation default
 *
 * Effective-dated: a candidate applies only when effective_from <= asOf and (effective_to is null or >= asOf).
 * Within the same tier the later effective_from wins. Weights are normalised to 100 per resolved set so a
 * scorecard can never sum to 340 because every row defaulted to 100.
 */

export type ResolveTier = "employee" | "role_process" | "process" | "department" | "designation";

export const TIER_ORDER: readonly ResolveTier[] = ["employee", "role_process", "process", "department", "designation"];

export interface ResolveCandidate {
  metricKey: string;
  tier: ResolveTier;
  target: number | null;
  weight: number | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  /** where it came from, for the "why this target" explanation */
  origin?: string;
}

export interface ResolvedKpi {
  metricKey: string;
  tier: ResolveTier;
  target: number | null;
  /** weight after normalisation (sums to 100 across the set when any weight is set) */
  weight: number | null;
  rawWeight: number | null;
  origin?: string;
}

const day = (v?: string | null) => (v ? String(v).slice(0, 10) : null);

export function isEffective(c: ResolveCandidate, asOf: string): boolean {
  const from = day(c.effectiveFrom);
  const to = day(c.effectiveTo);
  const on = day(asOf)!;
  if (from && from > on) return false;
  if (to && to < on) return false;
  return true;
}

/** Picks the winning candidate per metric (highest tier, then latest effective_from). */
export function pickWinners(candidates: ResolveCandidate[], asOf: string): ResolvedKpi[] {
  const best = new Map<string, ResolveCandidate>();
  for (const c of candidates) {
    if (!isEffective(c, asOf)) continue;
    const cur = best.get(c.metricKey);
    if (!cur) { best.set(c.metricKey, c); continue; }
    const rank = TIER_ORDER.indexOf(c.tier) - TIER_ORDER.indexOf(cur.tier);
    if (rank < 0 || (rank === 0 && (day(c.effectiveFrom) ?? "") > (day(cur.effectiveFrom) ?? ""))) best.set(c.metricKey, c);
  }
  return normaliseWeights(
    [...best.values()].map((c) => ({
      metricKey: c.metricKey, tier: c.tier, target: c.target, weight: c.weight, rawWeight: c.weight, origin: c.origin,
    })),
  );
}

/**
 * Scales weights so they sum to 100. KPIs with no weight stay null (shown but not scored). When every weight is
 * null or zero nothing is scaled. Rounded to 2 dp with the remainder put on the largest weight so the sum is exactly 100.
 */
export function normaliseWeights(items: ResolvedKpi[]): ResolvedKpi[] {
  const weighted = items.filter((i) => i.rawWeight != null && Number(i.rawWeight) > 0);
  const total = weighted.reduce((s, i) => s + Number(i.rawWeight), 0);
  if (total <= 0) return items.map((i) => ({ ...i, weight: null }));
  const scaled = new Map<string, number>();
  for (const i of weighted) scaled.set(i.metricKey, Math.round((Number(i.rawWeight) / total) * 10000) / 100);
  const sum = [...scaled.values()].reduce((s, v) => s + v, 0);
  const drift = Math.round((100 - sum) * 100) / 100;
  if (drift !== 0) {
    const largest = [...scaled.entries()].sort((a, b) => b[1] - a[1])[0];
    scaled.set(largest[0], Math.round((largest[1] + drift) * 100) / 100);
  }
  return items.map((i) => ({ ...i, weight: scaled.get(i.metricKey) ?? null }));
}

export interface RatingBand { label: string; minScore: number }

/** Rating from the one scale (bands sorted high to low by minScore). Missing score -> null, never a band. */
export function ratingFor(score: number | null | undefined, bands: RatingBand[]): string | null {
  if (score == null || !Number.isFinite(score)) return null;
  const sorted = [...bands].sort((a, b) => b.minScore - a.minScore);
  for (const b of sorted) if (score >= b.minScore) return b.label;
  return sorted.length ? sorted[sorted.length - 1].label : null;
}

export const DEFAULT_RATING_BANDS: RatingBand[] = [
  { label: "S", minScore: 100 }, { label: "A", minScore: 90 }, { label: "B", minScore: 75 },
  { label: "C", minScore: 60 }, { label: "D", minScore: 0 },
];
