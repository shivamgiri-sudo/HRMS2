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
  hrmsRaisedGrnSql,
  readGrnTallyConfig,
} from "./grn-tally-export.service.js";
import {
  GRN_TALLY_COLUMNS,
  loadGrnTallyContext,
  toVoucherInput,
} from "./grn-tally-context.js";
import {
  buildGrnVoucher,
  monthEnd,
  wrapTallyEnvelope,
  type GrnVoucherEntry,
  type GrnVoucherHeader,
} from "./grn-tally-voucher.js";

/**
 * On-demand download of HRMS GRNs for a Tally import test, as Tally XML, Excel or CSV.
 *
 * Which GRNs: raised in HRMS (no bill_source_id and not created by the db_bill migration user, so nothing migrated from db_bill), carrying
 * a GRN number (a number exists only from Finance Head approval onwards, so drafts and pending
 * GRNs are out by construction), and not cancelled or consumption-reversed — a spend that was
 * undone is not something to book. Same branch scope and own-company rule as the GRN Register.
 *
 * Excel and CSV are the legacy billing system's GRN import sheet, column for column (Vch No, Date,
 * Effective Date, Details, Debit Amount, Credit Amount, Cost Category, Cost Centre, Narration for
 * Each Entry, Narration, VchType), one row per ledger line, only GRNs that build cleanly. The
 * "check" workbook is for Accounts: every GRN, its TDS basis, and why any was left out.
 *
 * The month is the POSTING month (the month the GRN was approved in), as in the legacy import:
 * a September file carries every GRN approved in September, dated 30-Sep, whatever month its
 * cost centre points at.
 *
 * Read-only, unlike runGrnTallyExport: nothing is written to grn_tally_export, so a test download
 * never stops the automatic connector feed from sending the same GRN later. The XML is built by
 * the same buildGrnVoucher the connector feed uses, so what is tested is what will be sent.
 */

export type GrnTallyDownloadFormat = "xml" | "xlsx" | "csv" | "check";

export type GrnTallyDownloadFilters = {
  branchScope: FinanceBranchScope;
  branchId?: string;
  /** Posting month, YYYY-MM: the month the GRN was approved in. */
  month?: string;
};

const APPROVED_ON = "COALESCE(g.approved_at, g.finance_head_reviewed_at)";
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
  tdsAmount: number;
  tdsBasis: string;
  alreadySentToTally: boolean;
  voucherType: string | null;
  header: GrnVoucherHeader | null;
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
    hrmsRaisedGrnSql("g"),
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
    conditions.push(`${APPROVED_ON} >= ? AND ${APPROVED_ON} < DATE_ADD(?, INTERVAL 1 DAY)`);
    params.push(`${filters.month}-01`, monthEnd(`${filters.month}-01`));
  }

  // LIMIT is interpolated (a code constant): mysql2 rejects a bound LIMIT in execute().
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT ${GRN_TALLY_COLUMNS}, g.status, g.vendor_gstin,
            ${APPROVED_ON} AS approved_on,
            (gte.grn_request_id IS NOT NULL) AS already_sent
       FROM grn_request g
       LEFT JOIN grn_tally_export gte ON gte.grn_request_id = g.id
      WHERE ${conditions.join(" AND ")}
      ORDER BY approved_on ASC, g.grn_number ASC
      LIMIT ${MAX_ROWS + 1}`,
    params,
  );
  const truncated = rows.length > MAX_ROWS;
  const picked = rows.slice(0, MAX_ROWS);

  const config = readGrnTallyConfig();
  const context = await loadGrnTallyContext(db, picked);

  const vouchersXml: string[] = [];
  const out: GrnTallyDownloadRow[] = picked.map((r) => {
    const input = toVoucherInput(
      { ...r, bill_date: ymd(r.bill_date) } as RowDataPacket,
      context,
      config.names,
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
      tdsAmount: built.ok ? built.tdsAmount : 0,
      tdsBasis: input.tdsBasis,
      alreadySentToTally: Number(r.already_sent) === 1,
      voucherType: built.ok ? built.voucherType : null,
      header: built.ok ? built.header : null,
      entries: built.ok ? built.entries : [],
      exception: built.ok ? null : built.reason,
    };
  });

  return { rows: out, vouchersXml, truncated, company: config.company };
}

/** The legacy GRN import sheet's columns, spelled and ordered exactly as in the MASSEP file. */
export const GRN_IMPORT_COLUMNS = [
  "Vch No", "Date", "Effective Date", "Details", "Debit Amount", "Credit Amount",
  "Cost Category", "Cost Centre", "Narration for Each Entry", "Narration", "VchType",
] as const;

/** One row per ledger line of every GRN that built cleanly. Dates stay YYYY-MM-DD here. */
export function grnImportRows(data: GrnTallyDownloadData): (string | number)[][] {
  const out: (string | number)[][] = [];
  for (const r of data.rows) {
    if (r.exception || !r.header) continue;
    const h = r.header;
    for (const e of r.entries) {
      out.push([
        h.voucherNumber, h.date, h.effectiveDate, e.ledger,
        e.side === "Dr" ? e.amount : "", e.side === "Cr" ? e.amount : "",
        h.costCategory, h.costCentre, h.narrationEntry, h.narration, h.voucherType,
      ]);
    }
  }
  return out;
}

const DATE_COLUMNS = new Set([1, 2]);
const MONEY_COLUMNS = new Set([4, 5]);

export function buildGrnTallyXml(data: GrnTallyDownloadData): string {
  return wrapTallyEnvelope(data.vouchersXml, data.company);
}

/** Excel opens a CSV date as text unless it looks like one; dd-mm-yyyy is what the legacy sheet shows. */
const dmy = (d: string) => `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;

function csvCell(value: unknown): string {
  let text = String(value ?? "");
  // A leading =, +, - or @ makes Excel evaluate the cell; prefix it so a description cannot run.
  if (/^[=+\-@]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildGrnTallyCsv(data: GrnTallyDownloadData): string {
  const lines = grnImportRows(data).map((row) =>
    row.map((v, i) => csvCell(DATE_COLUMNS.has(i) ? dmy(String(v)) : v)).join(","),
  );
  return [GRN_IMPORT_COLUMNS.map(csvCell).join(","), ...lines].join("\r\n") + "\r\n";
}

/** The import sheet: one worksheet, legacy columns, real dates, numbers as numbers. */
export async function buildGrnTallyXlsx(data: GrnTallyDownloadData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "MAS PeopleOS";
  wb.created = new Date();
  const ws = wb.addWorksheet("Import");
  ws.addRow([...GRN_IMPORT_COLUMNS]).font = { bold: true };
  for (const row of grnImportRows(data)) {
    ws.addRow(
      row.map((v, i) => {
        if (DATE_COLUMNS.has(i)) {
          const [y, m, d] = String(v).split("-").map(Number);
          return new Date(Date.UTC(y, m - 1, d));
        }
        return typeof v === "string" && /^[=+\-@]/.test(v) ? `'${v}` : v;
      }),
    );
  }
  DATE_COLUMNS.forEach((i) => (ws.getColumn(i + 1).numFmt = "dd-mmm-yy"));
  MONEY_COLUMNS.forEach((i) => (ws.getColumn(i + 1).numFmt = "0.00"));
  const widths = [34, 11, 11, 40, 14, 14, 22, 16, 40, 70, 8];
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.views = [{ state: "frozen", ySplit: 1 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const CHECK_COLUMNS: { header: string; key: keyof GrnTallyDownloadRow; width: number; money?: boolean }[] = [
  { header: "GRN Number", key: "grnNumber", width: 18 },
  { header: "GRN Type", key: "grnType", width: 10 },
  { header: "Status", key: "status", width: 22 },
  { header: "Accounting Month", key: "financeMonth", width: 13 },
  { header: "Approved On", key: "approvedOn", width: 12 },
  { header: "Bill Date", key: "billDate", width: 12 },
  { header: "Bill No.", key: "invoiceNumber", width: 18 },
  { header: "Party (Tally ledger)", key: "vendorName", width: 32 },
  { header: "Vendor GSTIN", key: "vendorGstin", width: 18 },
  { header: "Branch", key: "branchName", width: 16 },
  { header: "Exp. Head", key: "head", width: 22 },
  { header: "Exp. SubHead (expense ledger)", key: "subHead", width: 26 },
  { header: "GST Type", key: "gstType", width: 10 },
  { header: "Taxable Amount", key: "amountWithoutTax", width: 15, money: true },
  { header: "GST Amount", key: "taxAmount", width: 13, money: true },
  { header: "Round Off", key: "roundOff", width: 11, money: true },
  { header: "Gross Amount", key: "gross", width: 15, money: true },
  { header: "TDS", key: "tdsAmount", width: 12, money: true },
  { header: "TDS basis", key: "tdsBasis", width: 44 },
];

/** For Accounts, not for Tally: every GRN, TDS basis, exceptions. */
export async function buildGrnTallyCheckXlsx(data: GrnTallyDownloadData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "MAS PeopleOS";
  wb.created = new Date();
  const ws = wb.addWorksheet("GRNs");
  ws.columns = [
    { header: "Vch No", key: "vch", width: 32 },
    ...CHECK_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width })),
    { header: "In Tally import", key: "inXml", width: 12 },
    { header: "Left out because", key: "exception", width: 60 },
    { header: "Already sent by connector feed", key: "sent", width: 14 },
  ];
  for (const r of data.rows) {
    const values: Record<string, string | number> = { vch: r.header?.voucherNumber ?? "" };
    for (const c of CHECK_COLUMNS) {
      const v = r[c.key];
      values[c.key] = typeof v === "number" ? v : v == null ? "" : String(v);
    }
    values.inXml = r.exception ? "No" : "Yes";
    values.exception = r.exception ?? "";
    values.sent = r.alreadySentToTally ? "Yes" : "No";
    ws.addRow(values);
  }
  CHECK_COLUMNS.forEach((c, i) => {
    if (c.money) ws.getColumn(i + 2).numFmt = "#,##0.00";
  });
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  if (data.truncated) {
    ws.addRow({});
    ws.addRow({ vch: `Only the first ${MAX_ROWS} GRNs are included. Pick a month to get the rest.` });
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
    tdsInXml: Math.round(inXmlRows.reduce((s, r) => s + r.tdsAmount, 0) * 100) / 100,
    truncated: data.truncated,
    maxRows: MAX_ROWS,
  };
}
