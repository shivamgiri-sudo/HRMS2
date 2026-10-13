/**
 * Pre-export exception check for Tally vouchers.
 *
 * Mirrors the gst-export staging pattern: a voucher that cannot be imported cleanly is still
 * produced, flagged with machine-readable reasons, so Finance gets a worklist instead of a file
 * Tally half-accepts. Severity "error" blocks the voucher from the XML; "warning" is shown but
 * does not block.
 */

import { isValidGstin } from "../gst-export.service.js";
import { totalsByDrCr } from "./tally-voucher-xml.js";
import type {
  TallyException,
  TallyLedgerConfig,
  TallyVoucherModel,
} from "./tally-voucher.types.js";

/** Invoice-level rounding up to a rupee is legitimate; beyond that the document is inconsistent. */
export const TOTAL_TOLERANCE_PAISE = 100;

export interface VoucherCheckInput {
  model: TallyVoucherModel;
  config: TallyLedgerConfig;
  companyName: string | null;
  /** Document total as stored on the source row, in paise. */
  documentTotalPaise: number;
  taxablePaise: number;
  igstPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  applyGst: boolean;
  hsnSac: string | null;
  branchStateCode: string | null;
  clientStateCode: string | null;
  /** Credit notes only: the invoice the note settles. */
  requiresOriginalBill: boolean;
}

export function checkVoucher(input: VoucherCheckInput): TallyException[] {
  const { model, config } = input;
  const out: TallyException[] = [];
  const push = (code: string, severity: "error" | "warning", message: string) =>
    out.push({ code, severity, message });

  if (!input.companyName)
    push(
      "COMPANY_NAME_MISSING",
      "error",
      "No Tally company name for this registration - set it in the ledger configuration (or branch company name).",
    );
  if (!model.voucherNumber)
    push(
      "DOCUMENT_NUMBER_MISSING",
      "error",
      "No invoice / credit-note number.",
    );
  if (!model.date) push("DOCUMENT_DATE_MISSING", "error", "No document date.");
  if (!model.partyLedger)
    push(
      "PARTY_LEDGER_MISSING",
      "error",
      "No party ledger name - the cost centre has no billing client name (and the invoice no Tally client name).",
    );
  if (!model.voucherType)
    push("VOUCHER_TYPE_MISSING", "error", "No Tally voucher type configured.");

  const salesEntry = model.entries.find((e) => e.role === "sales");
  if (!salesEntry || !salesEntry.ledgerName.trim())
    push("SALES_LEDGER_MISSING", "error", "No sales ledger name resolved.");

  const needTax: Array<[string, number, string]> = [
    ["IGST", input.igstPaise, config.igstLedger],
    ["CGST", input.cgstPaise, config.cgstLedger],
    ["SGST", input.sgstPaise, config.sgstLedger],
  ];
  for (const [label, paise, ledger] of needTax) {
    if (paise > 0 && !ledger.trim())
      push(
        "TAX_LEDGER_MISSING",
        "error",
        `${label} is charged but no ${label} ledger name is configured.`,
      );
  }

  if (input.requiresOriginalBill) {
    const party = model.entries.find((e) => e.role === "party");
    if (!party?.billAllocations?.some((b) => b.name))
      push(
        "ORIGINAL_BILL_MISSING",
        "error",
        "Credit note is not linked to an invoice with a bill number - Tally cannot settle it against a reference.",
      );
  }

  const gstin = model.partyGstin;
  if (gstin && !isValidGstin(gstin))
    push(
      "RECIPIENT_GSTIN_INVALID",
      "error",
      `Client GSTIN ${gstin} fails its check digit.`,
    );
  if (input.applyGst && !gstin)
    push(
      "RECIPIENT_GSTIN_MISSING",
      "warning",
      "GST charged but no client GSTIN - imported as an unregistered party. Confirm the client is genuinely unregistered.",
    );
  if (input.applyGst && !input.hsnSac)
    push(
      "HSN_SAC_MISSING",
      "warning",
      "No HSN/SAC on the cost centre - the sales line goes to Tally without a code.",
    );

  const hasIgst = input.igstPaise > 0;
  const hasSplit = input.cgstPaise > 0 || input.sgstPaise > 0;
  if (hasIgst && hasSplit)
    push(
      "TAX_SPLIT_MIXED",
      "error",
      "Document carries both IGST and CGST/SGST.",
    );
  if (hasSplit && input.cgstPaise !== input.sgstPaise)
    push(
      "CGST_SGST_ASYMMETRIC",
      "error",
      "CGST and SGST amounts are not equal.",
    );
  if (input.applyGst && !hasIgst && !hasSplit && input.taxablePaise > 0)
    push("TAX_MISSING", "error", "Marked taxable but carries no tax amount.");
  if (input.branchStateCode && input.clientStateCode) {
    const inter = input.branchStateCode !== input.clientStateCode;
    if (inter && hasSplit)
      push(
        "SPLIT_STATE_MISMATCH",
        "error",
        `Supplier state ${input.branchStateCode} differs from client state ${input.clientStateCode}, so tax must be IGST.`,
      );
    if (!inter && hasIgst)
      push(
        "SPLIT_STATE_MISMATCH",
        "error",
        `Supplier and client are both in state ${input.branchStateCode}, so tax must be CGST/SGST.`,
      );
  } else if (input.applyGst) {
    push(
      "PLACE_OF_SUPPLY_UNKNOWN",
      "warning",
      "Place of supply could not be resolved - the IGST vs CGST/SGST split is unverified.",
    );
  }

  const components =
    input.taxablePaise + input.igstPaise + input.cgstPaise + input.sgstPaise;
  if (Math.abs(components - input.documentTotalPaise) > TOTAL_TOLERANCE_PAISE)
    push(
      "TOTAL_MISMATCH",
      "error",
      `Taxable + tax = ${(components / 100).toFixed(2)} but the document total is ${(input.documentTotalPaise / 100).toFixed(2)} (more than the Rs 1.00 round-off allowance).`,
    );

  const { debit, credit } = totalsByDrCr(model.entries);
  if (debit !== credit)
    push(
      "VOUCHER_UNBALANCED",
      "error",
      `Debits ${(debit / 100).toFixed(2)} and credits ${(credit / 100).toFixed(2)} do not balance.`,
    );
  if (debit === 0) push("VOUCHER_EMPTY", "error", "Voucher has a zero value.");

  return out;
}

export const hasBlockingError = (errors: readonly TallyException[]): boolean =>
  errors.some((e) => e.severity === "error");
