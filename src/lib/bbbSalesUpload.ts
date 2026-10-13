/**
 * Bulk Upload Hub helpers for the Blabli Blu Overall Sales upload (BB-02 / BB-03).
 *
 * That upload is validated on the server, row by row, with a stored reason per rejected row. The hub therefore
 * only checks file STRUCTURE for it (the mandatory OrderID and Date columns must exist, any header spelling), and
 * an extra or missing optional column no longer blocks the whole file -- the strict header check is what turned a
 * real September file into a 100% rejection.
 */

export const SERVER_VALIDATED_UPLOAD_CODES: ReadonlySet<string> = new Set(["BLA_BLI_BLU_OVERALL_SALES"]);

/** User-visible spelling. Stored names (process_master, upload_template_master) keep "Bla Bli Blu". */
export function displayUploadTypeName(name: string): string {
  return name.replace(/Bla Bli Blu/gi, "Blabli Blu");
}

/** Letters and digits only: "Order ID", "order_id" and "OrderID" compare equal. */
export const alnumKey = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Re-key a row onto the template's header names when only the spelling differs; other columns are kept. */
export function canonicalizeRowKeys<T extends Record<string, string>>(row: T, templateHeaders: string[]): Record<string, string> {
  const byKey = new Map(templateHeaders.map((h) => [alnumKey(h), h]));
  const out: Record<string, string> = { ...row };
  for (const [k, v] of Object.entries(row)) {
    const canonical = byKey.get(alnumKey(k));
    if (canonical && canonical !== k && !out[canonical]) {
      out[canonical] = v;
      delete out[k];
    }
  }
  return out;
}

/** Mandatory columns the file does not have under any spelling. */
export function missingRequiredHeaders(fileHeaders: string[], required: string[]): string[] {
  const have = new Set(fileHeaders.map(alnumKey));
  return required.filter((r) => !have.has(alnumKey(r)));
}

export interface SalesPreview {
  processConfigured: boolean; totalRows: number; acceptedRows: number; rejectedRows: number; successPct: number;
  duplicateInFile: number; updatedOrders: number; newOrders: number;
  reasons: Array<{ label: string; rows: number; category: string }>;
  dates: Array<{ reportDate: string; existingCount: number; uploadCount: number; updatedCount: number; variance: number }>;
}

const n = (v: number) => v.toLocaleString("en-IN");

/** The pre-import warning: what will be rejected, and which existing orders this import will UPDATE. */
export function describeSalesPreview(p: SalesPreview): string {
  const lines = [
    `Total rows: ${n(p.totalRows)}. Will be accepted: ${n(p.acceptedRows)} (${p.successPct}%). Will be rejected: ${n(p.rejectedRows)}.`,
  ];
  if (!p.processConfigured) lines.push("No active Blabli Blu process is configured, so every row would be rejected (technical error).");
  if (p.reasons.length) lines.push(`Rejection reasons: ${p.reasons.map((r) => `${r.label} ${n(r.rows)}`).join(", ")}.`);
  if (p.duplicateInFile) lines.push(`Duplicate count: ${n(p.duplicateInFile)} row(s) repeat an OrderID already in this file; only the last one is kept.`);
  if (p.updatedOrders) {
    lines.push(`WARNING: ${n(p.updatedOrders)} order(s) already exist and will be UPDATED with this file's values (no duplicates are created; the previous values are kept in the history). ${n(p.newOrders)} new order(s) will be added.`);
    const changed = p.dates.filter((d) => d.updatedCount > 0 || d.variance !== 0).slice(0, 8);
    if (changed.length) lines.push(`By date (existing -> this file, variance): ${changed.map((d) => `${d.reportDate}: ${n(d.existingCount)} -> ${n(d.uploadCount)} (${d.variance > 0 ? "+" : ""}${n(d.variance)})`).join("; ")}.`);
  } else {
    lines.push(`${n(p.newOrders)} new order(s) will be added; no existing order is changed.`);
  }
  lines.push("", "Continue with the import?");
  return lines.join("\n");
}

export interface SalesImportSummary {
  totalRows: number; acceptedRows: number; rejectedRows: number; successPct: number; rejectionPct: number;
  updatedOrders?: number; newOrders?: number; duplicateInFile?: number; technicalRejects?: number; warningRows?: number; months?: string[];
}

/** The upload summary after import: Total / Accepted / Rejected / Success % / Rejection %. */
export function describeSalesImport(batchNo: string, s: SalesImportSummary): string {
  const parts = [
    `Import completed for ${batchNo}.`,
    `Total rows ${n(s.totalRows)} · Accepted ${n(s.acceptedRows)} · Rejected ${n(s.rejectedRows)} · Success ${s.successPct}% · Rejection ${s.rejectionPct}%.`,
  ];
  if (s.updatedOrders !== undefined) parts.push(`${n(s.updatedOrders)} existing order(s) updated, ${n(s.newOrders ?? 0)} added.`);
  if (s.months?.length) parts.push(`Sales months: ${s.months.join(", ")}.`);
  if (s.technicalRejects) parts.push(`${n(s.technicalRejects)} row(s) failed for a technical reason; report these.`);
  if (s.warningRows) parts.push(`${n(s.warningRows)} row(s) imported with a warning.`);
  if (s.rejectedRows) parts.push("Each rejected row's field, value and reason is in View Rows and in the Blabli Blu Sales Dashboard's rejection log.");
  return parts.join(" ");
}
