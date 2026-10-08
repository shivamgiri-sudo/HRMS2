/**
 * THE month a GRN / vendor bill counts in on every P&L surface: its ACCOUNTING month (owner rule 2026-10-06:
 * "GRN we should see the accounting month, not the raised month").
 *
 * grn_request.accounting_period is that month and is set on every GRN (for db_bill-migrated GRNs it equals the
 * db_bill FinanceMonth). Several readers used the due date (vendor_payment_tracking) or the bill date
 * (grn_cost_allocation / the allocation view) instead, so HRMS-raised bills landed in the month they fell due or
 * were billed: live Oct 2026, 48 vendor rows (17.5L) and 214 allocations (21L) sat in a month other than their
 * accounting month. Dates are now only the last fallback, for a row with no GRN and no recognition month.
 *
 * The one exception is a multi-month GRN, whose allocation rows carry their own recognition_period per month
 * (the period-allocation split); there the allocation's month wins.
 */

const dateFallback = (g: string) =>
  `DATE_FORMAT(COALESCE(${g}.service_period_end, ${g}.bill_date, ${g}.reviewed_at, ${g}.created_at), '%Y-%m')`;

/** Accounting month (YYYY-MM) of a grn_request row. */
export function grnAccountingMonthSql(g = "g"): string {
  return `COALESCE(${g}.accounting_period, ${g}.recognition_period, ${dateFallback(g)})`;
}

/** Accounting month of a grn_cost_allocation row `a` joined to its grn_request `g`. */
export function allocationAccountingMonthSql(a = "a", g = "g"): string {
  return `(CASE WHEN COALESCE(${g}.is_multi_month, 0) = 1
            THEN COALESCE(${a}.recognition_period, ${g}.accounting_period, ${dateFallback(g)})
            ELSE COALESCE(${g}.accounting_period, ${a}.recognition_period, ${dateFallback(g)}) END)`;
}

/**
 * Accounting month of a vendor_payment_tracking row: its GRN's accounting month, then its own recognition month,
 * then (no GRN at all) the due / payment / created date. Self-contained (correlated lookup), so a caller needs no join.
 */
export function vendorAccountingMonthSql(vpt = "vpt"): string {
  return `COALESCE((SELECT gq.accounting_period FROM grn_request gq WHERE gq.id = ${vpt}.grn_request_id),
                   ${vpt}.recognition_period,
                   DATE_FORMAT(COALESCE(${vpt}.due_date, ${vpt}.payment_date, ${vpt}.created_at), '%Y-%m'))`;
}

/** Same month as a first-of-month DATE, for readers that filter with BETWEEN start AND end. */
export function vendorAccountingDateSql(vpt = "vpt"): string {
  return `STR_TO_DATE(CONCAT(${vendorAccountingMonthSql(vpt)}, '-01'), '%Y-%m-%d')`;
}
