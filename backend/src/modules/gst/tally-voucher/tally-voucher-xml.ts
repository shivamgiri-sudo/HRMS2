/**
 * Tally Prime import XML for accounting vouchers.
 *
 * Envelope shape: ENVELOPE > HEADER + BODY > IMPORTDATA > REQUESTDESC + REQUESTDATA >
 * TALLYMESSAGE > VOUCHER. This is the "Import Data / Vouchers" request Tally Prime's XML
 * import accepts.
 *
 * Sign convention (same one finance/tally-export.service.ts verified against Tally's published
 * case study): Dr => ISDEEMEDPOSITIVE=Yes, AMOUNT negative; Cr => ISDEEMEDPOSITIVE=No, AMOUNT
 * positive. A balanced voucher therefore sums to exactly zero.
 *
 * Re-export: a voucher that was exported before is emitted with ACTION="Alter" and the SAME
 * GUID/REMOTEID, which makes Tally update it in place rather than create a duplicate.
 *
 * NOT VERIFIED AGAINST A REAL TALLY PRIME COMPANY. The structure follows Tally's documented
 * import format and the pattern already used by the payment-voucher export, but the GST-specific
 * fields (HSN/SAC details, place of supply, registration type) and the Agst Ref credit-note
 * allocation have only been checked for XML well-formedness and arithmetic balance here. Import a
 * small batch into a scratch Tally company first.
 */

import { createHash } from "crypto";
import { TallyMasters, type TallyGroup } from "../../finance/tally-ledger-masters.js";
import type {
  TallyAction,
  TallyLedgerEntry,
  TallyVoucherModel,
} from "./tally-voucher.types.js";

/**
 * Characters XML 1.0 cannot carry (control codes except tab/LF/CR) plus lone surrogates.
 * Legacy db_bill text has carried stray \r and \x0b before; one such byte makes Tally reject the
 * whole file, so every text value is scrubbed here rather than trusted.
 */
// eslint-disable-next-line no-control-regex
const XML_ILLEGAL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

export function xmlText(value: unknown): string {
  return String(value ?? "")
    .replace(XML_ILLEGAL, "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .trim();
}

/** YYYY-MM-DD -> YYYYMMDD (Tally's date format). */
export function tallyDate(isoDate: string): string {
  return String(isoDate).slice(0, 10).replace(/-/g, "");
}

export function rupees(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * A GUID that is a pure function of the document identity, so it is stable across batches,
 * restarts and re-generations without needing to be looked up first. Formatted as a UUID so it
 * fits CHAR(36).
 */
export function deriveVoucherGuid(
  sourceType: string,
  sourceId: string,
): string {
  const h = createHash("sha1")
    .update(`hrms2-tally-voucher|${sourceType}|${sourceId}`)
    .digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** Hash of everything that ends up in the XML, used to show "changed since last export". */
export function voucherContentHash(model: TallyVoucherModel): string {
  const { guid: _guid, display: _display, ...content } = model;
  return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

export function totalsByDrCr(entries: readonly TallyLedgerEntry[]): {
  debit: number;
  credit: number;
} {
  let debit = 0;
  let credit = 0;
  for (const e of entries) {
    if (e.side === "Dr") debit += e.paise;
    else credit += e.paise;
  }
  return { debit, credit };
}

function entryXml(e: TallyLedgerEntry): string {
  const isDr = e.side === "Dr";
  const signed = isDr ? -e.paise : e.paise;
  const lines: string[] = [
    `            <LEDGERNAME>${xmlText(e.ledgerName)}</LEDGERNAME>`,
    `            <ISDEEMEDPOSITIVE>${isDr ? "Yes" : "No"}</ISDEEMEDPOSITIVE>`,
  ];
  if (e.role === "party")
    lines.push(`            <ISPARTYLEDGER>Yes</ISPARTYLEDGER>`);
  lines.push(`            <AMOUNT>${rupees(signed)}</AMOUNT>`);
  if (e.role === "sales" && e.hsnSac) {
    lines.push(
      `            <GSTOVRDNTAXABILITY>Taxable</GSTOVRDNTAXABILITY>`,
      `            <HSNSACDETAILS.LIST>`,
      `              <HSNCODE>${xmlText(e.hsnSac)}</HSNCODE>`,
      `              <SRCOFHSNDETAILS>Specify Details Here</SRCOFHSNDETAILS>`,
      `            </HSNSACDETAILS.LIST>`,
    );
  }
  for (const b of e.billAllocations ?? []) {
    const billSigned = isDr ? -b.paise : b.paise;
    lines.push(
      `            <BILLALLOCATIONS.LIST>`,
      `              <NAME>${xmlText(b.name)}</NAME>`,
      `              <BILLTYPE>${b.type}</BILLTYPE>`,
      `              <AMOUNT>${rupees(billSigned)}</AMOUNT>`,
      `            </BILLALLOCATIONS.LIST>`,
    );
  }
  return `          <LEDGERENTRIES.LIST>\n${lines.join("\n")}\n          </LEDGERENTRIES.LIST>`;
}

/** One <TALLYMESSAGE> for one voucher. Pure; the caller decides Create vs Alter. */
export function buildVoucherMessageXml(
  model: TallyVoucherModel,
  action: TallyAction,
): string {
  const head: string[] = [
    `          <DATE>${tallyDate(model.date)}</DATE>`,
    `          <EFFECTIVEDATE>${tallyDate(model.date)}</EFFECTIVEDATE>`,
    `          <GUID>${xmlText(model.guid)}</GUID>`,
    `          <VOUCHERTYPENAME>${xmlText(model.voucherType)}</VOUCHERTYPENAME>`,
    `          <VOUCHERNUMBER>${xmlText(model.voucherNumber)}</VOUCHERNUMBER>`,
    `          <PARTYLEDGERNAME>${xmlText(model.partyLedger)}</PARTYLEDGERNAME>`,
    `          <PARTYNAME>${xmlText(model.partyLedger)}</PARTYNAME>`,
    `          <COUNTRYOFRESIDENCE>India</COUNTRYOFRESIDENCE>`,
    `          <GSTREGISTRATIONTYPE>${model.partyGstin ? "Regular" : "Unregistered"}</GSTREGISTRATIONTYPE>`,
  ];
  if (model.partyGstin)
    head.push(
      `          <PARTYGSTIN>${xmlText(model.partyGstin)}</PARTYGSTIN>`,
    );
  if (model.partyStateName)
    head.push(
      `          <STATENAME>${xmlText(model.partyStateName)}</STATENAME>`,
    );
  if (model.placeOfSupply)
    head.push(
      `          <PLACEOFSUPPLY>${xmlText(model.placeOfSupply)}</PLACEOFSUPPLY>`,
    );
  head.push(`          <CMPGSTIN>${xmlText(model.companyGstin)}</CMPGSTIN>`);
  if (model.companyStateName)
    head.push(
      `          <CMPGSTSTATE>${xmlText(model.companyStateName)}</CMPGSTSTATE>`,
    );
  head.push(
    `          <NARRATION>${xmlText(model.narration)}</NARRATION>`,
    `          <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>`,
  );

  const entries = model.entries.map((e) => entryXml(e)).join("\n");

  return `      <TALLYMESSAGE xmlns:UDF="TallyUDF">
        <VOUCHER REMOTEID="${xmlText(model.guid)}" VCHTYPE="${xmlText(model.voucherType)}" ACTION="${action}" OBJVIEW="Accounting Voucher View">
${head.join("\n")}
${entries}
        </VOUCHER>
      </TALLYMESSAGE>`;
}

export interface TallyActionResolver {
  (model: TallyVoucherModel): TallyAction;
}

/**
 * Full import file. `provisionalNote` becomes an XML comment (e.g. when exceptions were skipped).
 */
export function buildTallyEnvelope(
  companyName: string,
  messages: readonly string[],
  provisionalNote?: string,
  withMasters = false,
): string {
  const note = provisionalNote
    ? `\n  <!-- ${provisionalNote.replace(/--+/g, "-").replace(XML_ILLEGAL, "")} -->`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>${note}
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>${withMasters ? "All Masters" : "Vouchers"}</REPORTNAME>
        <STATICVARIABLES>${withMasters ? "\n          <IMPORTDUPS>@@DUPIGNORE</IMPORTDUPS>" : ""}
          <SVCURRENTCOMPANY>${xmlText(companyName)}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
${messages.join("\n")}
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>
`;
}

export function buildVouchersXml(
  companyName: string,
  models: readonly TallyVoucherModel[],
  resolveAction: TallyActionResolver,
  provisionalNote?: string,
): string {
  // Tally (7.2, tested) IGNORES a voucher ACTION="Alter" under "All Masters" + IMPORTDUPS ignore, so the masters
  // can only ride along when every voucher is new. A file with an amended (Alter) voucher keeps the "Vouchers"
  // request without masters: its ledgers were created by the first export of those vouchers.
  const actions = models.map((m) => resolveAction(m));
  const withMasters = actions.every((a) => a === "Create");
  return buildTallyEnvelope(
    companyName,
    [
      ...(withMasters ? voucherMasters(models).messages().map((m) => `      <TALLYMESSAGE xmlns:UDF="TallyUDF">${m}</TALLYMESSAGE>`) : []),
      ...models.map((m, i) => buildVoucherMessageXml(m, actions[i])),
    ],
    provisionalNote,
    withMasters,
  );
}

/**
 * The ledgers and voucher types the vouchers use, ahead of the vouchers (first exports only, see buildVouchersXml).
 * With "All Masters" + IMPORTDUPS ignore (tested on TallyPrime 7.2) an existing master is left untouched and a
 * missing one - a new client's party ledger - is created, instead of the voucher being rejected with
 * "Ledger ... does not exist".
 */
export function voucherMasters(models: readonly TallyVoucherModel[]): TallyMasters {
  const m = new TallyMasters();
  for (const v of models) {
    m.voucherType(v.voucherType, v.kind === "receipt" ? "Receipt" : v.kind === "credit_note" ? "Credit Note" : "Sales");
    for (const e of v.entries) m.ledger(e.ledgerName, gstLedgerGroup(e), false);
  }
  return m;
}

export function gstLedgerGroup(e: TallyLedgerEntry): TallyGroup {
  if (e.role === "party") return "Sundry Debtors";
  if (e.role === "sales") return "Sales Accounts";
  if (e.role === "round_off") return "Indirect Expenses";
  if (/\btds\b/i.test(e.ledgerName)) return "Loans & Advances (Asset)";
  if (e.role === "tax") return "Duties & Taxes";
  return "Current Liabilities";
}
