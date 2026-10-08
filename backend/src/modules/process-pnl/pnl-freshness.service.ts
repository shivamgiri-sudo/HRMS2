import { getPnlReconciliation, type PnlReconciliationFilters, type PnlReconciliationMode, type PnlSourceFreshness } from "./pnl-reconciliation.service.js";

/**
 * Every P&L view needs one small, consistent signal — "is this number I'm looking at final,
 * live-and-provisional, or blocked" — but pnl-reconciliation.service.ts's getPnlReconciliation()
 * computes a whole cost-centre-grain reconciliation table to answer it (rows, branches, totals —
 * useful for the dedicated Live tab, wasteful for a header badge on the other 6 views).
 *
 * This is a pure PROJECTION of that same call, not a second implementation: it can never
 * disagree with what PnlReconciliationPanel.tsx already shows, because it is the same function.
 */
export interface PnlFreshnessSummary {
  mode: PnlReconciliationMode;
  generatedAt: string;
  blockers: string[];
  freshness: PnlSourceFreshness[];
  exceptions: Array<{ code: string; label: string; amount: number; count: number }>;
}

export async function getPnlFreshness(
  period: string,
  filters: PnlReconciliationFilters = {},
): Promise<PnlFreshnessSummary> {
  const full = await getPnlReconciliation(period, filters);
  return {
    mode: full.mode,
    generatedAt: full.generatedAt,
    blockers: full.blockers,
    freshness: full.freshness,
    exceptions: full.exceptions,
  };
}
