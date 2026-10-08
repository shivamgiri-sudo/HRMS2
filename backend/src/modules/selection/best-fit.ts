// Best-fit requisition for one person (WS3 B1 / D1 as amended by plan 2026-10-09): every candidate requisition is judged by the one
// engine (evaluate + HR overrides through finalVerdict); pass beats review beats fail, then the engine score, then seats left, then the
// caller's order (primary first). Nothing passing or in review = no pick (the caller holds the person for HR). Pure.
import { finalVerdict } from "./funnel.js";
import type { Evaluation, Verdict } from "./selection-types.js";

export interface FitCandidate { requisitionId: string; e: Evaluation; seatsLeft: number }
export interface FitAlternative { requisitionId: string; verdict: Verdict; score: number; reasons: string[] }
export interface BestFit { requisitionId: string | null; verdict: Verdict | null; score: number; alternatives: FitAlternative[] }

const RANK: Record<Verdict, number> = { pass: 0, review: 1, fail: 2 };

function reasonsOf(e: Evaluation): string[] {
  const failed = e.failed.filter((r) => r.effect === "fail").map((r) => `${r.label}: ${r.actualText} (needs ${r.requiredText})`);
  return [...failed, ...e.reviewReasons].slice(0, 5);
}

export function pickBestRequisition(cands: FitCandidate[]): BestFit {
  if (!cands.length) return { requisitionId: null, verdict: null, score: 0, alternatives: [] };
  const ranked = cands.map((c, i) => ({ c, i, v: finalVerdict(c.e) }))
    .sort((a, b) => RANK[a.v] - RANK[b.v] || b.c.e.score - a.c.e.score || b.c.seatsLeft - a.c.seatsLeft || a.i - b.i);
  const alt = (x: (typeof ranked)[number]): FitAlternative => ({ requisitionId: x.c.requisitionId, verdict: x.v, score: x.c.e.score, reasons: reasonsOf(x.c.e) });
  const best = ranked[0];
  if (best.v === "fail") return { requisitionId: null, verdict: "fail", score: best.c.e.score, alternatives: ranked.map(alt) };
  return { requisitionId: best.c.requisitionId, verdict: best.v, score: best.c.e.score, alternatives: ranked.slice(1).map(alt) };
}
