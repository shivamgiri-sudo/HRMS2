import type { BpoPnlRow } from "./bpo-pnl.service.js";
import { getCachedAllocationSummary } from "./canonical-pnl.service.js";
import { costComponentDataFlags, type CostComponentDataFlags } from "./pnl-cost-component-flags.js";
import { cachedPnlRead } from "./pnl-read-cache.js";

/**
 * "Full P&L Waterfall" — a supplementary, ADDITIONAL branch/company-wide total, built by summing
 * the same per-process fields ProcessPnlDetailPage.tsx's "Profitability waterfall" card already
 * shows (contribution, EBITDA, depreciation, amortization, EBIT, finance cost, PBT, tax, PAT —
 * see calculateBpoCostWaterfall in bpo-pnl.calculation.ts for where those names come from, and
 * adjustedRow in bpo-pnl-allocation-overlay.service.ts for how each process's row is corrected for
 * its true share of branch-pool costs).
 *
 * This is NOT the "Operating Profit" figure CEO Overview and the P&L Statement show, and its `ebit`
 * is not derived from their lines:
 *   - P&L Statement (pnl-statement.service.ts enrichColumn), EVERY view — process, branch and LOB
 *     alike since 2026-09-23: Operating Profit = Recognised Revenue − Total Cost, where Total Cost =
 *     DC Total (Agent + DSC + BMC salary, from actual payroll / the running-salary snapshot) + IDC
 *     (the shared GRN reader, readGrnSpend). Before that date the process view alone printed the
 *     canonical `ebit` summed here, which did not equal its own Revenue − Total Cost rows; the
 *     canonical figure is still published on a process column as `canonicalEbit`.
 *   - CEO Overview (ceo-overview.service.ts): revenue − peopleCost − indirectCost per branch.
 * Both are reconciled against the business's real reported P&L Excel file (see migration
 * 435_pnl_components_real_shape.sql), and this module never reads or writes anything either of
 * them touches. This module sums the canonical rows' own waterfall fields. A reader who wants to
 * verify this total by hand can add up the branch's own processes on their individual detail pages
 * (same source, same fields, same math) and land on exactly this number — that reconciliation is
 * this feature's whole point, and is exercised in bpo-pnl-full-waterfall.test.ts.
 *
 * GRN Committed (reserved) — owner rule 2026-09-24, "Reserved + Consumed should be there in P&L":
 * the overlay now folds approved-but-unconsumed GRN allocations (ex-GST, same period/bucket rule as
 * the consumed view) into each row's non-people buckets, so every EBITDA / EBIT / PBT / PAT summed
 * here already subtracts it, for every month. Nothing extra is added in this module — adding it
 * again here would count it twice. Each row also carries it apart as `grnCommitted`.
 *
 * Both the per-process row and this aggregate READ THROUGH bpoPnlAllocationOverlayService's own
 * correctly-split branch-pool allocation (fixed 2026-09-01, commit 8172b98a) via the same 60s
 * cache (getCachedAllocationSummary, canonical-pnl.service.ts) /pnl/bpo/summary already shares —
 * so a branch total computed here and the sum of that branch's process cards, read a few seconds
 * apart, can never silently diverge onto two different snapshots of the underlying data.
 */

const n = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const pct = (numerator: number, denominator: number): number | null =>
  denominator > 0 ? (numerator / denominator) * 100 : null;

const WATERFALL_FIELDS = [
  "recognizedRevenue",
  "contribution",
  "ebitda",
  "depreciation",
  "amortization",
  "ebit",
  "financeCost",
  "pbt",
  "tax",
  "pat",
] as const satisfies readonly (keyof BpoPnlRow)[];

export interface FullWaterfallTotals extends CostComponentDataFlags {
  period: string;
  /** Null for the company-wide total. */
  branchId: string | null;
  /** How many active processes contributed to this total — 0 reads as "no data", not "all zero". */
  processCount: number;
  recognizedRevenue: number;
  contribution: number;
  contributionMarginPct: number | null;
  ebitda: number;
  ebitdaMarginPct: number | null;
  depreciation: number;
  amortization: number;
  ebit: number;
  operatingProfitPct: number | null;
  financeCost: number;
  pbt: number;
  tax: number;
  pat: number;
}

function sumRows(rows: BpoPnlRow[]) {
  const totals = Object.fromEntries(
    WATERFALL_FIELDS.map((field) => [field, 0])
  ) as Record<(typeof WATERFALL_FIELDS)[number], number>;
  for (const row of rows) {
    for (const field of WATERFALL_FIELDS) {
      totals[field] += n(row[field]);
    }
  }
  return totals;
}

/**
 * One branch's full waterfall, or the whole company's when `branchId` is omitted.
 *
 * `rows` comes from the exact same cached call /pnl/bpo/summary (Process Matrix) and
 * ProcessPnlDetailPage's per-process card ultimately read from — see getCachedAllocationSummary's
 * own doc comment in canonical-pnl.service.ts. When `branchId` is given, the underlying query
 * already scopes the SQL to that branch (bpoPnlService.getSummary's branchFilters), so `rows` here
 * contains only that branch's active processes — no extra filtering is applied on top.
 */
export function getFullWaterfall(period: string, branchId?: string | null): Promise<FullWaterfallTotals> {
  // 60s result cache + single-flight (pnl-read-cache.ts), keyed by period and the caller's
  // RESOLVED branch scope (the route passes resolveFinanceBranchScope's answer), so a branch-bound
  // user can never be served another branch's or the company's totals.
  return cachedPnlRead("pnl-full-waterfall", { period, branchId: branchId ?? null }, () => buildFullWaterfall(period, branchId));
}

async function buildFullWaterfall(period: string, branchId?: string | null): Promise<FullWaterfallTotals> {
  const filters = branchId ? { period, branchId } : { period };
  // Independent reads, run together.
  const [summary, flags] = await Promise.all([
    getCachedAllocationSummary(filters),
    costComponentDataFlags(period, branchId ? { branchId } : {}),
  ]);
  const rows = summary.rows as BpoPnlRow[];
  const totals = sumRows(rows);

  return {
    period,
    branchId: branchId ?? null,
    processCount: rows.length,
    recognizedRevenue: totals.recognizedRevenue,
    contribution: totals.contribution,
    contributionMarginPct: pct(totals.contribution, totals.recognizedRevenue),
    ebitda: totals.ebitda,
    ebitdaMarginPct: pct(totals.ebitda, totals.recognizedRevenue),
    depreciation: totals.depreciation,
    amortization: totals.amortization,
    ebit: totals.ebit,
    operatingProfitPct: pct(totals.ebit, totals.recognizedRevenue),
    financeCost: totals.financeCost,
    pbt: totals.pbt,
    tax: totals.tax,
    pat: totals.pat,
    ...flags,
  };
}

export const bpoPnlFullWaterfallService = { getFullWaterfall };
