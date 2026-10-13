import { canonicalizeRow, parseDurationSeconds, parseFlexibleDate, parseFlexibleDateTime } from "./dalmia-import-helpers.js";

/**
 * Row validation for the Blabli Blu Overall Sales upload (BB-02 / BB-04). Pure: no database, so every rule is unit
 * tested. Every problem becomes a structured reject -- row, field, uploaded value, reason code, readable reason,
 * required format and category -- never a generic "Fail" and never a value silently stored as blank.
 *
 *   severity "reject":  the row is not imported (OrderID / Date / Amount unusable, or a repeated OrderID).
 *   severity "warning": the row IS imported; a secondary column could not be read and is stored blank, and the
 *                       warning says so. Rejecting a real sale over a helper column ("Countifs of calls") is what
 *                       turned whole files into 100% rejections, so those only warn.
 */

export const BLA_BLI_BLU_OVERALL_SALES_HEADERS = [
  "Week", "Date", "EMP ID", "Emp_Name", "Customer Number", "Payment Status",
  "Amount", "OrderID", "Campaign", "Calling Status", "Discount Code", "Count",
  "Current Status", "Lineitem sku", "New sold line item", "Created By",
  "Order Creation time", "Call Date & Time", "Call Duration",
  "Countifs of calls", "Lead_Line_Item", "Source", "Business",
  "New sold line item Categoty", "Alternate number", "Recording Link",
] as const;

export type RejectCode =
  | "MISSING_FIELD" | "INVALID_DATE" | "INVALID_DATETIME" | "INVALID_NUMBER" | "INVALID_DURATION"
  | "DUPLICATE_KEY" | "PROCESS_NOT_FOUND" | "DB_ERROR";
export type RejectCategory = "business" | "technical";
export type RejectSeverity = "reject" | "warning";

export interface SalesReject {
  row: number;
  field: string;
  value: string | null;
  code: RejectCode;
  reason: string;
  requiredFormat: string | null;
  category: RejectCategory;
  severity: RejectSeverity;
}

/** Short label per reason code, used to group the reject-reason chart ("Invalid Date 20, Missing field 5"). */
export const REJECT_LABELS: Record<RejectCode, string> = {
  MISSING_FIELD: "Missing mandatory field",
  INVALID_DATE: "Invalid date",
  INVALID_DATETIME: "Invalid date & time",
  INVALID_NUMBER: "Invalid number",
  INVALID_DURATION: "Invalid call duration",
  DUPLICATE_KEY: "Duplicate Order ID in file",
  PROCESS_NOT_FOUND: "Process not configured",
  DB_ERROR: "Database / system error",
};

export const DATE_FORMAT = "A date: DD-MM-YYYY, DD-MM-YY, YYYY-MM-DD, D-Mon-YY (01-Sep-26) or an Excel date cell";
export const DATETIME_FORMAT = "A date and time: DD-MM-YYYY HH:MM(:SS), YYYY-MM-DD HH:MM:SS or an Excel date-time cell";
export const NUMBER_FORMAT = "A number; ₹ / Rs / INR, commas and spaces are allowed (₹1,234.50)";
export const DURATION_FORMAT = "H:MM:SS (0:07:12) or an Excel time cell";

const TECHNICAL: ReadonlySet<RejectCode> = new Set(["PROCESS_NOT_FOUND", "DB_ERROR"]);
export const categoryOf = (code: RejectCode): RejectCategory => (TECHNICAL.has(code) ? "technical" : "business");

/** Placeholders a sheet uses for "nothing here"; read as blank, not as bad data. */
const BLANKISH = new Set(["", "-", "--", "na", "n/a", "nil", "null", "none"]);
export function isBlankish(raw: unknown): boolean {
  if (raw === null || raw === undefined) return true;
  return BLANKISH.has(String(raw).trim().toLowerCase());
}

const show = (raw: unknown): string | null => (raw === null || raw === undefined ? null : String(raw).slice(0, 255));

/**
 * Number stored as text -> number. Accepts "₹1,234.50", "Rs. 1,234", "INR 1234", "1 234", "1,234/-" and real
 * numbers. Blank -> { ok: true, value: null }. Anything else -> { ok: false } (the caller reports it).
 */
export function parseSalesNumber(raw: unknown): { ok: true; value: number | null } | { ok: false } {
  if (typeof raw === "number") return Number.isFinite(raw) ? { ok: true, value: raw } : { ok: false };
  if (isBlankish(raw)) return { ok: true, value: null };
  const cleaned = String(raw)
    .trim()
    .replace(/^(₹|rs\.?|inr)\s*/i, "")
    .replace(/\/-$/, "")
    .replace(/[,\s ]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return { ok: false };
  const n = Number(cleaned);
  return Number.isFinite(n) ? { ok: true, value: n } : { ok: false };
}

/** Plain integer Excel serial or date text -> "YYYY-MM-DD". */
export function parseDate(raw: unknown): string | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(raw) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const v = String(raw ?? "").trim();
  if (!v) return null;
  if (/^\d+(\.\d+)?$/.test(v)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(Number(v)) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return m[0];
  // The Hub reads CSV/Excel as displayed text ("01-09-26"), not serials.
  return parseFlexibleDate(v);
}

/** FRACTIONAL Excel serial (date + time-of-day) or date-time text -> "YYYY-MM-DD HH:MM:SS". */
export function parseDateTime(raw: unknown): string | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    const days = Math.floor(raw);
    const secondsOfDay = Math.round((raw - days) * 86400);
    const d = new Date(Date.UTC(1899, 11, 30) + days * 86400000 + secondsOfDay * 1000);
    return d.toISOString().slice(0, 19).replace("T", " ");
  }
  const v = String(raw ?? "").trim();
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(v);
  if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`;
  return parseFlexibleDateTime(v);
}

/** "Call Duration" is a fraction of a day (0.006018 = 520 s) or "0:07:12" text. */
export function parseCallDurationSeconds(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) return Math.round(raw * 86400);
  const v = String(raw ?? "").trim();
  if (!v) return null;
  if (v.includes(":")) return parseDurationSeconds(v);
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 86400) : null;
}

export function cleanText(raw: unknown): string | null {
  const v = String(raw ?? "").trim();
  return v || null;
}

/** One validated sales row, in the column order of bla_bli_blu_overall_sales_raw's upload columns. */
export interface SalesRecord {
  orderId: string; reportDate: string; week: string | null; empCode: string | null; empName: string | null;
  customerNumber: string | null; alternateNumber: string | null; paymentStatus: string | null; amount: number | null;
  campaign: string | null; callingStatus: string | null; discountCode: string | null; itemCount: number | null;
  currentStatus: string | null; lineitemSku: string | null; newSoldLineItem: string | null; newSoldCategory: string | null;
  leadLineItem: string | null; source: string | null; business: string | null; orderCreationTime: string | null;
  callDateTime: string | null; callDurationSeconds: number | null; callAttemptCount: number | null;
  createdBy: string | null; recordingLink: string | null;
}

export interface RowValidation { record: SalesRecord | null; issues: SalesReject[] }

function issue(row: number, field: string, raw: unknown, code: RejectCode, reason: string, requiredFormat: string | null, severity: RejectSeverity): SalesReject {
  return { row, field, value: show(raw), code, reason, requiredFormat, category: categoryOf(code), severity };
}

/** Validate one staged row (any header spelling: "Order ID", "order id" and "OrderID" all match). */
export function validateSalesRow(input: Record<string, unknown>, row: number): RowValidation {
  const data = canonicalizeRow(input, BLA_BLI_BLU_OVERALL_SALES_HEADERS);
  const issues: SalesReject[] = [];
  const reject = (field: string, code: RejectCode, reason: string, fmt: string | null) => issues.push(issue(row, field, data[field], code, reason, fmt, "reject"));
  const warn = (field: string, code: RejectCode, reason: string, fmt: string | null) => issues.push(issue(row, field, data[field], code, reason, fmt, "warning"));

  const orderId = isBlankish(data["OrderID"]) ? null : cleanText(data["OrderID"]);
  if (!orderId) reject("OrderID", "MISSING_FIELD", "OrderID is blank. It identifies the sale, so the row cannot be stored.", "Non-blank order reference, e.g. #BBB2484825");

  const reportDate = isBlankish(data["Date"]) ? null : parseDate(data["Date"]);
  if (isBlankish(data["Date"])) reject("Date", "MISSING_FIELD", "Date is blank. The sales month and day come from this column.", DATE_FORMAT);
  else if (!reportDate) reject("Date", "INVALID_DATE", `"${String(data["Date"]).trim()}" is not a recognised date.`, DATE_FORMAT);

  const amount = parseSalesNumber(data["Amount"]);
  if (!amount.ok) reject("Amount", "INVALID_NUMBER", `"${String(data["Amount"]).trim()}" is not a number, so revenue cannot be counted.`, NUMBER_FORMAT);

  const num = (field: string) => {
    const p = parseSalesNumber(data[field]);
    if (p.ok) return p.value;
    warn(field, "INVALID_NUMBER", `"${String(data[field]).trim()}" is not a number; stored blank, the row was still imported.`, NUMBER_FORMAT);
    return null;
  };
  const dt = (field: string) => {
    if (isBlankish(data[field])) return null;
    const v = parseDateTime(data[field]);
    if (!v) warn(field, "INVALID_DATETIME", `"${String(data[field]).trim()}" is not a recognised date and time; stored blank, the row was still imported.`, DATETIME_FORMAT);
    return v;
  };
  const itemCount = num("Count");
  const attempts = num("Countifs of calls");
  const orderCreationTime = dt("Order Creation time");
  const callDateTime = dt("Call Date & Time");
  let callDurationSeconds: number | null = null;
  if (!isBlankish(data["Call Duration"])) {
    callDurationSeconds = parseCallDurationSeconds(data["Call Duration"]);
    if (callDurationSeconds === null) warn("Call Duration", "INVALID_DURATION", `"${String(data["Call Duration"]).trim()}" is not a duration; stored blank, the row was still imported.`, DURATION_FORMAT);
  }
  // A sale with no Campaign or Business is stored but cannot appear in the campaign-wise sales figures: say so.
  for (const field of ["Campaign", "Business"] as const) {
    if (isBlankish(data[field])) warn(field, "MISSING_FIELD", `${field} is blank; the order is stored but is not counted in the campaign-wise sales figures.`, `The ${field} value from the sales sheet`);
  }

  if (issues.some((i) => i.severity === "reject") || !orderId || !reportDate) return { record: null, issues };
  const t = (f: string) => (isBlankish(data[f]) ? null : cleanText(data[f]));
  return {
    issues,
    record: {
      orderId, reportDate, week: t("Week"), empCode: t("EMP ID"), empName: t("Emp_Name"), customerNumber: t("Customer Number"),
      alternateNumber: t("Alternate number"), paymentStatus: t("Payment Status"), amount: amount.ok ? amount.value : null,
      campaign: t("Campaign"), callingStatus: t("Calling Status"), discountCode: t("Discount Code"), itemCount: itemCount,
      currentStatus: t("Current Status"), lineitemSku: t("Lineitem sku"), newSoldLineItem: t("New sold line item"),
      newSoldCategory: t("New sold line item Categoty"), leadLineItem: t("Lead_Line_Item"), source: t("Source"),
      business: t("Business"), orderCreationTime, callDateTime, callDurationSeconds,
      callAttemptCount: attempts === null ? null : Math.round(attempts), createdBy: t("Created By"), recordingLink: t("Recording Link"),
    },
  };
}

/**
 * The same OrderID twice in one file: the LAST row wins (it carries the latest status, the same rule the upsert
 * applies across files) and every earlier row is rejected as a duplicate, so it is never counted twice.
 * Returns the rejects for the superseded rows; `rows` must be in file order.
 */
export function rejectInFileDuplicates(rows: Array<{ row: number; orderId: string }>): SalesReject[] {
  const lastRow = new Map<string, number>();
  for (const r of rows) lastRow.set(r.orderId, r.row);
  return rows
    .filter((r) => lastRow.get(r.orderId) !== r.row)
    .map((r) => ({
      row: r.row, field: "OrderID", value: r.orderId, code: "DUPLICATE_KEY" as const,
      reason: `OrderID ${r.orderId} appears again at row ${lastRow.get(r.orderId)}; that later row was kept and this one was not imported.`,
      requiredFormat: "Each OrderID once per file", category: "business" as const, severity: "reject" as const,
    }));
}

/** The sentence kept in upload_batch_row.error_messages for the Bulk Upload Hub's row view. */
export function rejectMessage(r: SalesReject): string {
  const head = `${r.severity === "warning" ? "Warning" : "Rejected"} [${r.code}, ${r.category}] ${r.field}: ${r.reason}`;
  return r.requiredFormat ? `${head} Required: ${r.requiredFormat}.` : head;
}

/** Upload Success % = Accepted / Total x 100; Rejection % = Rejected / Total x 100 (KPI sheet, BB-02). */
export function uploadSummary(totalRows: number, acceptedRows: number, rejectedRows: number) {
  const pct = (n: number) => (totalRows > 0 ? Math.round((n / totalRows) * 10000) / 100 : 0);
  return { totalRows, acceptedRows, rejectedRows, successPct: pct(acceptedRows), rejectionPct: pct(rejectedRows) };
}

/** Reject Reason Count = rejected rows grouped by normalised reason (one count per row and code). */
export function groupRejectsByReason(rejects: SalesReject[]): Array<{ code: RejectCode; label: string; category: RejectCategory; rows: number }> {
  const seen = new Map<RejectCode, Set<number>>();
  for (const r of rejects) {
    if (r.severity !== "reject") continue;
    if (!seen.has(r.code)) seen.set(r.code, new Set());
    seen.get(r.code)!.add(r.row);
  }
  return [...seen.entries()]
    .map(([code, rows]) => ({ code, label: REJECT_LABELS[code], category: categoryOf(code), rows: rows.size }))
    .sort((a, b) => b.rows - a.rows || a.code.localeCompare(b.code));
}

export interface DateCorrection {
  reportDate: string;
  /** Orders the dashboard had for this date before the import. */
  existingCount: number;
  /** Accepted orders the file carries for this date. */
  uploadCount: number;
  /** Of those, how many replace an order that already existed (anywhere), i.e. updated, not added. */
  updatedCount: number;
  insertedCount: number;
  /** Variance = New Correct Count - Existing Dashboard Count (BB-03). */
  variance: number;
}

/**
 * Per sales date: what the dashboard had, what the file brings, and how much of it updates existing orders
 * (OrderID is the business key, so a re-imported 1-3 Aug file updates instead of duplicating).
 */
export function planDateCorrections(
  records: Array<{ orderId: string; reportDate: string }>,
  existingByDate: Map<string, number>,
  existingOrderIds: Set<string>,
): DateCorrection[] {
  const byDate = new Map<string, { upload: number; updated: number }>();
  for (const r of records) {
    const d = byDate.get(r.reportDate) ?? { upload: 0, updated: 0 };
    d.upload += 1;
    if (existingOrderIds.has(r.orderId)) d.updated += 1;
    byDate.set(r.reportDate, d);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([reportDate, d]) => {
      const existingCount = existingByDate.get(reportDate) ?? 0;
      return {
        reportDate, existingCount, uploadCount: d.upload, updatedCount: d.updated,
        insertedCount: d.upload - d.updated, variance: d.upload - existingCount,
      };
    });
}
