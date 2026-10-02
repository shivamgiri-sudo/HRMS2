import type { InsightKpi, InsightTable, RoleInsights } from "../../kit";

/** Pure helpers behind the Quality layout. */

export const kpiOf = (ins: RoleInsights | undefined, key: string): InsightKpi | undefined => ins?.kpis.find((k) => k.key === key);
export const tableOf = (ins: RoleInsights | undefined, key: string): InsightTable | undefined => ins?.tables.find((t) => t.key === key);

export interface CoverageSegments {
  total: number;
  audited: number;
  assessedUnscored: number;
  notAssessed: number;
  coveragePct: number;
}

/**
 * Splits analysed calls into audited / assessed-but-unscored / never assessed.
 * `pending` (= analysed - audited) contains the unscored rows, so never-assessed is the remainder, floored at 0
 * (the two sources are separate tables and can disagree by a few calls). null when any input is unknown.
 */
export function coverageSegments(audited: number | null | undefined, pending: number | null | undefined, unscored: number | null | undefined): CoverageSegments | null {
  if (audited == null || pending == null) return null;
  const total = audited + pending;
  if (total <= 0) return null;
  const assessedUnscored = Math.min(Math.max(unscored ?? 0, 0), pending);
  return { total, audited, assessedUnscored, notAssessed: Math.max(pending - assessedUnscored, 0), coveragePct: Math.round((audited / total) * 1000) / 10 };
}

/** Medal for league rank 1-3. */
export const medal = (rank: number): string => (rank === 1 ? "bg-amber-400 text-amber-950" : rank === 2 ? "bg-slate-300 text-slate-800" : rank === 3 ? "bg-orange-300 text-orange-950" : "bg-slate-100 text-slate-500");
