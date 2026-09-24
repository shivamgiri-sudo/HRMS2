/**
 * Ex-GST (non-GST) amount expressions for every P&L reader of GRN, vendor-payable and budget rows.
 *
 * OWNER RULE, 2026-09-24: on the Process P&L, "Revenue and GRN — all components — must be NON-GST
 * amounts". This overrides the 2026-08-29 decision that P&L GRN cost should read pnl_cost_amount
 * (base + NON-recoverable GST). Every P&L figure built from a GRN, a vendor payable or a budget
 * line now reads the taxable value (the ex-GST column), so GRN spend and budget stay on one basis.
 *
 * Scope: READERS that feed P&L reporting only. The GRN submission gate and budget consumption
 * (budget-headroom-gate, budget-consumption, budget-coverage, the branch-budget ceiling queries)
 * still work on pnl_cost_amount and decide whether a real GRN is allowed — they are deliberately
 * untouched here (owner decision pending).
 *
 * Why each expression has a fallback: the ex-GST columns were added by ALTER TABLE ... NOT NULL
 * DEFAULT 0 (sql/411, 416, 425), so an old row that predates them holds 0, not NULL. A bare read of
 * the column would turn such a row into a silent zero. The fallback derives the taxable value from
 * gross minus the row's own recorded tax (tax is 0 on those legacy rows, i.e. the row is treated as
 * tax-neutral — the same rule sql/411's backfill applied), so no historic cost disappears.
 */

/** Ex-GST value of a column set that carries amount_without_tax + tax_amount, given its gross. */
function exGstFromParts(alias: string, grossExpr: string): string {
  return `COALESCE(NULLIF(${alias}.amount_without_tax, 0), ${grossExpr} - COALESCE(${alias}.tax_amount, 0), 0)`;
}

/** grn_request: taxable value; gross falls back to the legacy `amount` column. */
export function grnRequestExGstSql(alias = "g"): string {
  return exGstFromParts(alias, `COALESCE(NULLIF(${alias}.amount_with_tax, 0), ${alias}.amount, 0)`);
}

/** grn_cost_allocation: taxable value of one Smart GRN allocation row. */
export function grnAllocationExGstSql(alias = "a"): string {
  return exGstFromParts(alias, `COALESCE(${alias}.amount_with_tax, 0)`);
}

/**
 * vendor_payment_tracking: taxable value of the payable. due_amount is the GST-inclusive invoice
 * gross (vendor-payment.service.ts writes amount_with_tax into it), so the fallback is due - tax.
 */
export function vendorPayableExGstSql(alias = "vpt"): string {
  return exGstFromParts(alias, `COALESCE(NULLIF(${alias}.amount_with_tax, 0), ${alias}.due_amount, 0)`);
}

/**
 * finance_budget_line / finance_budget_line_allocation: base_amount is the ex-GST budget. A row
 * with no base (legacy) falls back to gross - tax, then to pnl_cost_amount, so a budget never
 * reads as zero merely because its split was never recorded.
 */
export function budgetExGstSql(alias: string): string {
  return `COALESCE(NULLIF(${alias}.base_amount, 0), NULLIF(COALESCE(${alias}.gross_amount, 0) - COALESCE(${alias}.tax_amount, 0), 0), ${alias}.pnl_cost_amount, 0)`;
}
