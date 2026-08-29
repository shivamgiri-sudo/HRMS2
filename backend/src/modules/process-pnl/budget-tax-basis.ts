/**
 * Which figure of an invoice a budget line is actually charged: the tax-inclusive one, or the
 * taxable value alone.
 *
 * A GRN books the GST-inclusive amount. That is the right thing to charge a tax-bearing budget
 * line, whose own `gross_amount` was planned inclusive of the same tax. It is the wrong thing to
 * charge a line planned as `non_gst` or `exempt`, whose `gross_amount` is net of tax: a
 * ₹1,00,000 purchase carrying ₹18,000 of GST would consume ₹1,18,000 against a ₹1,02,000 line.
 *
 * Two independent gates have to agree on this and, until now, did not:
 *
 *   reserve()             charged the taxable value, correctly, via consumptionBasis().
 *   the headroom gate     charged the inclusive figure, and so refused invoices at SAVE time
 *                         that Branch Head approval would have accepted moments later. Reported
 *                         live: a ₹21,000 budget refusing a ₹21,000 invoice whose taxable value
 *                         was well under ₹21,000, because the GST was being weighed against a
 *                         plan that never contained any.
 *
 * The rule lives here — a leaf module with no dependencies — rather than in either gate, so there
 * is one definition and neither service has to import the other to reach it.
 */

/** Budget lines whose planned amount carries no tax, so tax must not be consumed against them. */
export const NON_TAXABLE_TREATMENTS = new Set(["non_gst", "exempt"]);

/**
 * How much BUDGET one rupee of invoice gross costs on a line with this tax treatment.
 *
 * 1 for a tax-bearing line — the invoice and the plan both include tax, so they compare directly.
 * net/gross for a non-taxable line, because only the taxable value is ever charged to it.
 *
 * Returns 1 whenever the taxable value is unknown or unusable, so a caller that cannot supply it
 * keeps the conservative inclusive behaviour rather than silently under-charging a budget.
 */
export function budgetCostRatio(
  taxTreatment: unknown,
  grossAmount: number,
  netAmount?: number
): number {
  if (!NON_TAXABLE_TREATMENTS.has(String(taxTreatment ?? ""))) return 1;
  if (!Number.isFinite(netAmount) || !((netAmount as number) > 0)) return 1;
  if (!Number.isFinite(grossAmount) || !(grossAmount > 0)) return 1;
  // Never above 1: a taxable value larger than the gross is nonsense, and letting it through
  // would charge a line MORE than the invoice is worth.
  return Math.min(1, (netAmount as number) / grossAmount);
}
