import type { BpoPnlRow } from "./bpo-pnl.service.js";
import { getCachedAllocationSummary } from "./canonical-pnl.service.js";
import { costComponentDataFlags, type CostComponentDataFlags } from "./pnl-cost-component-flags.js";

/**
 * "Full P&L Waterfall" — a supplementary, ADDITIONAL branch/company-wide total, built by summing
 * the same per-process fields ProcessPnlDetailPage.tsx's "Profitability waterfall" card already
 * shows (contribution, EBITDA, depreciation, amortization, EBIT, finance cost, PBT, tax, PAT —
 * see calculateBpoCostWaterfall in bpo-pnl.calculation.ts for where those names come from, and
 * adjustedRow in bpo-pnl-allocation-overlay.service.ts for how each process's row is corrected for
 * its true share of branch-pool costs).
 *
 * This is NOT the "Operating Profit" figure CEO Overview and the P&L Statement show. That figure
 * is a separate, simpler calculation (revenue − lump peopleCost − indirectCost) in
 * ceo-overview.service.ts / pnl-statement.service.ts, deliberately reconciled against the
 * business's real reported P&L Excel file (see migration 435_pnl_components_real_shape.sql) — and
 * this module never reads or writes anything either of those two touch. A reader who wants to
 * verify this total by hand can add up the branch's own processes on their individual detail pages
 * (same source, same fields, same math) and land on exactly this number — that reconciliation is
 * this feature's whole point, and is exercised in bpo-pnl-full-waterfall.test.ts.
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
export async function getFullWaterfall(period: string, branchId?: string | null): Promise<FullWaterfallTotals> {
  const filters = branchId ? { period, branchId } : { period };
  const summary = await getCachedAllocationSummary(filters);
  const rows = summary.rows as BpoPnlRow[];
  const totals = sumRows(rows);
  const flags = await costComponentDataFlags(period, branchId ? { branchId } : {});

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
