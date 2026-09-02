/**
 * Thin wrapper functions over `hrmsApi` for the GST export backend
 * (backend/src/modules/gst/gst-export.routes.ts, mounted at /api/gst).
 *
 * Row shapes are read straight off gst-export.service.ts's own queries, not guessed:
 *   - GstExportBatch -> `SELECT * FROM gst_export_batch` (backend/sql/1520_gst_export_staging.sql)
 *   - GstExportRow   -> `SELECT * FROM gst_export_row` (same file)
 *   - GstRegistration -> the GROUP BY in gstExportService.listRegistrations()
 *
 * Every money field is a plain DECIMAL from the API — this module and its callers only
 * format it, never compute it, same convention as clientBillingApi.ts.
 */
import { hrmsApi } from "@/lib/hrmsApi";

export type GstExportType = "GSTR1" | "GSTR3B_OUTWARD" | "TALLY_SALES";
export type GstBatchStatus = "draft" | "validated" | "exported" | "superseded";

export interface GstRegistration {
  company_gstin: string;
  gst_state_code: string;
  company_name: string | null;
  branch_count: number;
  /** Most recent invoice date this registration has raised, or null if it never has. A
   *  registration with no recent date is still listed — it existed once, filing history for
   *  past periods still needs it — but the picker can flag it as inactive. */
  latest_invoice_date: string | null;
}

export interface GstExportBatch {
  id: string;
  export_type: GstExportType;
  company_gstin: string;
  gst_state_code: string;
  period_month: string;
  financial_year: string;
  status: GstBatchStatus;
  total_rows: number;
  valid_rows: number;
  exception_rows: number;
  generated_by: string | null;
  generated_at: string;
  downloaded_by: string | null;
  downloaded_at: string | null;
  notes: string | null;
  created_at: string;
}

export interface GstExportRow {
  sequence_no: number;
  source_type: "invoice" | "credit_note";
  bill_no: string | null;
  invoice_date: string | null;
  company_name: string | null;
  company_gstin: string | null;
  branch_name: string | null;
  client_name: string | null;
  client_gstin: string | null;
  place_of_supply: string | null;
  hsn_sac_code: string | null;
  supply_type: string | null;
  gst_type: string | null;
  gst_rate: number | null;
  taxable_value: number;
  igst_amount: number;
  cgst_amount: number;
  sgst_amount: number;
  invoice_value: number;
  tally_head: string | null;
  validation_status: "valid" | "exception";
  validation_errors: string | null;
}

export interface GstExceptionRow {
  sequence_no: number;
  source_type: "invoice" | "credit_note";
  bill_no: string | null;
  invoice_date: string | null;
  client_name: string | null;
  client_gstin: string | null;
  taxable_value: number;
  invoice_value: number;
  validation_errors: string | null;
}

export interface GenerateBatchResult {
  batchId: string;
  exportType: GstExportType;
  companyGstin: string;
  periodMonth: string;
  status: GstBatchStatus;
  totalRows: number;
  validRows: number;
  exceptionRows: number;
  filingReady: boolean;
  totals: { taxableValue: number; igst: number; cgst: number; sgst: number; invoiceValue: number };
}

function unwrap<T>(response: unknown): T {
  const body = (response as any)?.data ?? response;
  return (body?.data ?? body) as T;
}

export async function listRegistrations(): Promise<GstRegistration[]> {
  const rows = unwrap<GstRegistration[]>(await hrmsApi.get<any>("/api/gst/registrations"));
  return Array.isArray(rows) ? rows : [];
}

export async function listBatches(filters: {
  exportType?: GstExportType;
  companyGstin?: string;
  periodMonth?: string;
  limit?: number;
}): Promise<GstExportBatch[]> {
  const params = new URLSearchParams();
  if (filters.exportType) params.set("exportType", filters.exportType);
  if (filters.companyGstin) params.set("companyGstin", filters.companyGstin);
  if (filters.periodMonth) params.set("periodMonth", filters.periodMonth);
  if (filters.limit) params.set("limit", String(filters.limit));
  const qs = params.toString();
  const rows = unwrap<GstExportBatch[]>(await hrmsApi.get<any>(`/api/gst/exports${qs ? `?${qs}` : ""}`));
  return Array.isArray(rows) ? rows : [];
}

export async function generateBatch(input: {
  exportType: GstExportType;
  companyGstin: string;
  periodMonth: string;
  notes?: string;
}): Promise<GenerateBatchResult> {
  const res = await hrmsApi.post<any>("/api/gst/exports", input);
  const body = (res as any)?.data ?? res;
  if (body?.success === false) throw new Error(body?.error || "Unable to generate GST export batch");
  return body as GenerateBatchResult;
}

export async function getBatch(batchId: string): Promise<{ batch: GstExportBatch; rows: GstExportRow[] }> {
  const res = await hrmsApi.get<any>(`/api/gst/exports/${encodeURIComponent(batchId)}`);
  const body = (res as any)?.data ?? res;
  if (body?.success === false) throw new Error(body?.error || "GST export batch not found");
  return { batch: body.batch, rows: body.rows ?? [] };
}

export async function getExceptions(batchId: string): Promise<GstExceptionRow[]> {
  const rows = unwrap<GstExceptionRow[]>(
    await hrmsApi.get<any>(`/api/gst/exports/${encodeURIComponent(batchId)}/exceptions`)
  );
  return Array.isArray(rows) ? rows : [];
}

export async function markDownloaded(batchId: string): Promise<void> {
  const res = await hrmsApi.post<any>(`/api/gst/exports/${encodeURIComponent(batchId)}/downloaded`);
  const body = (res as any)?.data ?? res;
  if (body?.success === false) throw new Error(body?.error || "Unable to mark batch downloaded");
}

/**
 * Downloads the CSV and stamps the download audit trail, matching this codebase's established
 * blob-download pattern (clientBillingApi.ts's exportClientBillingCsv). Throws the backend's own
 * 409 message unmodified when the batch still carries blocking exceptions — the caller decides
 * whether to offer includeExceptions rather than this module silently forcing one path.
 */
export async function downloadBatchCsv(
  batch: GstExportBatch,
  options: { includeExceptions?: boolean } = {}
): Promise<void> {
  const qs = options.includeExceptions ? "?includeExceptions=true" : "";
  let blob: Blob;
  try {
    blob = await hrmsApi.getBlob(`/api/gst/exports/${encodeURIComponent(batch.id)}/csv${qs}`);
  } catch (err) {
    // requestBlob's own error carries the raw response body as its message. The 409 this route
    // returns for a batch with unresolved exceptions is real JSON ({success:false,error:"..."}),
    // so parse it back out rather than surfacing the caller with a literal JSON string.
    const raw = err instanceof Error ? err.message : String(err);
    let parsedMessage: string | undefined;
    try {
      parsedMessage = JSON.parse(raw)?.error;
    } catch {
      // raw wasn't JSON — fall through and surface it as-is below.
    }
    throw new Error(parsedMessage || raw);
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${batch.export_type}-${batch.company_gstin}-${batch.period_month}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  await markDownloaded(batch.id);
}
