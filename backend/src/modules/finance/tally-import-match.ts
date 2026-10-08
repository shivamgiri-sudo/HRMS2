import type { TallyVoucher } from "./tally-import-parse.js";

/**
 * Matches Tally vouchers to HRMS bills (GRNs). Pure: the service loads the bills and calls this.
 *
 * A PAYMENT voucher is matched to the vendor by the party ledger name (Tally's ledger name is the vendor
 * name; vendors have no separate Tally name stored), then to that vendor's open bills:
 *   1. by the bill names Tally recorded against the payment (BILLALLOCATIONS = the invoice number);
 *   2. else by an invoice or GRN number written in the narration;
 *   3. else by amount, only when exactly one open bill has that balance.
 * Anything that is not clearly one answer is reported, never guessed.
 */

export type OpenBill = {
  trackingId: string; grnId: string; grnNumber: string; invoiceNumber: string | null;
  vendorKey: string; due: number; paid: number; balance: number; status: string;
};

export type ImportStatus =
  | "ready"            // will be recorded
  | "already_imported" // this Tally voucher was taken in an earlier import
  | "already_paid"     // HRMS already shows this bill as paid for the same amount
  | "no_vendor"        // party is not a vendor (bank, salary, statutory...) - not a bill payment
  | "no_open_bill"     // vendor known, but no open bill fits
  | "ambiguous"        // more than one open bill fits - a person must choose
  | "amount_mismatch"; // bills found but they do not add up to the voucher amount

export type Allocation = { trackingId: string; grnNumber: string; invoiceNumber: string | null; amount: number; by: "bill_ref" | "narration" | "amount" };

export type PaymentRow = {
  key: string; date: string | null; number: string; party: string; narration: string;
  amount: number; tds: number; status: ImportStatus; allocations: Allocation[]; candidates: string[]; candidateIds: string[]; note: string;
};

export const normName = (v: unknown) => String(v ?? "").trim().toUpperCase().replace(/\s+/g, " ");
const alnum = (v: unknown) => String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const r2 = (n: number) => Math.round(n * 100) / 100;
const TOL = 1;

const isPayment = (t: string) => /payment/i.test(t) && !/receipt/i.test(t);
const isPurchase = (t: string) => /purchase/i.test(t);

export function matchPayments(
  vouchers: TallyVoucher[],
  openBillsByVendor: Map<string, OpenBill[]>,
  allBillsByVendor: Map<string, OpenBill[]>,
  alreadyImported: Set<string>,
): PaymentRow[] {
  const rows: PaymentRow[] = [];
  for (const v of vouchers) {
    if (!isPayment(v.type)) continue;
    const party = v.ledgers.find((l) => normName(l.name) === normName(v.party) && l.debit > 0) ?? v.ledgers.filter((l) => l.debit > 0).sort((a, b) => b.debit - a.debit)[0];
    if (!party) continue;
    const vendorKey = normName(party.name);
    const tds = r2(v.ledgers.filter((l) => /tds/i.test(l.name)).reduce((s, l) => s + l.credit, 0));
    const amount = r2(party.debit);
    const base = { key: v.key, date: v.date, number: v.number, party: party.name, narration: v.narration, amount, tds, candidates: [] as string[], candidateIds: [] as string[], allocations: [] as Allocation[] };

    if (alreadyImported.has(v.key)) { rows.push({ ...base, status: "already_imported", note: "Taken in an earlier import." }); continue; }
    const open = openBillsByVendor.get(vendorKey);
    const all = allBillsByVendor.get(vendorKey);
    if (!all) { rows.push({ ...base, status: "no_vendor", note: "The party is not a vendor with bills in HRMS." }); continue; }

    const alloc = (b: OpenBill, a: number, by: Allocation["by"]): Allocation => ({ trackingId: b.trackingId, grnNumber: b.grnNumber, invoiceNumber: b.invoiceNumber, amount: r2(a), by });
    let picked: Allocation[] = [];
    const bills = open ?? [];

    // 1. bill names Tally recorded against the payment
    if (v.billRefs.length) {
      for (const ref of v.billRefs) {
        const hit = bills.find((b) => alnum(ref.name) && (alnum(b.invoiceNumber) === alnum(ref.name) || alnum(b.grnNumber) === alnum(ref.name)));
        if (hit && !picked.some((p) => p.trackingId === hit.trackingId)) picked.push(alloc(hit, ref.amount || Math.min(hit.balance, amount), "bill_ref"));
      }
    }
    // 2. an invoice / GRN number in the narration
    if (!picked.length && v.narration) {
      const text = alnum(v.narration);
      const hits = bills.filter((b) => (alnum(b.invoiceNumber).length >= 4 && text.includes(alnum(b.invoiceNumber))) || (alnum(b.grnNumber).length >= 4 && text.includes(alnum(b.grnNumber))));
      if (hits.length) picked = hits.map((b) => alloc(b, hits.length === 1 ? amount : b.balance, "narration"));
    }
    // 3. exactly one open bill with this balance
    if (!picked.length) {
      const fits = bills.filter((b) => Math.abs(b.balance - amount) <= TOL || Math.abs(b.balance - (amount + tds)) <= TOL);
      if (fits.length === 1) picked = [alloc(fits[0], amount, "amount")];
      else if (fits.length > 1) { rows.push({ ...base, status: "ambiguous", candidates: fits.map((f) => `${f.grnNumber}${f.invoiceNumber ? ` / ${f.invoiceNumber}` : ""}`), candidateIds: fits.map((f) => f.trackingId), note: `${fits.length} open bills have this balance; choose one.` }); continue; }
    }

    if (!picked.length) {
      const settled = (all ?? []).find((b) => b.paid > 0 && Math.abs(b.due - amount) <= TOL);
      rows.push({ ...base, status: settled ? "already_paid" : "no_open_bill", note: settled ? `HRMS already shows ${settled.grnNumber} as paid.` : "No open bill of this vendor fits." });
      continue;
    }
    const total = r2(picked.reduce((s, p) => s + p.amount, 0));
    const over = picked.find((p) => p.amount > (bills.find((b) => b.trackingId === p.trackingId)?.balance ?? 0) + TOL);
    if (over || Math.abs(total - amount) > TOL) {
      rows.push({ ...base, allocations: picked, status: "amount_mismatch", note: over ? `${over.grnNumber}: payment is more than the open balance.` : `Bills add to ${total}, the voucher is ${amount}.` });
      continue;
    }
    rows.push({ ...base, allocations: picked, status: "ready", note: "" });
  }
  return rows;
}

export type PurchaseRow = { key: string; date: string | null; number: string; party: string; amount: number; invoice: string; status: "in_hrms" | "not_in_hrms" | "no_vendor" };

/** Purchase vouchers in the file: is each invoice already a GRN in HRMS? Informational - nothing is created. */
export function reviewPurchases(vouchers: TallyVoucher[], allBillsByVendor: Map<string, OpenBill[]>): PurchaseRow[] {
  const rows: PurchaseRow[] = [];
  for (const v of vouchers) {
    if (!isPurchase(v.type)) continue;
    const party = v.ledgers.find((l) => normName(l.name) === normName(v.party) && l.credit > 0) ?? v.ledgers.filter((l) => l.credit > 0).sort((a, b) => b.credit - a.credit)[0];
    if (!party) continue;
    const bills = allBillsByVendor.get(normName(party.name));
    const invoice = v.billRefs[0]?.name || v.number;
    const status = !bills ? "no_vendor" : bills.some((b) => alnum(b.invoiceNumber) && alnum(b.invoiceNumber) === alnum(invoice)) ? "in_hrms" : "not_in_hrms";
    rows.push({ key: v.key, date: v.date, number: v.number, party: party.name, amount: r2(party.credit), invoice, status });
  }
  return rows;
}
