/**
 * Shared shapes for the Tally Prime voucher XML export.
 *
 * A voucher is described by a TallyVoucherModel: plain data, integer paise, no XML. The XML
 * writer (tally-voucher-xml.ts) and the exception checker (tally-voucher-check.ts) both work off
 * that model, so a new voucher kind (Receipt, added by a later task) only has to produce a model -
 * it never touches XML or the exception plumbing. See tally-voucher-kinds.ts for the registry.
 */

export type TallyVoucherKind = "sales" | "credit_note" | "receipt";
export type TallySourceType = "invoice" | "credit_note" | "receipt";
export type TallyAction = "Create" | "Alter";

export interface TallyBillAllocation {
  name: string;
  /** New Ref opens a bill; Agst Ref settles an existing one. */
  type: "New Ref" | "Agst Ref";
  paise: number;
}

export type TallyEntryRole = "party" | "sales" | "tax" | "round_off" | "other";

export interface TallyLedgerEntry {
  ledgerName: string;
  /** Dr -> ISDEEMEDPOSITIVE Yes and a NEGATIVE AMOUNT; Cr -> No and a POSITIVE AMOUNT. */
  side: "Dr" | "Cr";
  /** Always positive integer paise; the side carries the sign. */
  paise: number;
  role: TallyEntryRole;
  billAllocations?: TallyBillAllocation[];
  hsnSac?: string | null;
  gstRatePct?: number | null;
}

export interface TallyVoucherModel {
  kind: TallyVoucherKind;
  sourceType: TallySourceType;
  sourceId: string;
  /** Stable for the life of the document: see deriveVoucherGuid. */
  guid: string;
  voucherType: string;
  voucherNumber: string;
  /** YYYY-MM-DD */
  date: string;
  narration: string;
  partyLedger: string;
  partyGstin: string | null;
  partyStateName: string | null;
  placeOfSupply: string | null;
  companyGstin: string;
  companyStateName: string | null;
  entries: TallyLedgerEntry[];
  /** Display-only context for the preview table and drill-down; never written to XML. */
  display: {
    clientName: string | null;
    costCentreCode: string | null;
    amountPaise: number;
    taxablePaise: number;
    taxPaise: number;
  };
}

export type TallyExceptionSeverity = "error" | "warning";

export interface TallyException {
  code: string;
  severity: TallyExceptionSeverity;
  message: string;
}

/** The ledger / voucher-type names Finance maintains; see tally_export_config. */
export interface TallyLedgerConfig {
  salesLedger: string;
  creditNoteSalesLedger: string;
  igstLedger: string;
  cgstLedger: string;
  sgstLedger: string;
  roundOffLedger: string;
  tdsReceivableLedger: string;
  salesVoucherType: string;
  creditNoteVoucherType: string;
  receiptVoucherType: string;
}

export const CONFIG_KEY_BY_FIELD: Record<keyof TallyLedgerConfig, string> = {
  salesLedger: "sales_ledger",
  creditNoteSalesLedger: "credit_note_sales_ledger",
  igstLedger: "igst_ledger",
  cgstLedger: "cgst_ledger",
  sgstLedger: "sgst_ledger",
  roundOffLedger: "round_off_ledger",
  tdsReceivableLedger: "tds_receivable_ledger",
  salesVoucherType: "sales_voucher_type",
  creditNoteVoucherType: "credit_note_voucher_type",
  receiptVoucherType: "receipt_voucher_type",
};

/** Used when tally_export_config has no row (e.g. migration not yet applied). */
export const DEFAULT_LEDGER_CONFIG: TallyLedgerConfig = {
  salesLedger: "Sales",
  creditNoteSalesLedger: "Sales Returns",
  igstLedger: "Output IGST",
  cgstLedger: "Output CGST",
  sgstLedger: "Output SGST",
  roundOffLedger: "Round Off",
  tdsReceivableLedger: "TDS Receivable",
  salesVoucherType: "Sales",
  creditNoteVoucherType: "Credit Note",
  receiptVoucherType: "Receipt",
};
