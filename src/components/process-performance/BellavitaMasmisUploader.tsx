import { useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { hrmsApi, getAuthToken } from "@/lib/hrmsApi";
import { pollBatchJob, isBatchJobStarted } from "@/lib/bulkBatchJob";
import { apiUrl } from "@/lib/apiBase";
import { TONE_SOLID_CLASSES, type Tone } from "@/lib/processPerformanceTones";
import { Upload, Loader2, CheckCircle2, XCircle, Trash2, UploadCloud, Download, CheckCircle } from "lucide-react";

/**
 * Inline uploader embedded directly on Process Performance V2's Bellavita and
 * GNC Uploader sections, per explicit user request ("i want create it in
 * Uploader also so i can upload from here") instead of redirecting to the
 * main Bulk Upload Hub. Scoped to exactly the db_masmis upload types in
 * RPC_BY_TYPE below -- not a replacement for the Hub, which still handles
 * every other upload type unchanged.
 *
 * Deliberately only enforces each template's required_columns (fetched
 * live from /api/bulk-upload/templates, so it always matches whatever the
 * catalog says). Unlike the Hub's validateRows(), it does NOT reject rows
 * for columns outside the registered optional_columns list -- the backend
 * importer only ever reads the specific keys it maps into db_masmis
 * columns and safely ignores everything else, so treating an unrecognized
 * column as fatal here would only risk re-creating the exact "real file
 * rejected outright" bug this uploader exists to avoid, especially for a
 * header list read off a compressed sample image rather than copy-pasted
 * text.
 */

const RPC_BY_TYPE: Record<string, string> = {
  BB_SALE_MASMIS: "import_bb_sale_masmis_batch",
  BB_APR_MASMIS: "import_bb_apr_masmis_batch",
  BB_CHAT_MASMIS: "import_bb_chat_masmis_batch",
  BB_CART_MASMIS: "import_bb_cart_masmis_batch",
  GNC_SALE_MASMIS: "import_gnc_sale_masmis_batch",
  GNC_APR: "import_gnc_apr_batch",
  GNC_ALLOCATION_MASMIS: "import_gnc_allocation_masmis_batch",
  NEEMANS_SALE_RAW_MASMIS: "import_neemans_sale_raw_masmis_batch",
  NEEMANS_ALLOCATION_MASMIS: "import_neemans_allocation_masmis_batch",
  NEEMANS_APR_MASMIS: "import_neemans_apr_masmis_batch",
  NEEMANS_MONTH_TARGET_MASMIS: "import_neemans_month_target_batch",
  NEEMANS_AGENT_DETAILS_MASMIS: "import_neemans_agent_details_batch",
  AW_BILLING_MASMIS: "import_aw_billing_batch",
  AW_INBOUND_MASMIS: "import_aw_inbound_batch",
  AW_MANDATE_MASMIS: "import_aw_mandate_batch",
  AW_NEW_CDR_MASMIS: "import_aw_new_cdr_batch",
  AW_OUT_MASMIS: "import_aw_out_batch",
  AW_CHAT_MASMIS: "import_aw_chat_batch",
  OWNER_SALE_MASMIS: "import_owner_sale_batch",
  OWNER_CDR_MASMIS: "import_owner_cdr_batch",
  OWNER_AGENT_DETAILS_MASMIS: "import_owner_agent_details_batch",
  PRE_SALE_MASMIS: "import_pre_sale_batch",
  PRE_CDR_MASMIS: "import_pre_cdr_batch",
  PRE_AGENT_DETAILS_MASMIS: "import_pre_agent_details_batch",
  CL_APR_MASMIS: "import_cl_apr_batch",
  CL_CHAT_MASMIS: "import_cl_chat_batch",
  CL_DISPO_MASMIS: "import_cl_dispo_batch",
  CL_EMAIL_RAW_MASMIS: "import_cl_email_raw_batch",
  CL_FEEDBACK_MASMIS: "import_cl_feedback_batch",
  CL_IB_CDR_MASMIS: "import_cl_ib_cdr_batch",
  CL_OUTBOUND_MASMIS: "import_cl_outbound_batch",
  CL_QUALITY_MASMIS: "import_cl_quality_batch",
  CL_RECHURN_CALL_MASMIS: "import_cl_rechurn_call_batch",
  BIRLANU_SALE_MASMIS: "import_birlanu_sale_batch",
  BIRLANU_APR_MASMIS: "import_birlanu_apr_batch",
  SATYA_ALLOCATION_MASMIS: "import_satya_allocation_batch",
  SATYA_CDR_MASMIS: "import_satya_cdr_batch",
  LP_FEEDBACK_APR_MASMIS: "import_lp_feedback_apr_batch",
  LP_FEEDBACK_CDR_MASMIS: "import_lp_feedback_cdr_batch",
  LP_ONBOARDING_APR_MASMIS: "import_lp_onboarding_apr_batch",
  LP_ONBOARDING_CDR_MASMIS: "import_lp_onboarding_cdr_batch",
  GNC_CHAT_MASMIS: "import_gnc_chat_batch",
  NEEMANS_CHAT_MASMIS: "import_neemans_chat_batch",
  DALMIA_DD_RAW: "import_dalmia_dd_batch",
  DALMIA_OUTBOUND_RAW: "import_dalmia_outbound_batch",
  DALMIA_AFTER_HOUR: "import_dalmia_after_hour_batch",
  DALMIA_APR: "import_dalmia_apr_batch",
};

/** Same normalization every aw-*-bulk.service.ts backend importer uses: lowercase,
 * strip everything but letters/digits. Applied here too so this pre-check agrees
 * with what the backend will actually accept -- an exact-match check here already
 * caused 3 real "required column missing" failures this session (GNC APR/
 * Allocation, all 3 original Neemans uploaders) where the real header was
 * present but spelled/cased/spaced differently than the catalog's required_columns
 * entry. Normalizing removes that whole class of false rejection. */
function normalizeHeaderKey(k: string): string {
  return k.toLowerCase().replace(/[^a-z0-9]/g, "");
}
function getNormalized(row: Record<string, unknown>, column: string): string {
  for (const k of Object.keys(row)) {
    if (normalizeHeaderKey(k) === normalizeHeaderKey(column)) {
      return String(row[k] ?? "").trim();
    }
  }
  return "";
}

const STAGE_CHUNK_SIZE = 500;

interface UploadTemplate {
  upload_type_code: string;
  required_columns: string[];
  optional_columns: string[];
}

interface UploadBatchLogRow {
  id: string;
  original_file_name: string | null;
  created_at: string;
  batch_status: string;
  total_rows: number | null;
  imported_rows: number | null;
  error_rows: number | null;
  uploaded_by_name?: string | null;
}

type Phase = "idle" | "staging" | "importing" | "done" | "error";

/** DD/MM/YYYY HH:mm, per this project's drill-down date-format convention. */
function formatLogDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const STATUS_STYLES: Record<string, string> = {
  imported: "bg-emerald-50 text-emerald-700",
  validated: "bg-blue-50 text-blue-700",
  validation_failed: "bg-red-50 text-red-700",
  failed: "bg-red-50 text-red-700",
  importing: "bg-amber-50 text-amber-700",
  processing: "bg-amber-50 text-amber-700",
  imported_with_errors: "bg-amber-50 text-amber-700",
};

const STATUS_LABELS: Record<string, string> = {
  imported: "Success",
  validated: "Validated",
  validation_failed: "Failed",
  failed: "Failed",
  importing: "Importing",
  processing: "Processing",
  imported_with_errors: "Partial",
};

const RECENT_UPLOADS_PAGE_SIZE = 5;

export function BellavitaMasmisUploader({
  templateCode, label, tone = "slate",
}: { templateCode: string; label: string; tone?: Tone }) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [template, setTemplate] = useState<UploadTemplate | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<{ imported: number; errors: number } | null>(null);
  const [log, setLog] = useState<UploadBatchLogRow[]>([]);
  const [logLoading, setLogLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [showAllLog, setShowAllLog] = useState(false);
  const [lastBatchId, setLastBatchId] = useState<string | null>(null);
  const [downloadingErrorsId, setDownloadingErrorsId] = useState<string | null>(null);

  function loadLog() {
    setLogLoading(true);
    hrmsApi
      .get<{ success: boolean; data: UploadBatchLogRow[] }>(
        `/api/bulk-upload/batches?uploadType=${encodeURIComponent(templateCode)}`,
      )
      .then((res) => setLog(res.data || []))
      .catch(() => setLog([]))
      .finally(() => setLogLoading(false));
  }

  useEffect(() => {
    hrmsApi
      .get<{ success: boolean; data: UploadTemplate[] }>("/api/bulk-upload/templates")
      .then((res) => {
        const found = (res.data || []).find((t) => t.upload_type_code === templateCode);
        setTemplate(found ?? null);
      })
      .catch(() => setTemplate(null));
    loadLog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateCode]);

  async function handleDelete(id: string) {
    if (!window.confirm("Remove this entry from the upload log? The data it already imported will NOT be affected.")) return;
    setDeletingId(id);
    try {
      await hrmsApi.delete(`/api/bulk-upload/batches/${id}`);
      setLog((prev) => prev.filter((b) => b.id !== id));
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Failed to delete this log entry.");
    } finally {
      setDeletingId(null);
    }
  }

  /** Pulls the rows this batch rejected (row_status='error') straight from
   * upload_batch_row — the exact data + reason already staged at upload
   * time, not re-derived — and offers them back as a real, editable Excel
   * file: original columns plus an "Error Reason" column, so a row can be
   * fixed and re-uploaded without re-typing anything. */
  async function downloadFailedRows(batchId: string, fileLabel: string) {
    setDownloadingErrorsId(batchId);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: Array<Record<string, unknown>> }>(
        `/api/bulk-upload/batches/${batchId}/rows`,
      );
      const parseJsonField = (v: unknown): unknown => {
        if (typeof v !== "string") return v;
        try { return JSON.parse(v); } catch { return v; }
      };
      const errorRows = (res.data || []).filter((r) => r.row_status === "error");
      if (errorRows.length === 0) {
        window.alert("No failed rows found for this upload — it may already have been fully imported.");
        return;
      }

      const sheetRows = errorRows.map((r) => {
        const raw = (parseJsonField(r.raw_data) ?? {}) as Record<string, unknown>;
        const errors = (parseJsonField(r.error_messages) ?? []) as string[];
        return {
          "Row #": r.row_no,
          ...raw,
          "Error Reason": Array.isArray(errors) ? errors.join("; ") : String(errors),
        };
      });

      const worksheet = XLSX.utils.json_to_sheet(sheetRows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Failed Rows");
      const safeLabel = fileLabel.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
      XLSX.writeFile(workbook, `${safeLabel}_failed_rows.xlsx`);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Failed to load the error rows for this upload.");
    } finally {
      setDownloadingErrorsId(null);
    }
  }

  /** Builds a real blank template file from this type's actual registered
   * columns (required first, then optional) — not a static asset, so it
   * can never drift from what the backend importer expects. */
  function downloadTemplate() {
    if (!template) return;
    const headers = [...(template.required_columns || []), ...(template.optional_columns || [])];
    const worksheet = XLSX.utils.aoa_to_sheet([headers]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Template");
    XLSX.writeFile(workbook, `${templateCode.toLowerCase()}_template.xlsx`);
  }

  function pickFile(f: File | null) {
    setFile(f);
    setPhase("idle");
    setResult(null);
    setMessage(null);
    setLastBatchId(null);
  }

  async function fileToRows(f: File): Promise<Record<string, string>[]> {
    const lower = f.name.toLowerCase();
    const workbook = lower.endsWith(".csv")
      ? XLSX.read(await f.text(), { type: "string" })
      : XLSX.read(new Uint8Array(await f.arrayBuffer()), { type: "array" });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) throw new Error("The file has no sheets.");
    return XLSX.utils.sheet_to_json<Record<string, string>>(workbook.Sheets[sheetName]!, {
      defval: "", raw: false,
    });
  }

  async function handleUpload() {
    if (!file || !template) return;
    setPhase("staging");
    setMessage("Reading file...");
    setResult(null);

    try {
      const rows = await fileToRows(file);
      if (rows.length === 0) {
        throw new Error("This file has no data rows below the header.");
      }

      const required = template.required_columns || [];
      const stagedRows = rows.map((row, index) => {
        const errors = required.filter(
          (col) => getNormalized(row, col) === "",
        ).map((col) => `${col} is required`);
        return {
          rowNo: index + 1,
          rawData: row,
          normalizedData: row,
          status: errors.length > 0 ? "error" : "valid",
          errors,
        };
      });

      const validRows = stagedRows.filter((r) => r.status === "valid").length;
      const errorRows = stagedRows.filter((r) => r.status === "error").length;
      if (validRows === 0) {
        const foundColumns = Object.keys(rows[0] ?? {});
        throw new Error(
          `No row had all required columns (${required.join(", ")}) filled in — nothing would be uploaded. ` +
          `Columns actually found in this file: ${foundColumns.join(", ") || "(none detected)"}`,
        );
      }

      const token = getAuthToken();
      const formData = new FormData();
      formData.append("file", file);
      const uploadResponse = await fetch(apiUrl("/api/files/upload?category=bulk-uploads"), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!uploadResponse.ok) throw new Error("File upload failed.");
      const uploadData = await uploadResponse.json();

      const batchRes = await hrmsApi.post<{ data: any }>("/api/bulk-upload/batches", {
        upload_batch_no: `BATCH-${Date.now()}`,
        upload_type_code: templateCode,
        original_file_name: file.name,
        file_path: uploadData.url,
        file_size_bytes: file.size,
        total_rows: stagedRows.length,
        valid_rows: validRows,
        error_rows: errorRows,
        batch_status: errorRows > 0 ? "validation_failed" : "validated",
        error_summary: errorRows > 0 ? `${errorRows} row(s) missing a required column` : null,
        metadata: { source: "process_performance_v2_bellavita_uploader" },
      });
      const batch = batchRes.data;
      setLastBatchId(batch.id);

      setMessage(`Staging ${stagedRows.length} row(s)...`);
      for (let offset = 0; offset < stagedRows.length; offset += STAGE_CHUNK_SIZE) {
        const slice = stagedRows.slice(offset, offset + STAGE_CHUNK_SIZE);
        await hrmsApi.post(
          `/api/bulk-upload/batches/${batch.id}/rows`,
          slice.map((r) => ({
            row_no: r.rowNo, raw_data: r.rawData, normalized_data: r.normalizedData,
            row_status: r.status, error_messages: r.errors,
          })),
          180000,
        );
      }

      setPhase("importing");
      setMessage("Importing into db_masmis...");
      const importRes = await hrmsApi.post<{ success: boolean; processing?: boolean; error?: string }>(
        `/api/bulk-upload/batches/${batch.id}/import`,
        { rpc_name: RPC_BY_TYPE[templateCode] },
        60000,
      );
      if (!importRes.success) throw new Error(importRes.error || "Import failed.");

      let imported = 0;
      let errored = errorRows;
      if (isBatchJobStarted(importRes)) {
        const final = await pollBatchJob(`/api/bulk-upload/batches/${batch.id}/import-status`, {
          onProgress: (s) => setMessage(`Importing... ${s.progress?.processed ?? 0}/${s.progress?.total ?? "?"}`),
        });
        if (final.phase === "failed") throw new Error(final.error || final.message || "Import failed.");
        const data = (final.result as { data?: any })?.data ?? {};
        imported = Number(data.importedRows ?? data.imported_rows ?? final.progress?.succeeded ?? 0);
        errored += Number(data.errorRows ?? data.error_rows ?? final.progress?.failed ?? 0);
      }

      setResult({ imported, errors: errored });
      setPhase("done");
      setMessage(null);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      loadLog();
    } catch (err) {
      setPhase("error");
      setMessage(err instanceof Error ? err.message : "Upload failed.");
    }
  }

  const busy = phase === "staging" || phase === "importing";
  const visibleLog = showAllLog ? log : log.slice(0, RECENT_UPLOADS_PAGE_SIZE);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Dropzone + status */}
        <div className="lg:col-span-2">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const dropped = e.dataTransfer.files?.[0];
              if (dropped) pickFile(dropped);
            }}
            className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 text-center transition ${
              dragOver ? "border-indigo-400 bg-indigo-50/50" : "border-slate-200 bg-white"
            }`}
          >
            <UploadCloud className="h-9 w-9 text-slate-300" />
            <p className="mt-3 text-sm font-semibold text-slate-700">Drag &amp; drop your file here</p>
            <p className="mt-0.5 text-xs text-slate-400">or click to browse</p>
            <p className="mt-1 text-xs text-slate-400">Supported formats: .xlsx, .xls, .csv (Max size: 50 MB)</p>

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls,.xlsb"
              disabled={busy}
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
              className="hidden"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
              className={`mt-4 flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold text-white disabled:opacity-40 ${TONE_SOLID_CLASSES[tone]}`}
            >
              <Upload className="h-3.5 w-3.5" />
              Choose File
            </button>

            {file && (
              <p className="mt-3 max-w-full truncate text-xs font-medium text-slate-600">{file.name}</p>
            )}
          </div>

          {file && (
            <button
              type="button"
              disabled={!file || busy || !template}
              onClick={handleUpload}
              className="mt-3 flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              {busy ? "Uploading..." : "Upload"}
            </button>
          )}

          {!template && (
            <p className="mt-2 text-xs text-amber-600">Could not load the upload template — try again shortly.</p>
          )}
          {message && phase !== "error" && <p className="mt-2 text-xs text-slate-500">{message}</p>}
          {phase === "error" && message && (
            <div className="mt-2 flex items-start gap-2 rounded-lg bg-red-50 p-2.5 text-xs text-red-700">
              <XCircle className="h-4 w-4 shrink-0" />
              <span>{message}</span>
            </div>
          )}
          {phase === "done" && result && (
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-emerald-50 p-2.5 text-xs text-emerald-700">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>
                Imported {result.imported} row(s){result.errors > 0 ? `, ${result.errors} row(s) had errors` : ""}.
              </span>
              {result.errors > 0 && lastBatchId && (
                <button
                  type="button"
                  disabled={downloadingErrorsId === lastBatchId}
                  onClick={() => downloadFailedRows(lastBatchId, label)}
                  className="ml-auto flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-40"
                >
                  {downloadingErrorsId === lastBatchId ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                  Download Failed Rows
                </button>
              )}
            </div>
          )}
        </div>

        {/* Upload guidelines sidebar */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-sm font-bold text-slate-900">Upload Guidelines</div>
          <ul className="mt-3 space-y-2">
            {[
              "Use the latest template format",
              "Ensure column headers match",
              "Remove blank rows",
              "File size should be less than 50 MB",
            ].map((tip) => (
              <li key={tip} className="flex items-start gap-2 text-xs text-slate-600">
                <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                {tip}
              </li>
            ))}
          </ul>
          {template && template.required_columns.length > 0 && (
            <p className="mt-3 text-[11px] text-slate-400">
              Required columns: {template.required_columns.join(", ")}
            </p>
          )}
          <button
            type="button"
            disabled={!template}
            onClick={downloadTemplate}
            className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-lg border border-indigo-200 px-3 py-2 text-xs font-semibold text-indigo-600 hover:bg-indigo-50 disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" /> Download Template
          </button>
        </div>
      </div>

      {/* Recent uploads */}
      <div id={`recent-uploads-${templateCode}`} className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-bold text-slate-900">Recent Uploads</div>
          {log.length > RECENT_UPLOADS_PAGE_SIZE && (
            <button
              type="button"
              onClick={() => setShowAllLog((v) => !v)}
              className="text-xs font-semibold text-indigo-600 hover:underline"
            >
              {showAllLog ? "Show Less" : "View All"}
            </button>
          )}
        </div>

        {logLoading && <p className="text-xs text-slate-400">Loading...</p>}
        {!logLoading && log.length === 0 && <p className="text-xs text-slate-400">No uploads yet for {label}.</p>}

        {!logLoading && log.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-3 font-semibold">File Name</th>
                  <th className="py-2 pr-3 font-semibold">Type</th>
                  <th className="py-2 pr-3 font-semibold">Uploaded By</th>
                  <th className="py-2 pr-3 font-semibold">Date &amp; Time</th>
                  <th className="py-2 pr-3 font-semibold">Status</th>
                  <th className="py-2 pr-0 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleLog.map((b) => (
                  <tr key={b.id} className="border-b border-slate-50 last:border-0">
                    <td className="max-w-[180px] truncate py-2.5 pr-3 font-medium text-slate-700">
                      {b.original_file_name || "(no file name)"}
                    </td>
                    <td className="py-2.5 pr-3 text-slate-500">{label}</td>
                    <td className="py-2.5 pr-3 text-slate-500">{b.uploaded_by_name || "—"}</td>
                    <td className="py-2.5 pr-3 text-slate-500">{formatLogDate(b.created_at)}</td>
                    <td className="py-2.5 pr-3">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLES[b.batch_status] ?? "bg-slate-100 text-slate-600"}`}>
                        {STATUS_LABELS[b.batch_status] ?? b.batch_status}
                      </span>
                    </td>
                    <td className="py-2.5 pr-0 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {Number(b.error_rows ?? 0) > 0 && (
                          <button
                            type="button"
                            disabled={downloadingErrorsId === b.id}
                            onClick={() => downloadFailedRows(b.id, label)}
                            title={`Download the ${b.error_rows} row(s) that failed`}
                            className="rounded p-1.5 text-slate-400 hover:bg-indigo-50 hover:text-indigo-600 disabled:opacity-40"
                          >
                            {downloadingErrorsId === b.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={deletingId === b.id}
                          onClick={() => handleDelete(b.id)}
                          title="Remove from log (does not affect imported data)"
                          className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                        >
                          {deletingId === b.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
