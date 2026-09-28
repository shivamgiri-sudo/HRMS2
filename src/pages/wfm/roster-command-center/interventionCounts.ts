export type RiskTier = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export type TierCounts = Record<RiskTier, number>;

/** Count open interventions per risk tier from the pending rows (one increment per row). */
export function countByTier(rows: ReadonlyArray<{ riskTier?: string | null }>): TierCounts {
  const counts: TierCounts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const row of rows) {
    const tier = String(row.riskTier ?? "").toUpperCase();
    if (tier in counts) counts[tier as RiskTier] += 1;
  }
  return counts;
}
