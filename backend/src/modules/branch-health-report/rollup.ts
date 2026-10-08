/**
 * Branch Health Report — where one branch stands against the others.
 *
 * Deliberately anonymous: a branch sees its own rank and how many branches share each problem,
 * never another branch's name or figures (branch-scoping policy).
 */
import type { BranchHealthReport } from "./metrics.js";

export interface PeerSummary {
  rank: number;
  total: number;
  escalations: number;
  median: number;
  branchesWithNone: number;
  /** escalation key -> number of OTHER branches where the same key is red today. */
  sameKeyElsewhere: Record<string, number>;
}

const longest = (r: BranchHealthReport): number => Math.max(0, ...r.escalations.map((e) => e.days ?? 1));

export function summarisePeers(reports: BranchHealthReport[]): Map<string, PeerSummary> {
  // Branches with no data (unknown branch id) are not ranked: they would count as spotless.
  const ranked = reports.filter((r) => r.raw.branchId);
  const order = [...ranked].sort(
    (a, b) => b.escalations.length - a.escalations.length || longest(b) - longest(a),
  );
  const counts = ranked.map((r) => r.escalations.length).sort((a, b) => a - b);
  const mid = counts.length >> 1;
  const median = counts.length ? (counts.length % 2 ? counts[mid] : (counts[mid - 1] + counts[mid]) / 2) : 0;
  const redIn = new Map<string, number>();
  for (const r of ranked) for (const e of r.escalations) redIn.set(e.key, (redIn.get(e.key) ?? 0) + 1);

  const out = new Map<string, PeerSummary>();
  for (const r of ranked) {
    const rank = order.findIndex((o) => o.escalations.length === r.escalations.length && longest(o) === longest(r)) + 1;
    out.set(r.branch, {
      rank,
      total: ranked.length,
      escalations: r.escalations.length,
      median,
      branchesWithNone: ranked.filter((o) => o.escalations.length === 0).length,
      sameKeyElsewhere: Object.fromEntries(r.escalations.map((e) => [e.key, (redIn.get(e.key) ?? 1) - 1])),
    });
  }
  return out;
}
