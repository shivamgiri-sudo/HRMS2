/**
 * Client for the Tally voucher XML export (backend/src/modules/gst/tally-voucher/*,
 * mounted at /api/gst/tally-vouchers). Shapes mirror tally-voucher.service.ts's toRow() and
 * getVoucherDetail(); money arrives as plain numbers (rupees) and is only formatted here.
 */
import { hrmsApi } from "@/lib/hrmsApi";

export type TallyVoucherKind = "sales" | "credit_note" | "receipt";
export type TallyExportStatus =
  "not_exported" | "exported_unchanged" | "changed_since_export";

export interface TallyException {
  code: string;
  severity: "error" | "warning";
  message: string;
}

export interface TallyVoucherRow {
  sourceType: string;
  sourceId: string;
  kind: TallyVoucherKind;
  voucherType: string;
  voucherNumber: string;
  date: string;
  partyLedger: string;
  costCentreCode: string | null;
  amount: number;
  taxable: number;
  tax: number;
  action: "Create" | "Alter";
  exportStatus: TallyExportStatus;
  lastExportedAt: string | null;
  exportCount: number;
  guid: string;
  errors: TallyException[];
  blocked: boolean;
}

export interface TallyPreviewSummary {
  totalVouchers: number;
  cleanVouchers: number;
  exceptionVouchers: number;
  warningVouchers: number;
  totalDebit: number;
  totalCredit: number;
}

export interface TallyPreview {
  companyGstin: string;
  periodMonth: string;
  companyName: string | null;
  summary: TallyPreviewSummary;
  vouchers: TallyVoucherRow[];
  xml: string;
}

export interface TallyBatch {
  id: string;
  company_gstin: string;
  period_month: string;
  voucher_kinds: string;
  status: "draft" | "validated" | "exported" | "superseded";
  total_vouchers: number;
  clean_vouchers: number;
  exception_vouchers: number;
  generated_at: string;
  downloaded_at: string | null;
}

export interface TallyVoucherDetail {
  voucher: TallyVoucherRow;
  entries: Array<{
    ledgerName: string;
    side: "Dr" | "Cr";
    amount: number;
    role: string;
    billAllocations?: Array<{ name: string; type: string; paise: number }>;
  }>;
  narration: string;
  partyGstin: string | null;
  placeOfSupply: string | null;
  history: Array<{
    batch_id: string;
    period_month: string;
    status: string;
    generated_at: string;
    downloaded_at: string | null;
    validation_status: string;
  }>;
  xml: string;
}

export interface TallyConfig {
  scope: string;
  fields: Array<{
    key: string;
    value: string;
    source: "default" | "company" | "built-in";
  }>;
  companyName: string | null;
  companyNameSource: "company" | "branch";
}

const BASE = "/api/gst/tally-vouchers";

/**
 * hrmsApi already returns the parsed JSON envelope ({ success, data } or { success, ...fields }). Unwrapping
 * `.data` here as well made every `{ success, data }` route read `.data` of the payload: voucher kinds and batches
 * came back empty, so "Preview vouchers" silently did nothing and the batch list never showed a batch.
 */
function body<T>(res: unknown): T & { success?: boolean; error?: string } {
  return res as T & { success?: boolean; error?: string };
}

function ensure<T extends { success?: boolean; error?: string }>(
  b: T,
  fallback: string,
): T {
  if (b?.success === false) throw new Error(b.error || fallback);
  return b;
}

export async function listTallyKinds(): Promise<
  Array<{ kind: TallyVoucherKind; label: string }>
> {
  const b = ensure(
    body<{ data: Array<{ kind: TallyVoucherKind; label: string }> }>(
      await hrmsApi.get(`${BASE}/kinds`),
    ),
    "Unable to load voucher types",
  );
  return b.data ?? [];
}

export async function previewTallyVouchers(input: {
  companyGstin: string;
  periodMonth: string;
  voucherKinds: string[];
}): Promise<TallyPreview> {
  return ensure(
    body<TallyPreview>(await hrmsApi.post(`${BASE}/preview`, input)),
    "Unable to preview vouchers",
  );
}

export async function generateTallyBatch(input: {
  companyGstin: string;
  periodMonth: string;
  voucherKinds: string[];
}): Promise<{ batchId: string; status: string } & TallyPreviewSummary> {
  return ensure(
    body<{ batchId: string; status: string } & TallyPreviewSummary>(
      await hrmsApi.post(`${BASE}/batches`, input),
    ),
    "Unable to generate batch",
  );
}

export async function listTallyBatches(filters: {
  companyGstin?: string;
  limit?: number;
}): Promise<TallyBatch[]> {
  const params = new URLSearchParams();
  if (filters.companyGstin) params.set("companyGstin", filters.companyGstin);
  if (filters.limit) params.set("limit", String(filters.limit));
  const qs = params.toString();
  const b = ensure(
    body<{ data: TallyBatch[] }>(
      await hrmsApi.get(`${BASE}/batches${qs ? `?${qs}` : ""}`),
    ),
    "Unable to load batches",
  );
  return b.data ?? [];
}

export async function getTallyVoucherDetail(
  sourceType: string,
  sourceId: string,
): Promise<TallyVoucherDetail> {
  const b = ensure(
    body<{ data: TallyVoucherDetail }>(
      await hrmsApi.get(
        `${BASE}/vouchers/${encodeURIComponent(sourceType)}/${encodeURIComponent(sourceId)}`,
      ),
    ),
    "Unable to load voucher",
  );
  return b.data;
}

export async function getTallyConfig(
  companyGstin: string,
): Promise<TallyConfig> {
  const qs = companyGstin
    ? `?companyGstin=${encodeURIComponent(companyGstin)}`
    : "";
  const b = ensure(
    body<{ data: TallyConfig }>(await hrmsApi.get(`${BASE}/config${qs}`)),
    "Unable to load ledger configuration",
  );
  return b.data;
}

export async function saveTallyConfig(
  companyGstin: string,
  values: Record<string, string>,
): Promise<TallyConfig> {
  const b = ensure(
    body<{ data: TallyConfig }>(
      await hrmsApi.put(`${BASE}/config`, { companyGstin, values }),
    ),
    "Unable to save ledger configuration",
  );
  return b.data;
}

/** The backend answers 409 with JSON while exceptions remain; surface its own message. */
export async function downloadTallyBatchXml(
  batch: { id: string; company_gstin: string; period_month: string },
  options: { skipExceptions?: boolean } = {},
): Promise<void> {
  const qs = options.skipExceptions ? "?skipExceptions=true" : "";
  let blob: Blob;
  try {
    blob = await hrmsApi.getBlob(
      `${BASE}/batches/${encodeURIComponent(batch.id)}/xml${qs}`,
    );
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    let parsed: string | undefined;
    try {
      parsed = JSON.parse(raw)?.error;
    } catch {
      /* not JSON */
    }
    throw new Error(parsed || raw);
  }
  saveBlob(
    blob,
    `TALLY-VOUCHERS-${batch.company_gstin}-${batch.period_month}.xml`,
  );
  const res = await hrmsApi.post(
    `${BASE}/batches/${encodeURIComponent(batch.id)}/downloaded`,
  );
  ensure(
    body<{ success?: boolean; error?: string }>(res),
    "Unable to mark batch downloaded",
  );
}

/** Saves text (e.g. the preview XML) as a file without touching the exported-status tracking. */
export function saveXmlText(xml: string, filename: string): void {
  saveBlob(
    new Blob([xml], { type: "application/xml;charset=utf-8" }),
    filename,
  );
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
