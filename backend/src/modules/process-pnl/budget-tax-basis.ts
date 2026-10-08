/**
 * Which figure of an invoice a budget line is actually charged: the taxable value (base), or the
 * GST-inclusive gross.
 *
 * Budgets represent P&L cost — what the company actually spends. For vendor tax invoices, GST is
 * input tax credit (ITC) and never hits P&L, so only the taxable base should consume the budget
 * regardless of the budget line's own planned tax treatment.
 *
 * Examples:
 *   ₹10,000 budget + ₹10,000 base / ₹11,800 gross invoice at 18% → base (₹10,000) consumed, OK
 *   ₹10,000 budget + ₹10,000 gross / ₹10,000 gross invoice at 0% → full gross consumed (same)
 *
 * Two independent gates must agree on this (reserve() and the headroom gate); the rule lives here
 * so there is one definition only.
 *
 * Returns 1 whenever the taxable value is unknown or unusable, so a caller that cannot supply it
 * keeps the conservative inclusive behaviour rather than silently under-charging a budget.
 */

import { budgetExGstSql } from "./pnl-ex-gst.js";

/*
 * THE BUDGET CEILING A GRN IS CHECKED AGAINST — EX-GST (owner decision 2026-09-24: "GRN approval
 * limit: move to the excluding-GST amount").
 *
 * Before: the ceiling was pnl_cost_amount (base + NON-recoverable GST) while every charge written
 * to reserved_amount / consumed_amount has, since 1c3c1d83 (2026-08-31), been the invoice's
 * taxable value (budgetCostRatio below). On a line with non-recoverable GST that compared a
 * GST-inclusive ceiling against ex-GST spend: a base-100 / GST-18 line allowed 118 of ex-GST
 * spend before refusing. Reporting (pnl-ex-gst.ts, the Variance/Utilization tabs) already shows
 * the line as a 100 budget, so the approval gate is now on that same basis.
 *
 * The ceiling is the line's base_amount, with the same zero-default guard as pnl-ex-gst.ts
 * (0 = not populated → gross − tax → pnl_cost_amount), so a legacy line never reads as zero.
 * Stored columns are untouched; only which one the gate reads changed.
 */

/** SQL: a budget line's ex-GST ceiling. */
export function budgetLineCeilingSql(alias = "l"): string {
  return budgetExGstSql(alias);
}

/**
 * SQL: a budget line's remaining headroom on the ex-GST basis — ceiling minus what is reserved
 * and consumed. Callers keep aliasing it `available_gross_amount` (a legacy name every consumer and
 * the frontend reads); the value is ex-GST.
 */
export function budgetLineAvailableSql(alias = "l"): string {
  return `(${budgetLineCeilingSql(alias)} - COALESCE(${alias}.reserved_amount, 0) - COALESCE(${alias}.consumed_amount, 0))`;
}

function finiteOrZero(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** JS mirror of budgetLineCeilingSql() for a row already in hand (e.g. a line locked FOR UPDATE). */
export function budgetLineCeiling(line: Readonly<Record<string, unknown>>): number {
  const base = finiteOrZero(line.base_amount);
  if (base !== 0) return base;
  const derived = finiteOrZero(line.gross_amount) - finiteOrZero(line.tax_amount);
  if (derived !== 0) return derived;
  return finiteOrZero(line.pnl_cost_amount);
}

/** Budget lines whose planned amount carries no tax, so tax must not be consumed against them. */
export const NON_TAXABLE_TREATMENTS = new Set(["non_gst", "exempt"]);

/**
 * How much BUDGET one rupee of invoice gross costs.
 *
 * net/gross when the taxable value is known and less than the gross — budget tracks P&L (base),
 * not cash-out (gross). ITC-recoverable GST is never charged against the budget.
 * 1 otherwise — falls back to the inclusive figure when net is unavailable or equal to gross.
 */
export function budgetCostRatio(
  _taxTreatment: unknown,
  grossAmount: number,
  netAmount?: number
): number {
  if (!Number.isFinite(netAmount) || !((netAmount as number) > 0)) return 1;
  if (!Number.isFinite(grossAmount) || !(grossAmount > 0)) return 1;
  // Never above 1: a taxable value larger than the gross is nonsense, and letting it through
  // would charge a line MORE than the invoice is worth.
  return Math.min(1, (netAmount as number) / grossAmount);
}
