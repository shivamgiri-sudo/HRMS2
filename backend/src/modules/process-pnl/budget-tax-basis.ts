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
