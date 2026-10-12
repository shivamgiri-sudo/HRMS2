import ExcelJS from "exceljs";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { grnBranchVisibility } from "./grn-branch-split.js";
import type { FinanceBranchScope } from "./finance-access-scope.js";
import {
  ownCompanyGrnSql,
  refreshHiddenGrnScope,
} from "../../shared/ownCompanyCostCentre.js";
import {
  lookupNames,
  readGrnTallyConfig,
  toVoucherInput,
} from "./grn-tally-export.service.js";
import {
  buildGrnVoucher,
  wrapTallyEnvelope,
  type GrnVoucherEntry,
} from "./grn-tally-voucher.js";

/**
 * On-demand download of HRMS GRNs for a Tally import test, as Tally XML, Excel or CSV.
 *
 * Which GRNs: raised in HRMS (bill_source_id IS NULL, so nothing migrated from db_bill), carrying
 * a GRN number (a number exists only from Finance Head approval onwards, so drafts and pending
 * GRNs are out by construction), and not cancelled or consumption-reversed — a spend that was
 * undone is not something to book. Same branch scope and own-company rule as the GRN Register.
 *
 * Read-only, unlike runGrnTallyExport: nothing is written to grn_tally_export, so a test download
 * never stops the automatic connector feed from sending the same GRN later. The XML is built by
 * the same buildGrnVoucher the connector feed uses, so what is tested is what will be sent.
 */

export type GrnTallyDownloadFormat = "xml" | "xlsx" | "csv";

export type GrnTallyDownloadFilters = {
  branchScope: FinanceBranchScope;
  branchId?: string;
  /** Finance month, YYYY-MM (accounting_period). */
  month?: string;
};

const EXCLUDED_STATUSES = ["cancelled", "consumption_reversed"] as const;
const MAX_ROWS = 5000;

export type GrnTallyDownloadRow = {
  grnId: string;
  grnNumber: string;
  grnType: string;
  status: string;
  financeMonth: string;
  billDate: string;
  approvedOn: string;
  invoiceNumber: string;
  vendorName: string;
  vendorGstin: string;
  branchName: string;
  head: string;
  subHead: string;
  description: string;
  gstType: string;
  amountWithoutTax: number;
  taxAmount: number;
  otherCharges: number;
  roundOff: number;
  gross: number;
  alreadySentToTally: boolean;
  voucherType: string | null;
  entries: GrnVoucherEntry[];
  /** Why this GRN is left out of the XML; null when it is in it. */
  exception: string | null;
};

export type GrnTallyDownloadData = {
  rows: GrnTallyDownloadRow[];
  vouchersXml: string[];
  truncated: boolean;
  company: string | null;
};

const ymd = (value: unknown): string => {
  if (!value) return "";
  if (value instanceof Date) {
    const local = new Date(value.getTime() - value.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
};
const num = (value: unknown) => Number(value ?? 0) || 0;

export async function loadGrnTallyDownload(
  filters: GrnTallyDownloadFilters,
): Promise<GrnTallyDownloadData> {
  await refreshHiddenGrnScope();
  const conditions: string[] = [
    ownCompanyGrnSql("g"),
    "g.bill_source_id IS NULL",
    "g.grn_number IS NOT NULL",
    "TRIM(g.grn_number) <> ''",
    `g.status NOT IN (${EXCLUDED_STATUSES.map(() => "?").join(",")})`,
  ];
  const params: unknown[] = [...EXCLUDED_STATUSES];
  const scope = grnBranchVisibility(filters.branchScope, "g");
  if (scope.sql !== "1=1") {
    conditions.push(scope.sql);
    params.push(...scope.params);
  }
  if (filters.branchId) {
    conditions.push("g.branch_id = ?");
    params.push(filters.branchId);
  }
  if (filters.month) {
    conditions.push("g.accounting_period = ?");
    params.push(filters.month);
  }

  // LIMIT is interpolated (a code constant): mysql2 rejects a bound LIMIT in execute().
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT g.id, g.grn_number, g.grn_type, g.status, g.accounting_period, g.bill_date, g.invoice_number,
            g.vendor_id, g.vendor_name, g.vendor_gstin, g.head, g.sub_head, g.description, g.branch_id,
            g.amount, g.amount_without_tax, g.tax_amount, g.other_charges, g.round_off_amount,
            g.amount_with_tax, g.gst_type, g.recoverable_tax_pct,
            COALESCE(g.approved_at, g.finance_head_reviewed_at) AS approved_on,
            (gte.grn_request_id IS NOT NULL) AS already_sent
       FROM grn_request g
       LEFT JOIN grn_tally_export gte ON gte.grn_request_id = g.id
      WHERE ${conditions.join(" AND ")}
      ORDER BY g.accounting_period ASC, g.grn_number ASC
      LIMIT ${MAX_ROWS + 1}`,
    params,
  );
  const truncated = rows.length > MAX_ROWS;
  const picked = rows.slice(0, MAX_ROWS);

  const vendors = await lookupNames(db, "vendor_master", "vendor_name", [
    ...new Set(picked.map((r) => String(r.vendor_id ?? "")).filter(Boolean)),
  ]);
  const branches = await lookupNames(db, "branch_master", "branch_name", [
    ...new Set(picked.map((r) => String(r.branch_id ?? "")).filter(Boolean)),
  ]);
  const config = readGrnTallyConfig();

  const vouchersXml: string[] = [];
  const out: GrnTallyDownloadRow[] = picked.map((r) => {
    const input = toVoucherInput(
      { ...r, bill_date: ymd(r.bill_date) } as RowDataPacket,
      vendors,
      branches,
    );
    const built = buildGrnVoucher(input, config.names);
    if (built.ok) vouchersXml.push(built.xml);
    return {
      grnId: String(r.id),
      grnNumber: String(r.grn_number),
      grnType: String(r.grn_type ?? ""),
      status: String(r.status ?? ""),
      financeMonth: String(r.accounting_period ?? ""),
      billDate: ymd(r.bill_date),
      approvedOn: ymd(r.approved_on),
      invoiceNumber: String(r.invoice_number ?? ""),
      vendorName: input.vendorLedger ?? "",
      vendorGstin: String(r.vendor_gstin ?? ""),
      branchName: input.branchName ?? "",
      head: String(r.head ?? ""),
      subHead: String(r.sub_head ?? ""),
      description: String(r.description ?? ""),
      gstType: String(r.gst_type ?? ""),
      amountWithoutTax: num(r.amount_without_tax),
      taxAmount: num(r.tax_amount),
      otherCharges: num(r.other_charges),
      roundOff: num(r.round_off_amount),
      gross: input.gross,
      alreadySentToTally: Number(r.already_sent) === 1,
      voucherType: built.ok ? built.voucherType : null,
      entries: built.ok ? built.entries : [],
      exception: built.ok ? null : built.reason,
    };
  });

  return { rows: out, vouchersXml, truncated, company: config.company };
}

const GRN_COLUMNS: { header: string; key: keyof GrnTallyDownloadRow; width: number; money?: boolean }[] = [
  { header: "GRN Number", key: "grnNumber", width: 22 },
  { header: "GRN Type", key: "grnType", width: 10 },
  { header: "Status", key: "status", width: 22 },
  { header: "Finance Month", key: "financeMonth", width: 13 },
  { header: "Bill Date", key: "billDate", width: 12 },
  { header: "Approved On", key: "approvedOn", width: 12 },
  { header: "Invoice No.", key: "invoiceNumber", width: 18 },
  { header: "Vendor (Tally ledger)", key: "vendorName", width: 32 },
  { header: "Vendor GSTIN", key: "vendorGstin", width: 18 },
  { header: "Branch", key: "branchName", width: 16 },
  { header: "Exp. Head", key: "head", width: 22 },
  { header: "Exp. SubHead (expense ledger)", key: "subHead", width: 26 },
  { header: "Description", key: "description", width: 36 },
  { header: "GST Type", key: "gstType", width: 10 },
  { header: "Taxable Amount", key: "amountWithoutTax", width: 15, money: true },
  { header: "GST Amount", key: "taxAmount", width: 13, money: true },
  { header: "Other Charges", key: "otherCharges", width: 13, money: true },
  { header: "Round Off", key: "roundOff", width: 11, money: true },
  { header: "Gross Amount", key: "gross", width: 15, money: true },
  { header: "Tally Voucher Type", key: "voucherType", width: 14 },
];

function plain(row: GrnTallyDownloadRow, key: keyof GrnTallyDownloadRow): string | number {
  const v = row[key];
  if (typeof v === "number") return v;
  return v == null ? "" : String(v);
}

const inXml = (r: GrnTallyDownloadRow) => (r.exception ? "No" : "Yes");
const sent = (r: GrnTallyDownloadRow) => (r.alreadySentToTally ? "Yes" : "No");

export function buildGrnTallyXml(data: GrnTallyDownloadData): string {
  return wrapTallyEnvelope(data.vouchersXml, data.company);
}

function csvCell(value: unknown): string {
  let text = String(value ?? "");
  // A leading =, +, - or @ makes Excel evaluate the cell; prefix it so a description cannot run.
  if (/^[=+\-@]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One line per GRN: the voucher header plus the Dr/Cr split, in fixed ledger columns. */
export function buildGrnTallyCsv(data: GrnTallyDownloadData): string {
  const header = [
    ...GRN_COLUMNS.map((c) => c.header),
    "Ledger Lines (ledger:Dr/Cr:amount)",
    "In Tally XML",
    "Not in XML because",
    "Already sent by connector feed",
  ];
  const lines = data.rows.map((r) =>
    [
      ...GRN_COLUMNS.map((c) => plain(r, c.key)),
      r.entries.map((e) => `${e.ledger}:${e.side}:${e.amount.toFixed(2)}`).join(" | "),
      inXml(r),
      r.exception ?? "",
      sent(r),
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.map(csvCell).join(","), ...lines].join("\r\n") + "\r\n";
}

/** Three sheets: GRNs, the voucher ledger lines exactly as the XML carries them, and exceptions. */
export async function buildGrnTallyXlsx(data: GrnTallyDownloadData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "MAS PeopleOS";
  wb.created = new Date();
  const moneyFmt = "#,##0.00";

  const grns = wb.addWorksheet("GRNs");
  grns.columns = [
    ...GRN_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width })),
    { header: "In Tally XML", key: "inXml", width: 12 },
    { header: "Not in XML because", key: "exception", width: 50 },
    { header: "Already sent by connector feed", key: "sent", width: 14 },
  ];
  for (const r of data.rows) {
    const values: Record<string, string | number> = {};
    for (const c of GRN_COLUMNS) values[c.key] = plain(r, c.key);
    values.inXml = inXml(r);
    values.exception = r.exception ?? "";
    values.sent = sent(r);
    grns.addRow(values);
  }
  GRN_COLUMNS.forEach((c, i) => {
    if (c.money) grns.getColumn(i + 1).numFmt = moneyFmt;
  });

  const lines = wb.addWorksheet("Voucher Lines");
  lines.columns = [
    { header: "Voucher No. (GRN)", key: "grn", width: 22 },
    { header: "Voucher Type", key: "type", width: 12 },
    { header: "Voucher Date (bill date)", key: "date", width: 14 },
    { header: "Ledger", key: "ledger", width: 34 },
    { header: "Dr/Cr", key: "side", width: 7 },
    { header: "Debit", key: "debit", width: 14 },
    { header: "Credit", key: "credit", width: 14 },
  ];
  for (const r of data.rows) {
    for (const e of r.entries) {
      lines.addRow({
        grn: r.grnNumber,
        type: r.voucherType ?? "",
        date: r.billDate,
        ledger: e.ledger,
        side: e.side,
        debit: e.side === "Dr" ? e.amount : null,
        credit: e.side === "Cr" ? e.amount : null,
      });
    }
  }
  lines.getColumn("debit").numFmt = moneyFmt;
  lines.getColumn("credit").numFmt = moneyFmt;

  const ex = wb.addWorksheet("Exceptions");
  ex.columns = [
    { header: "GRN Number", key: "grn", width: 22 },
    { header: "Finance Month", key: "month", width: 13 },
    { header: "Gross Amount", key: "gross", width: 15 },
    { header: "Not in XML because", key: "reason", width: 80 },
  ];
  for (const r of data.rows.filter((x) => x.exception)) {
    ex.addRow({ grn: r.grnNumber, month: r.financeMonth, gross: r.gross, reason: r.exception });
  }
  ex.getColumn("gross").numFmt = moneyFmt;

  for (const sheet of [grns, lines, ex]) {
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 1 }];
  }
  if (data.truncated) {
    grns.addRow({});
    grns.addRow({ grnNumber: `Only the first ${MAX_ROWS} GRNs are included. Pick a finance month to get the rest.` });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function grnTallyDownloadSummary(data: GrnTallyDownloadData) {
  const inXmlRows = data.rows.filter((r) => !r.exception);
  return {
    grns: data.rows.length,
    inXml: inXmlRows.length,
    exceptions: data.rows.length - inXmlRows.length,
    alreadySentToTally: data.rows.filter((r) => r.alreadySentToTally).length,
    grossInXml: Math.round(inXmlRows.reduce((s, r) => s + r.gross, 0) * 100) / 100,
    truncated: data.truncated,
    maxRows: MAX_ROWS,
  };
}
