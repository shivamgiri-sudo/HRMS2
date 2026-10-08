/**
 * Builds the Tally XML for one fully approved GRN. Pure: no database, no clock.
 *
 *   vendor GRN  -> Purchase voucher:  Dr expense (+ Dr input GST, Dr/Cr round off)   Cr vendor (gross)
 *   imprest GRN -> Journal voucher:   Dr expense (+ Dr input GST, Dr/Cr round off)   Cr Imprest Float (gross)
 *
 * The debit lines are derived so the voucher always balances: the expense line is the gross amount
 * minus the input GST and round off, never a separately added figure. A GRN whose expense line then
 * disagrees with taxable value + other charges + non-recoverable tax by more than Rs 1 is returned as
 * an exception for Accounts to look at instead of being exported with a questionable split.
 *
 * Sign convention matches tally-export.service.ts (checked there against Tally's own published
 * example): ISDEEMEDPOSITIVE=Yes (debit) carries a NEGATIVE amount, No (credit) a POSITIVE one.
 */

export type GrnVoucherInput = {
  grnId: string;
  grnNumber: string;
  grnType: "vendor" | "imprest";
  billDate: string; // YYYY-MM-DD
  invoiceNumber: string | null;
  vendorLedger: string | null; // vendor's Tally name; null for imprest
  expenseLedger: string; // sub-head name
  headName: string | null;
  branchName: string | null;
  narrationText: string | null;
  amountWithoutTax: number;
  taxAmount: number;
  otherCharges: number;
  roundOff: number;
  gross: number; // amount_with_tax, else amount
  gstType: "cgst_sgst" | "igst" | "none" | string | null;
  recoverableTaxPct: number;
};

export type GrnTallyLedgerNames = {
  imprestLedger: string;
  inputCgst: string;
  inputSgst: string;
  inputIgst: string;
  roundOff: string;
};

export const DEFAULT_LEDGER_NAMES: GrnTallyLedgerNames = {
  imprestLedger: "Imprest Float",
  inputCgst: "Input CGST",
  inputSgst: "Input SGST",
  inputIgst: "Input IGST",
  roundOff: "Round Off",
};

export type BuiltVoucher =
  | { ok: true; grnId: string; xml: string; gross: number; lines: number }
  | { ok: false; grnId: string; grnNumber: string; reason: string };

const r2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export function xmlEscape(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const tallyDate = (d: string) => String(d).slice(0, 10).replace(/-/g, "");

function ledgerEntry(
  name: string,
  amount: number,
  isDebit: boolean,
  isParty = false,
): string {
  const signed = isDebit ? -Math.abs(amount) : Math.abs(amount);
  return (
    `<ALLLEDGERENTRIES.LIST>` +
    `<LEDGERNAME>${xmlEscape(name)}</LEDGERNAME>` +
    `<ISDEEMEDPOSITIVE>${isDebit ? "Yes" : "No"}</ISDEEMEDPOSITIVE>` +
    `<ISPARTYLEDGER>${isParty ? "Yes" : "No"}</ISPARTYLEDGER>` +
    `<AMOUNT>${signed.toFixed(2)}</AMOUNT>` +
    `</ALLLEDGERENTRIES.LIST>`
  );
}

export function buildGrnVoucher(
  input: GrnVoucherInput,
  names: GrnTallyLedgerNames = DEFAULT_LEDGER_NAMES,
): BuiltVoucher {
  const fail = (reason: string): BuiltVoucher => ({
    ok: false,
    grnId: input.grnId,
    grnNumber: input.grnNumber,
    reason,
  });
  const gross = r2(input.gross);
  if (!input.grnNumber) return fail("No GRN number yet.");
  if (!(gross > 0)) return fail("Amount is zero or missing.");
  if (!input.billDate || !/^\d{4}-\d{2}-\d{2}/.test(input.billDate))
    return fail("Bill date is missing.");
  if (!input.expenseLedger?.trim())
    return fail("Sub-head is missing, so there is no expense ledger to debit.");
  const credit =
    input.grnType === "imprest"
      ? names.imprestLedger
      : input.vendorLedger?.trim();
  if (!credit) return fail("Vendor has no name to credit.");

  const tax = r2(input.taxAmount);
  const recoverablePct = Math.min(
    100,
    Math.max(0, Number(input.recoverableTaxPct ?? 100)),
  );
  const inputTax =
    input.gstType === "none" || !input.gstType
      ? 0
      : r2((tax * recoverablePct) / 100);
  const roundOff = r2(input.roundOff);
  const expense = r2(gross - inputTax - roundOff);
  if (!(expense > 0))
    return fail(
      "Expense line would be zero or negative after GST and round off.",
    );

  // Sanity: the expense should be taxable value + other charges + the part of GST that cannot be claimed.
  const expected = r2(
    input.amountWithoutTax + input.otherCharges + (tax - inputTax),
  );
  if (input.amountWithoutTax > 0 && Math.abs(expected - expense) > 1) {
    return fail(
      `Amounts do not add up: gross ${gross.toFixed(2)} leaves ${expense.toFixed(2)} for the expense, but taxable value plus charges and non-claimable GST is ${expected.toFixed(2)}.`,
    );
  }

  const lines: string[] = [];
  lines.push(ledgerEntry(input.expenseLedger.trim(), expense, true));
  if (inputTax > 0) {
    if (input.gstType === "igst") {
      lines.push(ledgerEntry(names.inputIgst, inputTax, true));
    } else {
      const half = r2(inputTax / 2);
      lines.push(ledgerEntry(names.inputCgst, half, true));
      lines.push(ledgerEntry(names.inputSgst, r2(inputTax - half), true));
    }
  }
  if (roundOff !== 0)
    lines.push(ledgerEntry(names.roundOff, Math.abs(roundOff), roundOff > 0));
  lines.push(ledgerEntry(credit, gross, false, input.grnType === "vendor"));

  const vchType = input.grnType === "vendor" ? "Purchase" : "Journal";
  const narration = [
    `GRN ${input.grnNumber}`,
    input.invoiceNumber ? `Inv ${input.invoiceNumber}` : null,
    input.branchName,
    input.headName
      ? `${input.headName} / ${input.expenseLedger}`
      : input.expenseLedger,
    input.narrationText,
  ]
    .filter(Boolean)
    .join(" | ")
    .slice(0, 480);

  const xml =
    `<VOUCHER VCHTYPE="${vchType}" ACTION="Create" OBJVIEW="Accounting Voucher View">` +
    `<DATE>${tallyDate(input.billDate)}</DATE>` +
    `<VOUCHERTYPENAME>${vchType}</VOUCHERTYPENAME>` +
    `<VOUCHERNUMBER>${xmlEscape(input.grnNumber)}</VOUCHERNUMBER>` +
    (input.grnType === "vendor"
      ? `<PARTYLEDGERNAME>${xmlEscape(credit)}</PARTYLEDGERNAME><REFERENCE>${xmlEscape(input.invoiceNumber ?? "")}</REFERENCE>`
      : ``) +
    `<NARRATION>${xmlEscape(narration)}</NARRATION>` +
    `<PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>` +
    lines.join("") +
    `</VOUCHER>`;
  return { ok: true, grnId: input.grnId, xml, gross, lines: lines.length };
}

/** Wraps built vouchers in the Tally import envelope. */
export function wrapTallyEnvelope(
  vouchers: string[],
  companyName?: string | null,
): string {
  const company = companyName?.trim()
    ? `<STATICVARIABLES><SVCURRENTCOMPANY>${xmlEscape(companyName.trim())}</SVCURRENTCOMPANY></STATICVARIABLES>`
    : "";
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA>` +
    `<REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>${company}</REQUESTDESC>` +
    `<REQUESTDATA>${vouchers.map((v) => `<TALLYMESSAGE xmlns:UDF="TallyUDF">${v}</TALLYMESSAGE>`).join("")}</REQUESTDATA>` +
    `</IMPORTDATA></BODY></ENVELOPE>`
  );
}
