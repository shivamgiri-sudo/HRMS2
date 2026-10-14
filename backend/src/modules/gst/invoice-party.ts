/**
 * One set of rules for who a client bill is to and which of our registrations it was issued under,
 * shared by the GST return staging (gst-export.service.ts) and the Tally voucher export
 * (tally-voucher/tally-voucher-kinds.ts), so the two files finance reconciles can never disagree.
 */
import { normaliseStateCode } from "../client-billing/client-billing-tax.js";

const clean = (v: unknown): string => (v == null ? "" : String(v).trim());

/**
 * Party (Tally ledger) name: the invoice's own client_tally_name, else the cost centre's
 * billing_client_name, else its client_name. Empty strings are skipped, not just NULLs: a blank
 * client_tally_name otherwise produced a voucher with no party ledger.
 */
export function invoicePartyName(r: Readonly<Record<string, unknown>>): string | null {
  return clean(r.client_tally_name) || clean(r.billing_client_name) || clean(r.client_name) || null;
}

/** Client state code from the typed cost centre value, zero-padded ("9" -> "09"); null when not a code. */
export function clientStateCodeOf(raw: unknown): string | null {
  return normaliseStateCode(clean(raw));
}

/**
 * The GSTIN a bill was issued under, i.e. the one its PDF prints as ours
 * (client-billing-party.ts: cost centre service_tax_no, else branch GSTIN). A service_tax_no that
 * is not GSTIN-shaped ('NA', a PAN, a typo) cannot be a registration, so such a bill stays under
 * its branch GSTIN and is flagged (OUR_GSTIN_ON_BILL_INVALID) instead of silently dropping out of
 * every return.
 *
 * `cm` = cost_centre_master alias, `bm` = branch_master alias.
 */
export function ourGstinSql(cm = "cm", bm = "bm"): string {
  const stn = `UPPER(TRIM(COALESCE(${cm}.service_tax_no, '')))`;
  return `(CASE WHEN ${stn} REGEXP '^[0-9]{2}[A-Z0-9]{13}$' THEN ${stn} ELSE UPPER(TRIM(COALESCE(${bm}.gstin, ''))) END)`;
}

/** Same rule in TypeScript, for rows that carry service_tax_no and branch_gstin. */
export function ourGstinOf(serviceTaxNo: unknown, branchGstin: unknown): string {
  const stn = clean(serviceTaxNo).toUpperCase();
  return /^[0-9]{2}[A-Z0-9]{13}$/.test(stn) ? stn : clean(branchGstin).toUpperCase();
}

/** A non-blank service_tax_no that is not GSTIN-shaped: the PDF printed something that is not a registration. */
export function invalidServiceTaxNo(serviceTaxNo: unknown): string | null {
  const stn = clean(serviceTaxNo).toUpperCase();
  return stn && !/^[0-9]{2}[A-Z0-9]{13}$/.test(stn) ? stn : null;
}

/** PO / JCC / GRN references from the invoice's own columns (not the cost centre master defaults). */
export function invoiceReferences(r: Readonly<Record<string, unknown>>) {
  return {
    poNo: clean(r.po_numbers) || null,
    jccNo: clean(r.jcc_no) || null,
    grnNo: clean(r.grn_no) || null,
  };
}
