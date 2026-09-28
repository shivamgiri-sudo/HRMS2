import type { JournalLineInput } from "./journal.service.js";

/**
 * The double-entry shape of each Payment Voucher release lane, factored out of
 * payment-voucher.service.ts's release() as pure functions (no DB access) so release() stays
 * the one place that does I/O and these stay trivially testable on their own.
 *
 * ALL lines from every lane a single release() call touches accumulate into ONE array and post
 * through exactly one journalService.post() call, with sourceType='payment_voucher' and
 * sourceId=<the voucher's id> — never one post() per allocation/lane. journal_entry has a
 * UNIQUE KEY on (source_type, source_id, reversed_by_entry_id): a second post() for the same
 * voucher would collide on it, and more fundamentally one payment_voucher IS one Tally voucher
 * (tally-export.service.ts already collapses multiple bank_account_ledger_entry rows for the
 * same voucher_id back into one <VOUCHER> for exactly this reason).
 *
 * TDS is posted as a REAL third leg here (Cr TDS Payable, a genuine payable_account credit)
 * instead of today's bank_account_ledger_entry "zero-cash memo row" workaround — see
 * bank-account-ledger-entry's own header comment for why that workaround existed in the first
 * place (no general ledger existed). It still exists; it's just no longer the only place the
 * liability is recorded.
 */

/** vendor_grn lane, ONE allocation (one GRN paid by this voucher). Call once per allocation;
 *  push every returned line into the same accumulating array. */
export function vendorGrnLines(input: {
  vendorId: string;
  bankAccountId: string;
  netAmount: number;
  tdsAmount: number;
  tdsPayableAccountId: string | null;
}): JournalLineInput[] {
  const lines: JournalLineInput[] = [];
  const grossCleared = Math.round((input.netAmount + input.tdsAmount) * 100) / 100;
  // Vendor's payable cleared in FULL (net paid + tax withheld) — the vendor is owed nothing
  // further for this GRN either way, whether the money left as cash or as tax withholding.
  lines.push({ accountType: "vendor", accountId: input.vendorId, debitAmount: grossCleared });
  lines.push({ accountType: "bank_account", accountId: input.bankAccountId, creditAmount: input.netAmount });
  if (input.tdsAmount > 0) {
    if (!input.tdsPayableAccountId) {
      throw new Error("TDS was withheld but no 'TDS Payable' ledger head is configured in payable_account_master.");
    }
    lines.push({ accountType: "payable_account", accountId: input.tdsPayableAccountId, creditAmount: input.tdsAmount, narration: "TDS withheld" });
  }
  return lines;
}

/** imprest_allocation lane — replenishing a manager's float: Dr Imprest Float / Cr Bank. */
export function imprestAllocationLines(input: {
  imprestFloatAccountId: string;
  bankAccountId: string;
  amount: number;
}): JournalLineInput[] {
  return [
    { accountType: "payable_account", accountId: input.imprestFloatAccountId, debitAmount: input.amount },
    { accountType: "bank_account", accountId: input.bankAccountId, creditAmount: input.amount },
  ];
}

/** vendor_advance lane — real cash out, no GRN behind it yet: Dr Vendor / Cr Bank. A debit on
 *  the vendor's own Sundry-Creditors sub-ledger simply nets against whatever that vendor's
 *  ledger otherwise owes — same ledger a GRN's Cr Vendor lands in, so the two net naturally
 *  without any special "advance account" of their own. */
export function vendorAdvanceLines(input: {
  vendorId: string;
  bankAccountId: string;
  amount: number;
}): JournalLineInput[] {
  return [
    { accountType: "vendor", accountId: input.vendorId, debitAmount: input.amount },
    { accountType: "bank_account", accountId: input.bankAccountId, creditAmount: input.amount },
  ];
}

/** vendor_advance_application lane — settles a GRN due against a PRIOR advance, no new cash.
 *  The GRN's original Cr Vendor and the advance's original Dr Vendor already net against each
 *  other on that vendor's own ledger — nothing further to post for the principal. The ONLY
 *  thing this lane can still add is TDS, if this installment withholds it: Dr Vendor (reduces
 *  what nets off — TDS is not paid to the vendor, so their ledger clears by less than the GRN
 *  amount) / Cr TDS Payable. Returns an empty array when tdsAmount is 0 — correct, not a gap:
 *  no cash and no net ledger movement means nothing to journal. */
export function vendorAdvanceApplicationLines(input: {
  vendorId: string;
  tdsAmount: number;
  tdsPayableAccountId: string | null;
}): JournalLineInput[] {
  if (input.tdsAmount <= 0) return [];
  if (!input.tdsPayableAccountId) {
    throw new Error("TDS was withheld but no 'TDS Payable' ledger head is configured in payable_account_master.");
  }
  return [
    { accountType: "vendor", accountId: input.vendorId, debitAmount: input.tdsAmount, narration: "TDS withheld on advance application" },
    { accountType: "payable_account", accountId: input.tdsPayableAccountId, creditAmount: input.tdsAmount, narration: "TDS withheld" },
  ];
}

/** 'general' lane (salary payable / statutory dues / bank charges / other) — whatever
 *  payable_account_master row the voucher was raised under: Dr that account / Cr Bank. */
export function generalLines(input: {
  payableAccountId: string;
  bankAccountId: string;
  amount: number;
}): JournalLineInput[] {
  return [
    { accountType: "payable_account", accountId: input.payableAccountId, debitAmount: input.amount },
    { accountType: "bank_account", accountId: input.bankAccountId, creditAmount: input.amount },
  ];
}
