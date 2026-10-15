import type { BranchHealthReport } from "../branch-health-report/metrics.js";

export type PillarKey = "attendance" | "people" | "finance" | "hiring" | "compliance" | "quality";

export interface PillarScore {
  key: PillarKey;
  weight: number;
  score: number | null;
}

export const DEFAULT_WEIGHTS: Record<PillarKey, number> = {
  attendance: 25,
  people: 20,
  finance: 20,
  hiring: 15,
  compliance: 10,
  quality: 10,
};

const PILLAR_ORDER: PillarKey[] = ["attendance", "people", "finance", "hiring", "compliance", "quality"];

// ─── pillar rules (all tunables live here) ───────────────────────────────────
export const PILLAR_RULES = {
  attendance: { shrinkagePctFactor: 4, lateCap: 20, lateFactor: 1.5 },
  people: { attritionPctFactor: 8, exitNotClosedFactor: 2, seatGapFactor: 50 },
  finance: { fullUpToPct: 80, floorAtPct: 95, floorScore: 60, overScore: 40, unbudgetedFactor: 3 },
  compliance: { backlogFactor: 5 },
  quality: { breachPctFactor: 2 },
} as const;

const clamp = (n: number): number => Math.max(0, Math.min(100, n));
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number): number => Math.round(n * 100) / 100;

type Raw = BranchHealthReport["raw"];

function attendance(raw: Raw): number | null {
  if (!raw.shrinkage || num(raw.shrinkage.scheduled) === 0) return null;
  const r = PILLAR_RULES.attendance;
  const late = Math.min(num(raw.lateStats?.totalLate), r.lateCap);
  return clamp(100 - num(raw.shrinkage.shrinkagePct) * r.shrinkagePctFactor - late * r.lateFactor);
}

function people(raw: Raw): number | null {
  const h = raw.headcount;
  const active = num(h?.totalActive);
  if (!h || active === 0) return null;
  const r = PILLAR_RULES.people;
  const seats = num(h.mandateSeatsTotal);
  const gap = seats > 0 ? Math.abs(1 - active / seats) * r.seatGapFactor : 0;
  return clamp(100 - (num(h.leftMtd) / active) * 100 * r.attritionPctFactor - num(h.exitsNotClosed) * r.exitNotClosedFactor - gap);
}

function finance(raw: Raw): number | null {
  if (!raw.budget || num(raw.budget.totalBudget) === 0) return null;
  const r = PILLAR_RULES.finance;
  const u = num(raw.budget.utilizationPct);
  let base: number;
  if (u <= r.fullUpToPct) base = 100;
  else if (u <= r.floorAtPct) base = 100 - ((u - r.fullUpToPct) / (r.floorAtPct - r.fullUpToPct)) * (100 - r.floorScore);
  else base = r.overScore;
  return clamp(base - num(raw.grnStats?.unbudgeted?.count) * r.unbudgetedFactor);
}

function hiring(raw: Raw): number | null {
  const o = raw.offers;
  if (!o || num(o.offered) === 0 || o.conversionPct === null || o.conversionPct === undefined) return null;
  return clamp(num(o.conversionPct));
}

function compliance(raw: Raw): number {
  const backlog =
    num(raw.regularization?.over3Days) + num(raw.leaveAging?.over3Days) + num(raw.grnStats?.pendingOver3Days);
  return clamp(100 - backlog * PILLAR_RULES.compliance.backlogFactor);
}

function quality(raw: Raw): number | null {
  const total = num(raw.ats?.slaTotal);
  if (total === 0) return null;
  const pct = (num(raw.ats.slaBreaches) / total) * 100;
  return clamp(100 - pct * PILLAR_RULES.quality.breachPctFactor);
}

export function computeScore(
  report: BranchHealthReport,
  weights: Record<PillarKey, number> = DEFAULT_WEIGHTS,
): { score: number; pillars: PillarScore[]; excluded: string[] } {
  const raw = report.raw;
  const scores: Record<PillarKey, number | null> = {
    attendance: attendance(raw),
    people: people(raw),
    finance: finance(raw),
    hiring: hiring(raw),
    compliance: compliance(raw),
    quality: quality(raw),
  };
  const pillars: PillarScore[] = PILLAR_ORDER.map((key) => ({
    key,
    weight: weights[key],
    score: scores[key] === null ? null : round2(scores[key] as number),
  }));
  const active = pillars.filter((p) => p.score !== null);
  const excluded = pillars.filter((p) => p.score === null).map((p) => p.key as string);
  const totalWeight = active.reduce((s, p) => s + p.weight, 0);
  if (active.length === 0 || totalWeight <= 0) return { score: 0, pillars, excluded };
  const score = active.reduce((s, p) => s + (p.score as number) * p.weight, 0) / totalWeight;
  return { score: round2(clamp(score)), pillars, excluded };
}
