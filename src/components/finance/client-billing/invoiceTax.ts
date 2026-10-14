// src/components/finance/client-billing/invoiceTax.ts
/**
 * Tax rows for an invoice as stored: one row per tax head that actually carries an amount, with
 * the rate derived from the record (tax / taxable total, 2 dp) instead of a hard-coded 18 / 9 —
 * so a no-tax, RCM or non-standard-rate invoice reads exactly as it was billed.
 */
interface TaxSource {
  total_amount: string | number;
  igst_amount: string | number;
  cgst_amount: string | number;
  sgst_amount: string | number;
  grand_total: string | number;
}

export function taxRate(tax: number, taxable: number): string {
  if (!taxable) return "0";
  return (Math.round((tax / taxable) * 10000) / 100).toFixed(2);
}

export function invoiceTaxRows(inv: TaxSource | undefined): Array<{ label: string; amount: number; total?: boolean }> {
  const taxable = Number(inv?.total_amount ?? 0);
  const rows: Array<{ label: string; amount: number; total?: boolean }> = [{ label: "Total:", amount: taxable }];
  for (const [name, key] of [["IGST", "igst_amount"], ["CGST", "cgst_amount"], ["SGST", "sgst_amount"]] as const) {
    const amount = Number(inv?.[key] ?? 0);
    if (amount > 0) rows.push({ label: `${name} @ ${taxRate(amount, taxable)}%`, amount });
  }
  rows.push({ label: "Grand Total:", amount: Number(inv?.grand_total ?? 0), total: true });
  return rows;
}
