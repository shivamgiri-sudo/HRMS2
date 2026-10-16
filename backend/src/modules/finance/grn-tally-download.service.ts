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
  duplicateReason,
  legacyDuplicate,
  loadLegacyBills,
} from "./grn-tally-legacy-dup.js";
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
 * a GRN number and in a fully approved status (VENDOR_BOOKED / IMPREST_BOOKED): drafts, pending, returned,
 * rejected, cancelled and consumption-reversed GRNs are not something to book. Same branch scope and own-company rule as the GRN Register.
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
  /** Vendor GRNs only by default, as the legacy import; imprest GRNs go as JRNLIMP vouchers. */
  grnType?: "vendor" | "imprest" | "all";
  /** Posting month, YYYY-MM: the month the GRN was approved in. */
  month?: string;
};

const APPROVED_ON = "COALESCE(g.approved_at, g.finance_head_reviewed_at)";
/**
 * Only GRNs that have cleared final approval. A number alone is not enough: a GRN returned for correction
 * or reopened keeps the number it was given, but is not an approved spend again until it clears approval.
 * Same sets as the connector feed (grn-tally-export.service.ts), plus payment_scheduled (approved, awaiting payment).
 */
const VENDOR_BOOKED = ["finance_head_approved", "pending_accounts_payment", "payment_scheduled", "partially_paid", "paid"] as const;
const IMPREST_BOOKED = ["approved", "paid"] as const;
const MAX_ROWS = 5000;

export type GrnTallyDownloadRow = {
  grnId: string;
  grnNumber: string;
  /** The Tally XML voucher for this GRN; null when it did not build. */
  voucherXml: string | null;
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
  /** GST on the bill that is not claimed as input credit (recoverable below 100%) — for Accounts to check. */
  gstNote: string;
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
    `((g.grn_type = 'imprest' AND g.status IN (${IMPREST_BOOKED.map(() => "?").join(",")}))`
      + ` OR (g.grn_type <> 'imprest' AND g.status IN (${VENDOR_BOOKED.map(() => "?").join(",")})))`,
  ];
  const params: unknown[] = [...IMPREST_BOOKED, ...VENDOR_BOOKED];
  const scope = grnBranchVisibility(filters.branchScope, "g");
  if (scope.sql !== "1=1") {
    conditions.push(scope.sql);
    params.push(...scope.params);
  }
  const grnType = filters.grnType ?? "vendor";
  if (grnType !== "all") {
    conditions.push("g.grn_type = ?");
    params.push(grnType);
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
  const legacyBills = await loadLegacyBills(db, picked);

  const vouchersXml: string[] = [];
  const out: GrnTallyDownloadRow[] = picked.map((r) => {
    const input = toVoucherInput(
      { ...r, bill_date: ymd(r.bill_date) } as RowDataPacket,
      context,
      config.names,
    );
    const duplicate = input.grnType === "vendor" ? legacyDuplicate(legacyBills, r, input.gross) : null;
    const voucher = buildGrnVoucher(input, config.names);
    const built = duplicate
      ? ({ ok: false, grnId: input.grnId, grnNumber: input.grnNumber, reason: duplicateReason(duplicate) } as const)
      : voucher;
    if (built.ok) vouchersXml.push(built.xml);
    const recoverable = r.recoverable_tax_pct == null ? 100 : Number(r.recoverable_tax_pct);
    const gstNote =
      num(r.tax_amount) > 0 && recoverable < 100 && String(r.vendor_gstin ?? "").trim()
        ? `GST ${num(r.tax_amount).toFixed(2)} on a GST-registered vendor is not claimed (recoverable ${recoverable}%); legacy claimed it — check`
        : "";
    return {
      grnId: String(r.id),
      grnNumber: String(r.grn_number),
      voucherXml: built.ok ? built.xml : null,
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
      gstNote,
    };
  });

  return { rows: out, vouchersXml, truncated, company: config.company };
}

/** The legacy GRN import sheet's columns, spelled and ordered exactly as in the MASSEP file. */
export const GRN_IMPORT_COLUMNS = [
  "Vch No", "Date", "Effective Date", "Details", "Debit Amount", "Credit Amount",
  "Cost Category", "Cost Centre", "Narration for Each Entry", "Narration", "VchType",
] as const;

/** The legacy imprest import sheet's columns (MASAUGIMP.xlsx): one Amount column and a D/C flag, no Effective Date. */
export const IMPREST_IMPORT_COLUMNS = [
  "Vch No", "Date", "Details", "Amount", "DebitCredit",
  "Cost Category", "Cost Centre", "Narration for Each Entry", "Narration", "VchType",
] as const;

export type GrnImportKind = "vendor" | "imprest";
const isImprest = (r: GrnTallyDownloadRow) => r.grnType === "imprest";

/**
 * One row per ledger line of every GRN that built cleanly. Dates stay YYYY-MM-DD here.
 * vendor  -> MASSEP.xlsx layout (Debit Amount / Credit Amount columns)
 * imprest -> MASAUGIMP.xlsx layout (Amount + D/C)
 * Without `kind`, vendor GRNs only (the original sheet).
 */
export function grnImportRows(data: GrnTallyDownloadData, kind: GrnImportKind = "vendor"): (string | number | null)[][] {
  const out: (string | number | null)[][] = [];
  for (const r of data.rows) {
    if (r.exception || !r.header || isImprest(r) !== (kind === "imprest")) continue;
    const h = r.header;
    for (const e of r.entries) {
      out.push(kind === "imprest"
        ? [h.voucherNumber, h.date, e.ledger, e.amount, e.side === "Dr" ? "D" : "C", h.costCategory, h.costCentre, h.narrationEntry, h.narration, h.voucherType]
        : [
          h.voucherNumber, h.date, h.effectiveDate, e.ledger,
          e.side === "Dr" ? e.amount : null, e.side === "Cr" ? e.amount : null,
          h.costCategory, h.costCentre, h.narrationEntry, h.narration, h.voucherType,
        ]);
    }
  }
  return out;
}

/** Columns holding a date, by layout. */
const dateColumns = (kind: GrnImportKind) => (kind === "imprest" ? new Set([1]) : new Set([1, 2]));

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

const hasKind = (data: GrnTallyDownloadData, kind: GrnImportKind) =>
  data.rows.some((r) => !r.exception && r.header && isImprest(r) === (kind === "imprest"));
/** One layout per file, as the legacy sheets: imprest only when there are imprest GRNs and no vendor ones. */
const csvKind = (data: GrnTallyDownloadData): GrnImportKind =>
  !hasKind(data, "vendor") && hasKind(data, "imprest") ? "imprest" : "vendor";
const columnsOf = (kind: GrnImportKind) => (kind === "imprest" ? IMPREST_IMPORT_COLUMNS : GRN_IMPORT_COLUMNS);

export function buildGrnTallyCsv(data: GrnTallyDownloadData, kind: GrnImportKind = csvKind(data)): string {
  const dates = dateColumns(kind);
  const lines = grnImportRows(data, kind).map((row) =>
    row.map((v, i) => csvCell(dates.has(i) ? dmy(String(v)) : v)).join(","),
  );
  return [columnsOf(kind).map(csvCell).join(","), ...lines].join("\r\n") + "\r\n";
}

function addImportSheet(wb: ExcelJS.Workbook, data: GrnTallyDownloadData, kind: GrnImportKind, name: string) {
  const ws = wb.addWorksheet(name);
  const dates = dateColumns(kind);
  ws.addRow([...columnsOf(kind)]).font = { bold: true };
  for (const row of grnImportRows(data, kind)) {
    ws.addRow(
      row.map((v, i) => {
        if (dates.has(i)) {
          const [y, m, d] = String(v).split("-").map(Number);
          return new Date(Date.UTC(y, m - 1, d));
        }
        return typeof v === "string" && /^[=+\-@]/.test(v) ? `'${v}` : v;
      }),
    );
  }
  dates.forEach((i) => (ws.getColumn(i + 1).numFmt = "d-mmm-yy"));
  const widths = kind === "imprest" ? [28, 11, 36, 12, 11, 26, 28, 40, 40, 10] : [34, 11, 11, 40, 14, 14, 22, 16, 40, 70, 8];
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

/**
 * The import sheet(s): legacy columns, real dates, numbers as numbers, one worksheet per layout.
 * Vendor GRNs -> "Import" (MASSEP layout); imprest GRNs -> "Imprest Import" (MASAUGIMP layout), or "Import" when
 * the file is imprest only, so a single-kind file is exactly the legacy file.
 */
export async function buildGrnTallyXlsx(data: GrnTallyDownloadData, only?: GrnImportKind): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "MAS PeopleOS";
  wb.created = new Date();
  const kinds: GrnImportKind[] = only ? [only] : (["vendor", "imprest"] as GrnImportKind[]).filter((k) => hasKind(data, k));
  if (!kinds.length) kinds.push("vendor");
  kinds.forEach((k) => addImportSheet(wb, data, k, kinds.length === 1 || k === "vendor" ? "Import" : "Imprest Import"));
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
  { header: "GST note", key: "gstNote", width: 50 },
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
