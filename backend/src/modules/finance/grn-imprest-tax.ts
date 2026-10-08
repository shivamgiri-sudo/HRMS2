import type { calculateBudgetLine } from "../process-pnl/branch-budget.service.js";

export type BudgetLineAmounts = ReturnType<typeof calculateBudgetLine>;

/**
 * Imprest GRNs carry NO GST.
 *
 * An imprest voucher is petty cash spent out of a branch float — a tea bill, an auto fare, a
 * courier. The rupee figure the raiser types is the whole cost to the business: there is no tax
 * invoice behind it and therefore no input tax credit to claim, so nothing about that amount is
 * recoverable and ALL of it hits the P&L.
 *
 * Without this, an imprest row inherited the tax profile of whichever BUDGET LINE funded it.
 * Budget lines are planned with a tax treatment (e.g. "Tea, Coffee & Refreshment" planned as
 * GST-inclusive 18% with 100% recoverable), so a ₹2,112 imprest voucher was being decomposed
 * into ₹1,789.85 base + ₹322.15 "GST", the GST treated as recoverable, and only ₹1,789.85 booked
 * to P&L — understating the branch's real cost by the tax it never paid and can never reclaim.
 * The budget line's tax treatment is a PLANNING classification; it must not manufacture a GST
 * component on a spend that has none.
 *
 * Applied to the amounts of every imprest allocation row and imprest GRN header, so gross, base
 * and P&L cost are all the same number and the tax columns are zero.
 */
export function applyImprestNoGst(amounts: BudgetLineAmounts): BudgetLineAmounts {
  return {
    ...amounts,
    baseAmount: amounts.grossAmount,
    taxAmount: 0,
    cgstAmount: 0,
    sgstAmount: 0,
    igstAmount: 0,
    recoverableTaxAmount: 0,
    pnlCostAmount: amounts.grossAmount,
    gstType: "none",
    recoverablePct: 0,
  };
}

/** The tax columns an imprest allocation/header row stores, so nothing downstream re-derives a
 *  GST split off the funding budget line's planning profile. */
export const IMPREST_TAX_PROFILE = {
  taxTreatment: "non_gst" as const,
  gstRate: 0,
  gstType: "none" as const,
  recoverableTaxPct: 0,
};
