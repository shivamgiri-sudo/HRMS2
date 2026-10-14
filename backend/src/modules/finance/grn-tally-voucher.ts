/**
 * Builds the Tally voucher for one fully approved GRN. Pure: no database, no clock.
 *
 * The shape is the legacy billing system's GRN import (the MASSEP "Import" sheet Accounts has
 * been loading into TallyPrime), one JrnlP journal per GRN:
 *
 *   Dr expense ledger (sub-head)                 taxable + other charges + non-claimable GST
 *   Dr Input CGST @9%(Uttar Pradesh) / SGST / IGST @18%(Gujarat) ...   claimable GST
 *   Cr party (vendor, or the imprest holder's own Tally ledger)   gross - TDS
 *   Cr TDS ledger (TDS CONTRACTOR 2021-22, TDS RENT 2022-23 ...)   TDS on the taxable value
 *   Dr/Cr Short/Excess Written off               round off
 *
 * Header fields, as in the legacy sheet:
 *   Vch No          "<bill no>/<GRN no>"        (bill no "NA" when the GRN has none)
 *   Date            last day of the month the GRN was approved in (the posting month)
 *   Effective Date  the bill date
 *   Cost Category   the branch's Tally name     Cost Centre  "<branch code>/<YYMM of accounting period>"
 *   Narration for Each Entry  the description   Narration    description + GRN / bill references
 *
 * TDS is booked HERE, on the GRN, because that is where the legacy system booked it; the bank
 * voucher export therefore pays the vendor net and carries no TDS leg (tally-export.service.ts).
 *
 * The debit lines are derived so the voucher always balances: the expense line is the gross amount
 * minus the input GST and round off, never a separately added figure. A GRN whose expense line then
 * disagrees with taxable value + other charges + non-recoverable tax by more than Rs 1 is returned as
 * an exception for Accounts to look at instead of being exported with a questionable split.
 *
 * XML sign convention matches tally-export.service.ts (checked there against Tally's own published
 * example): ISDEEMEDPOSITIVE=Yes (debit) carries a NEGATIVE amount, No (credit) a POSITIVE one.
 */

export type GrnTdsRule = {
  /** Normalised section, e.g. 194C, 194I_LB. */
  section: string;
  ratePct: number;
  /** Exact Tally TDS ledger when the master carries one (legacy settings); else named from the section. */
  ledger?: string | null;
  /** Where the rule came from, shown on the check sheet. */
  basis: string;
};

export type GrnVoucherInput = {
  grnId: string;
  grnNumber: string;
  grnType: "vendor" | "imprest";
  billDate: string; // YYYY-MM-DD
  /** Approval date, YYYY-MM-DD; the voucher is dated the last day of its month. */
  postingDate: string | null;
  /** YYYY-MM the cost lands in; names the cost centre. */
  accountingPeriod: string | null;
  invoiceNumber: string | null;
  vendorLedger: string | null; // vendor's Tally name; null for imprest
  /** Imprest holder's Tally ledger (imprest_manager.tally_name); null for vendor GRNs. */
  imprestLedger: string | null;
  expenseLedger: string; // sub-head name
  headName: string | null;
  branchName: string | null;
  /** Cost centre prefix for the branch (HO, NOIDA-2, AHM-JD ...). */
  branchCode: string | null;
  /** State of the branch's GST registration, as Tally's input-tax ledgers name it. */
  gstStateName: string | null;
  narrationText: string | null;
  amountWithoutTax: number;
  taxAmount: number;
  otherCharges: number;
  roundOff: number;
  gross: number; // amount_with_tax, else amount
  gstType: "cgst_sgst" | "igst" | "none" | string | null;
  gstRate: number | null;
  recoverableTaxPct: number;
  tds: GrnTdsRule | null;
};

export type GrnTallyLedgerNames = {
  voucherType: string;
  /** Voucher type for imprest GRNs; the legacy import never carried them, Tally keeps JRNLIMP for them. */
  imprestVoucherType: string;
  roundOff: string;
  /** Patterns: {rate} and {state} are filled in. */
  inputCgst: string;
  inputSgst: string;
  inputIgst: string;
  /** Normalised TDS section -> Tally ledger. */
  tdsLedgers: Record<string, string>;
};

export const DEFAULT_LEDGER_NAMES: GrnTallyLedgerNames = {
  voucherType: "JrnlP",
  imprestVoucherType: "JRNLIMP",
  roundOff: "Short/Excess Written off",
  inputCgst: "Input CGST @{rate}%({state})",
  inputSgst: "Input SGST @{rate}%({state})",
  inputIgst: "Input IGST @{rate}%({state})",
  // Names as they stand in the MAS Callnet Tally company; the legacy sheet books bandwidth and
  // software subscriptions (194J technical) to the contractor ledger too.
  tdsLedgers: {
    "194C": "TDS CONTRACTOR 2021-22",
    "194J_TECH": "TDS CONTRACTOR 2021-22",
    "194I_LB": "TDS RENT 2022-23",
    "194I_PM": "TDS MACHINERY RENTAL 2021-22",
    "194J_PROF": "TDS Professional 2022-23",
  },
};

/** One ledger line of a built voucher. */
export type GrnVoucherEntry = {
  ledger: string;
  side: "Dr" | "Cr";
  amount: number;
};

export type GrnVoucherHeader = {
  voucherNumber: string;
  date: string; // YYYY-MM-DD
  effectiveDate: string; // YYYY-MM-DD
  costCategory: string;
  costCentre: string;
  narrationEntry: string;
  narration: string;
  voucherType: string;
};

export type BuiltVoucher =
  | {
      ok: true;
      grnId: string;
      xml: string;
      gross: number;
      tdsAmount: number;
      lines: number;
      voucherType: string;
      header: GrnVoucherHeader;
      entries: GrnVoucherEntry[];
    }
  | { ok: false; grnId: string; grnNumber: string; reason: string };

const r2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export function xmlEscape(value: unknown): string {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const tallyDate = (d: string) => String(d).slice(0, 10).replace(/-/g, "");

/** 2026-09-14 -> 2026-09-30. */
export function monthEnd(date: string): string {
  const [y, m] = date.slice(0, 7).split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${date.slice(0, 7)}-${String(last).padStart(2, "0")}`;
}

/** 2026-09-01 -> 01-09-2026, as the legacy narration prints it. */
const dmy = (d: string) => `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;

/** 9 -> "9", 2.5 -> "2.5", 9.000 -> "9". */
const pct = (n: number) => String(r2(n));

const fill = (pattern: string, values: Record<string, string>) =>
  pattern.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? "");

const STANDARD_GST_RATES = [0.25, 3, 5, 12, 18, 28, 40];

/**
 * The GRN's own rate when it is a standard slab, else the slab nearest to tax / taxable value. A
 * stored 17.42 or 8.32 (an effective rate typed into the rate field) never names a Tally ledger.
 */
export function effectiveGstRate(input: Pick<GrnVoucherInput, "gstRate" | "taxAmount" | "amountWithoutTax">): number | null {
  if (input.gstRate && STANDARD_GST_RATES.includes(Number(input.gstRate))) return Number(input.gstRate);
  if (!(input.amountWithoutTax > 0) || !(input.taxAmount > 0)) return null;
  const derived = (input.taxAmount / input.amountWithoutTax) * 100;
  const nearest = STANDARD_GST_RATES.reduce((best, r) => (Math.abs(r - derived) < Math.abs(best - derived) ? r : best));
  // Within 5% of the slab (paise rounding on small bills), never a far-off guess.
  return Math.abs(nearest - derived) <= nearest * 0.05 ? nearest : null;
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
  if (!input.postingDate || !/^\d{4}-\d{2}-\d{2}/.test(input.postingDate))
    return fail("Approval date is missing, so there is no posting month.");
  if (!input.expenseLedger?.trim())
    return fail("Sub-head is missing, so there is no expense ledger to debit.");
  if (!input.branchName?.trim())
    return fail("Branch is missing, so there is no cost category.");
  const period = /^\d{4}-\d{2}$/.test(input.accountingPeriod ?? "")
    ? (input.accountingPeriod as string)
    : input.billDate.slice(0, 7);
  const credit =
    input.grnType === "imprest"
      ? input.imprestLedger?.trim()
      : input.vendorLedger?.trim();
  if (!credit)
    return fail(
      input.grnType === "imprest"
        ? "Imprest float holder has no Tally ledger name (set it on the imprest manager), so there is nothing to credit."
        : "Vendor has no name to credit.",
    );

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

  let rate: number | null = null;
  const state = input.gstStateName?.trim() ?? "";
  if (inputTax > 0) {
    rate = effectiveGstRate(input);
    if (!rate) return fail("GST rate is not a standard slab (5/12/18/28%) and cannot be read from the tax and taxable value; check the GST on this GRN.");
    if (!state) return fail("Branch GST state is not set, so the input GST ledger cannot be named.");
  }

  // TDS on the value before GST, as the legacy sheet does (10% of Rs 4,38,900 rent = 43,890).
  let tdsAmount = 0;
  let tdsLedger = "";
  if (input.tds && input.tds.ratePct > 0) {
    tdsLedger = input.tds.ledger?.trim() || names.tdsLedgers[input.tds.section] || "";
    if (!tdsLedger)
      return fail(`No Tally TDS ledger is set for section ${input.tds.section}.`);
    const base = input.amountWithoutTax > 0 ? input.amountWithoutTax + input.otherCharges : expense;
    tdsAmount = r2((base * input.tds.ratePct) / 100);
    if (!(tdsAmount < gross)) return fail("TDS would be the whole bill or more.");
  }

  const entries: GrnVoucherEntry[] = [];
  const add = (ledger: string, amount: number, side: "Dr" | "Cr") => {
    if (r2(amount) !== 0) entries.push({ ledger, side, amount: r2(Math.abs(amount)) });
  };
  add(input.expenseLedger.trim(), expense, "Dr");
  if (inputTax > 0 && rate) {
    if (input.gstType === "igst") {
      add(fill(names.inputIgst, { rate: pct(rate), state }), inputTax, "Dr");
    } else {
      const half = r2(inputTax / 2);
      add(fill(names.inputCgst, { rate: pct(rate / 2), state }), half, "Dr");
      add(fill(names.inputSgst, { rate: pct(rate / 2), state }), r2(inputTax - half), "Dr");
    }
  }
  // Order as the legacy sheet: expense, GST, party, TDS, round off.
  add(credit, gross - tdsAmount, "Cr");
  if (tdsAmount > 0) add(tdsLedger, tdsAmount, "Cr");
  if (roundOff !== 0) add(names.roundOff, roundOff, roundOff > 0 ? "Dr" : "Cr");

  const billNo = input.invoiceNumber?.trim() || "NA";
  const [yyyy, mm] = period.split("-");
  const description = (input.narrationText?.trim() || input.expenseLedger.trim()).replace(/\s+/g, " ");
  const header: GrnVoucherHeader = {
    voucherNumber: `${billNo}/${input.grnNumber}`,
    date: monthEnd(input.postingDate),
    effectiveDate: input.billDate.slice(0, 10),
    costCategory: input.branchName.trim(),
    costCentre: `${(input.branchCode?.trim() || input.branchName.trim())}/${yyyy.slice(2)}${mm}`,
    narrationEntry: description,
    narration: `${description} GRN NO.: ${input.grnNumber}, Bill No.:${billNo} , Bill Date.:${dmy(input.billDate)}`,
    voucherType: input.grnType === "imprest" ? names.imprestVoucherType : names.voucherType,
  };

  const lines = entries.map((e) => {
    const signed = (e.side === "Dr" ? -e.amount : e.amount).toFixed(2);
    const isParty = e.side === "Cr" && e.ledger === credit && input.grnType === "vendor";
    return (
      `<ALLLEDGERENTRIES.LIST>` +
      `<LEDGERNAME>${xmlEscape(e.ledger)}</LEDGERNAME>` +
      `<ISDEEMEDPOSITIVE>${e.side === "Dr" ? "Yes" : "No"}</ISDEEMEDPOSITIVE>` +
      `<ISPARTYLEDGER>${isParty ? "Yes" : "No"}</ISPARTYLEDGER>` +
      `<AMOUNT>${signed}</AMOUNT>` +
      `<CATEGORYALLOCATIONS.LIST><CATEGORY>${xmlEscape(header.costCategory)}</CATEGORY>` +
      `<COSTCENTREALLOCATIONS.LIST><NAME>${xmlEscape(header.costCentre)}</NAME><AMOUNT>${signed}</AMOUNT></COSTCENTREALLOCATIONS.LIST>` +
      `</CATEGORYALLOCATIONS.LIST>` +
      `</ALLLEDGERENTRIES.LIST>`
    );
  });

  const xml =
    // REMOTEID: a fixed id per GRN, so importing the same file twice leaves one voucher, not two.
    `<VOUCHER REMOTEID="HRMS-GRN-${xmlEscape(input.grnId)}" VCHTYPE="${xmlEscape(header.voucherType)}" ACTION="Create" OBJVIEW="Accounting Voucher View">` +
    `<DATE>${tallyDate(header.date)}</DATE>` +
    `<EFFECTIVEDATE>${tallyDate(header.effectiveDate)}</EFFECTIVEDATE>` +
    `<VOUCHERTYPENAME>${xmlEscape(header.voucherType)}</VOUCHERTYPENAME>` +
    `<VOUCHERNUMBER>${xmlEscape(header.voucherNumber)}</VOUCHERNUMBER>` +
    `<REFERENCE>${xmlEscape(billNo)}</REFERENCE>` +
    `<REFERENCEDATE>${tallyDate(header.effectiveDate)}</REFERENCEDATE>` +
    `<NARRATION>${xmlEscape(header.narration)}</NARRATION>` +
    `<PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>` +
    lines.join("") +
    `</VOUCHER>`;
  return {
    ok: true,
    grnId: input.grnId,
    xml,
    gross,
    tdsAmount,
    lines: lines.length,
    voucherType: header.voucherType,
    header,
    entries,
  };
}

/**
 * Wraps built vouchers (and masters) in the Tally import envelope.
 *
 * Tested on TallyPrime 7.2:
 *   - LEDGER ACTION="Create" for a name that exists ALTERS it (moved it to the file's group), which would
 *     silently re-group Accounts' own ledgers. IMPORTDUPS @@DUPIGNORE stops that, but only when the
 *     request is "All Masters"; under "Vouchers" Tally ignores the setting.
 *   - An "All Masters" request still imports the vouchers in it, and with a voucher's fixed REMOTEID a
 *     second import of the same file is ignored (0 created, 0 altered), so a file can be re-imported safely.
 */
export function wrapTallyEnvelope(
  vouchers: string[],
  companyName?: string | null,
): string {
  const company = companyName?.trim() ? `<SVCURRENTCOMPANY>${xmlEscape(companyName.trim())}</SVCURRENTCOMPANY>` : "";
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA>` +
    `<REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES><IMPORTDUPS>@@DUPIGNORE</IMPORTDUPS>${company}</STATICVARIABLES></REQUESTDESC>` +
    `<REQUESTDATA>${vouchers.map((v) => `<TALLYMESSAGE xmlns:UDF="TallyUDF">${v}</TALLYMESSAGE>`).join("")}</REQUESTDATA>` +
    `</IMPORTDATA></BODY></ENVELOPE>`
  );
}
