import ExcelJS from "exceljs";
import type { Voucher } from "./salary-voucher.service.js";

/**
 * Output formats for the salary voucher: CSV and Excel carry the reference sheet's columns in its
 * exact order (Tally's sheet import maps by position); XML is Tally's own import envelope.
 */

export type ExportFormat = "csv" | "xlsx" | "xml";

export function parseFormat(raw: unknown): ExportFormat {
  const v = String(raw ?? "csv").toLowerCase();
  return v === "xlsx" || v === "xml" ? v : "csv";
}

/** The reference sheet's table. The two split columns are named from the company's cohort setup. */
export function voucherTable(vouchers: Voucher[]): { header: string[]; rows: unknown[][] } {
  // Split columns are per company, and an export spanning two companies with different
  // cohort counts would have a ragged header. The widest wins; narrower rows pad with blanks.
  const splitCount = vouchers.reduce(
    (max, v) => Math.max(max, v.cohort_labels.length > 1 ? v.cohort_labels.length : 0), 0);
  // The reference leaves these two headers blank; they are named here (cohort first, then the
  // remainder — the same order the row values are printed in) so the file is readable. Tally
  // maps by position, so the text does not affect the import.
  const widest = vouchers.reduce<string[]>(
    (best, v) => (v.cohort_labels.length > best.length ? v.cohort_labels : best), []);
  const splitHeaders = [...widest.slice(1), widest[0] ?? ""];

  const header = [
    "Vch No", "Date", "Details", "Amount",
    ...Array.from({ length: splitCount }, (_, i) => splitHeaders[i] ?? ""),
    "DebitCredit", "Cost Category", "Cost Centre",
    "Narration for Each Entry", "Narration", "VchType",
  ];

  const rows: unknown[][] = [];
  for (const voucher of vouchers) {
    for (const line of voucher.lines) {
      // The reference prints the cohort column FIRST and the remainder second, which is the
      // reverse of how they are held internally.
      const split = splitCount
        ? [...line.columns.slice(1), line.columns[0], ...Array.from({ length: Math.max(0, splitCount - line.columns.length) }, () => "")]
        : [];
      rows.push([
        voucher.voucher_no,
        voucher.date,
        line.ledger_name,
        line.amount,
        ...split,
        line.debit_credit,
        voucher.cost_category,
        voucher.cost_centre,
        voucher.narration,
        `${voucher.narration} Vch No:${voucher.voucher_no}`,
        voucher.voucher_type,
      ]);
    }
  }
  return { header, rows };
}

export function buildCsv(vouchers: Voucher[]): string {
  const { header, rows } = voucherTable(vouchers);
  const escape = (value: unknown) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [header, ...rows].map((r) => r.map(escape).join(",")).join("\n");
}

export async function buildXlsx(vouchers: Voucher[]): Promise<Buffer> {
  const { header, rows } = voucherTable(vouchers);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Salary Voucher");
  ws.addRow(header).font = { bold: true };
  const dateCol = header.indexOf("Date") + 1;
  const amountCols = header.map((h, i) => (i === 3 || (i > 3 && h !== "DebitCredit" && i < header.indexOf("DebitCredit")) ? i + 1 : 0)).filter(Boolean);
  for (const row of rows) {
    // A real date (shown dd-mm-yyyy) so Excel sorts and filters it; text cells for the rest so a
    // ledger or cost-centre name starting with = + - @ is never read as a formula.
    const cells = row.map((v, i) => {
      if (i + 1 === dateCol && typeof v === "string") {
        const [y, m, d] = v.slice(0, 10).split("-").map(Number);
        return new Date(Date.UTC(y, m - 1, d));
      }
      return typeof v === "string" && /^[=+\-@]/.test(v) ? `'${v}` : v;
    });
    ws.addRow(cells);
  }
  ws.getColumn(dateCol).numFmt = "dd-mm-yyyy";
  for (const c of amountCols) ws.getColumn(c).numFmt = "#,##0.00";
  ws.columns.forEach((col, i) => { col.width = [0, 1, 2].includes(i) ? 38 : i >= header.length - 5 ? 26 : 16; });
  ws.views = [{ state: "frozen", ySplit: 1 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const xmlEscape = (value: unknown) =>
  String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/**
 * Tally import XML (ENVELOPE > BODY > DATA > TALLYMESSAGE > VOUCHER), same sign convention as the
 * bank-voucher export: a debit is ISDEEMEDPOSITIVE=Yes with a NEGATIVE amount, a credit is
 * ISDEEMEDPOSITIVE=No with a POSITIVE amount. Cohort split columns are not carried — XML has one
 * amount per ledger line. Zero-value lines are skipped, since Tally rejects a zero ledger entry.
 */
export function buildTallyXml(vouchers: Voucher[], company?: string): string {
  const messages = vouchers.map((v) => {
    const date = v.date.slice(0, 10).replace(/-/g, "");
    const entries = v.lines
      .filter((l) => Math.abs(l.amount) > 0)
      .map((l) => {
        const debit = l.debit_credit === "D";
        const amount = (debit ? -Math.abs(l.amount) : Math.abs(l.amount)).toFixed(2);
        return `        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>${xmlEscape(l.ledger_name)}</LEDGERNAME>
          <ISDEEMEDPOSITIVE>${debit ? "Yes" : "No"}</ISDEEMEDPOSITIVE>
          <AMOUNT>${amount}</AMOUNT>
          <CATEGORYALLOCATIONS.LIST>
            <CATEGORY>${xmlEscape(v.cost_category)}</CATEGORY>
            <COSTCENTREALLOCATIONS.LIST>
              <NAME>${xmlEscape(v.cost_centre)}</NAME>
              <AMOUNT>${amount}</AMOUNT>
            </COSTCENTREALLOCATIONS.LIST>
          </CATEGORYALLOCATIONS.LIST>
        </ALLLEDGERENTRIES.LIST>`;
      })
      .join("\n");
    return `      <TALLYMESSAGE xmlns:UDF="TallyUDF">
        <VOUCHER VCHTYPE="${xmlEscape(v.voucher_type)}" ACTION="Create">
          <DATE>${date}</DATE>
          <VOUCHERTYPENAME>${xmlEscape(v.voucher_type)}</VOUCHERTYPENAME>
          <VOUCHERNUMBER>${xmlEscape(v.voucher_no)}</VOUCHERNUMBER>
          <NARRATION>${xmlEscape(`${v.narration} Vch No:${v.voucher_no}`)}</NARRATION>
${entries}
        </VOUCHER>
      </TALLYMESSAGE>`;
  });
  return `<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Import</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>Vouchers</ID>
  </HEADER>
  <BODY>
    ${company ? `<DESC>
      <STATICVARIABLES>
        <SVCURRENTCOMPANY>${xmlEscape(company)}</SVCURRENTCOMPANY>
      </STATICVARIABLES>
    </DESC>` : "<DESC></DESC>"}
    <DATA>
${messages.join("\n")}
    </DATA>
  </BODY>
</ENVELOPE>
`;
}
