import { useCallback, useRef, useState } from "react";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import {
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  FileSpreadsheet,
  History,
  Loader2,
  RefreshCcw,
  UploadCloud,
  X,
  Eye,
  Send,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';
import { hrmsApi } from "@/lib/hrmsApi";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ValidatedRow {
  rowNo: number;
  template_key: string;
  module_name: string;
  subject: string;
  body_text: string;
  body_html: string;
  variables_json: string;
  is_active: number;
  errors: string[];
  isNew: boolean;
  autoVars: string[];
}

interface InvalidRow {
  rowNo: number;
  raw: Record<string, unknown>;
  errors: string[];
}

interface PreviewResult {
  totalRows: number;
  newTemplateCount: number;
  updateTemplateCount: number;
  validRows: ValidatedRow[];
  invalidRows: InvalidRow[];
  duplicateRows: InvalidRow[];
}

interface ConfirmResult {
  inserted: number;
  updated: number;
  batchId: string;
}

interface HistoryEntry {
  id: string;
  upload_batch_no: string;
  original_file_name: string;
  total_rows: number;
  valid_rows: number;
  imported_rows: number;
  batch_status: string;
  created_at: string;
}

type Step = "upload" | "preview" | "done";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Badge({
  label,
  color,
}: {
  label: string;
  color: "green" | "amber" | "red" | "blue" | "slate";
}) {
  const cls: Record<string, string> = {
    green: "bg-green-50 text-green-700 border-green-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    red: "bg-red-50 text-red-700 border-red-200",
    blue: "bg-blue-50 text-blue-700 border-blue-200",
    slate: "bg-slate-100 text-slate-600 border-slate-200",
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cls[color]}`}>
      {label}
    </span>
  );
}

function SummaryCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: "green" | "amber" | "red" | "blue" | "slate";
}) {
  const bg: Record<string, string> = {
    green: "bg-green-50 border-green-200",
    amber: "bg-amber-50 border-amber-200",
    red: "bg-red-50 border-red-200",
    blue: "bg-blue-50 border-blue-200",
    slate: "bg-slate-50 border-slate-200",
  };
  const txt: Record<string, string> = {
    green: "text-green-700",
    amber: "text-amber-700",
    red: "text-red-700",
    blue: "text-blue-700",
    slate: "text-slate-600",
  };
  return (
    <div className={`rounded-xl border p-4 ${bg[color]}`}>
      <p className={`text-2xl font-bold ${txt[color]}`}>{value}</p>
      <p className="mt-0.5 text-sm text-slate-500">{label}</p>
    </div>
  );
}

// ─── Test Render Modal ────────────────────────────────────────────────────────

function TestRenderModal({
  templateKey,
  variables,
  onClose,
}: {
  templateKey: string;
  variables: string[];
  onClose: () => void;
}) {
  const [vals, setVals] = useState<Record<string, string>>(() =>
    Object.fromEntries(variables.map((v) => [v, `sample_${v}`])),
  );
  const [result, setResult] = useState<{
    subject: string;
    body_text: string;
    body_html: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const run = async () => {
    setLoading(true);
    setErr("");
    try {
      const res = await hrmsApi.post("/api/admin/email-templates/test-render", {
        template_key: templateKey,
        variables: vals,
      });
      setResult(res.data.data);
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? "Render failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <h3 className="font-semibold text-slate-800">
            Test Render — <code className="text-sm text-blue-600">{templateKey}</code>
          </h3>
          <button onClick={onClose} className="rounded p-1 hover:bg-slate-100">
            <X size={16} />
          </button>
        </div>
        <div className="space-y-3 p-6">
          <p className="text-sm text-slate-500">Provide sample values to preview rendered output.</p>
          <div className="grid grid-cols-2 gap-3">
            {variables.map((v) => (
              <div key={v}>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  {"{{"}{v}{"}}"}
                </label>
                <input
                  className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  value={vals[v] ?? ""}
                  onChange={(e) => setVals({ ...vals, [v]: e.target.value })}
                />
              </div>
            ))}
          </div>
          {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}
          {result && (
            <div className="space-y-2 rounded-xl bg-slate-50 p-4 text-sm">
              <div>
                <span className="font-semibold text-slate-700">Subject: </span>
                <span className="text-slate-600">{result.subject}</span>
              </div>
              <div>
                <span className="font-semibold text-slate-700">Body (text):</span>
                <pre className="mt-1 whitespace-pre-wrap rounded bg-white p-3 text-xs text-slate-600 shadow-sm">
                  {result.body_text}
                </pre>
              </div>
              {result.body_html && (
                <div>
                  <span className="font-semibold text-slate-700">Body (HTML preview):</span>
                  <div
                    className="mt-1 rounded bg-white p-3 text-xs shadow-sm"
                    dangerouslySetInnerHTML={{ __html: result.body_html }}
                  />
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            Close
          </button>
          <button
            onClick={run}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Render
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function NativeEmailTemplateBulkImport() {
  const [step, setStep] = useState<Step>("upload");
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<ConfirmResult | null>(null);
  const [error, setError] = useState("");
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [testModal, setTestModal] = useState<{ key: string; vars: string[] } | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Download sample ──────────────────────────────────────────────────────
  const downloadSample = async () => {
    const res = await hrmsApi.get("/api/admin/email-templates/import/sample", {
      responseType: "blob",
    });
    const url = URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement("a");
    a.href = url;
    a.download = "email_templates_sample.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── File upload → preview ────────────────────────────────────────────────
  const handleFile = useCallback(async (file: File) => {
    setError("");
    setFileName(file.name);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await hrmsApi.post("/api/admin/email-templates/import/preview", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setPreview(res.data.data);
      setStep("preview");
    } catch (e: any) {
      setError(e?.response?.data?.error ?? "Upload failed — check file format");
    } finally {
      setUploading(false);
    }
  }, []);

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  // ── Confirm import ───────────────────────────────────────────────────────
  const confirmUpload = async () => {
    if (!preview) return;
    setConfirming(true);
    setError("");
    try {
      const res = await hrmsApi.post("/api/admin/email-templates/import/confirm", {
        validRows: preview.validRows,
        originalFileName: fileName,
      });
      setResult(res.data.data);
      setStep("done");
    } catch (e: any) {
      setError(e?.response?.data?.error ?? "Import failed");
    } finally {
      setConfirming(false);
    }
  };

  // ── Load history ─────────────────────────────────────────────────────────
  const loadHistory = async () => {
    try {
      const res = await hrmsApi.get("/api/admin/email-templates/import/history");
      setHistory(res.data.data);
      setHistoryOpen(true);
    } catch {
      /* ignore */
    }
  };

  // ── Reset ────────────────────────────────────────────────────────────────
  const reset = () => {
    setStep("upload");
    setPreview(null);
    setFileName("");
    setResult(null);
    setError("");
    setExpandedRow(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  // ─── STEP: Upload ──────────────────────────────────────────────────────────
  const UploadStep = (
    <div className="space-y-6">
      {/* Header actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Bulk Import Email Templates</h2>
          <p className="text-sm text-slate-500">Upload an Excel or CSV file to import multiple templates at once.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={downloadSample}
            className="flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            <Download size={14} />
            Download Sample Excel
          </button>
          <button
            onClick={loadHistory}
            className="flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            <History size={14} />
            Import History
          </button>
        </div>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => fileRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-12 transition-colors ${
          dragging ? "border-blue-400 bg-blue-50" : "border-slate-300 bg-slate-50 hover:border-blue-300 hover:bg-blue-50/40"
        }`}
      >
        {uploading ? (
          <Loader2 size={40} className="animate-spin text-blue-500" />
        ) : (
          <UploadCloud size={40} className="text-slate-400" />
        )}
        <p className="mt-3 font-medium text-slate-700">
          {uploading ? "Parsing file…" : "Drop Excel / CSV here or click to browse"}
        </p>
        <p className="mt-1 text-sm text-slate-400">
          .xlsx · .xls · .csv — max 5 MB · max 500 rows
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={onInputChange}
        />
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-xl bg-red-50 p-4 text-sm text-red-700">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {/* Required columns */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="mb-3 text-sm font-semibold text-slate-700">Required columns in your file:</p>
        <div className="flex flex-wrap gap-2">
          {["template_key", "module_name", "subject", "body_text"].map((c) => (
            <code key={c} className="rounded bg-red-50 px-2 py-0.5 text-xs font-mono text-red-600">
              {c}*
            </code>
          ))}
          {["body_html", "variables_json", "is_active"].map((c) => (
            <code key={c} className="rounded bg-slate-100 px-2 py-0.5 text-xs font-mono text-slate-600">
              {c}
            </code>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-400">
          * Required. variables_json auto-detected from {"{{"} {"}}"}  patterns if blank.
          template_key must be UPPER_SNAKE_CASE.
        </p>
      </div>

      {/* History panel */}
      {historyOpen && (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="font-semibold text-slate-700">Import History</p>
            <button onClick={() => setHistoryOpen(false)} className="text-slate-400 hover:text-slate-600">
              <X size={14} />
            </button>
          </div>
          {history.length === 0 ? (
            <p className="text-sm text-slate-400">No imports yet.</p>
          ) : (
            <div className="divide-y divide-slate-100 text-sm">
              {history.map((h) => (
                <div key={h.id} className="flex items-center justify-between py-2.5">
                  <div>
                    <p className="font-medium text-slate-700">{h.original_file_name}</p>
                    <p className="text-xs text-slate-400">
                      {h.upload_batch_no} · {formatIST(h.created_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 text-right">
                    <span className="text-slate-500">{h.imported_rows} imported</span>
                    <Badge
                      label={h.batch_status}
                      color={h.batch_status === "imported" ? "green" : "amber"}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );

  // ─── STEP: Preview ─────────────────────────────────────────────────────────
  const PreviewStep = preview && (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <FileSpreadsheet size={20} className="text-blue-500" />
          <div>
            <h2 className="text-lg font-semibold text-slate-800">Preview: {fileName}</h2>
            <p className="text-sm text-slate-500">Review before confirming import.</p>
          </div>
        </div>
        <button
          onClick={reset}
          className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
        >
          <X size={14} />
          Cancel
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <SummaryCard label="Total Rows" value={preview.totalRows} color="slate" />
        <SummaryCard label="New Templates" value={preview.newTemplateCount} color="green" />
        <SummaryCard label="Will Update" value={preview.updateTemplateCount} color="blue" />
        <SummaryCard label="Invalid Rows" value={preview.invalidRows.length} color="red" />
        <SummaryCard label="Duplicates" value={preview.duplicateRows.length} color="amber" />
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-xl bg-red-50 p-4 text-sm text-red-700">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {/* Valid rows table */}
      {preview.validRows.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-5 py-3">
            <p className="font-semibold text-slate-700">
              Valid rows ({preview.validRows.length})
            </p>
          </div>
          <div className="divide-y divide-slate-50">
            {preview.validRows.map((row) => (
              <div key={row.rowNo} className="px-5 py-3">
                <div
                  className="flex cursor-pointer items-center justify-between"
                  onClick={() => setExpandedRow(expandedRow === row.rowNo ? null : row.rowNo)}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-400">#{row.rowNo}</span>
                    <code className="text-sm font-semibold text-slate-800">{row.template_key}</code>
                    <Badge label={row.module_name} color="blue" />
                    <Badge label={row.isNew ? "NEW" : "UPDATE"} color={row.isNew ? "green" : "amber"} />
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setTestModal({ key: row.template_key, vars: row.autoVars });
                      }}
                      className="flex items-center gap-1 rounded border border-slate-200 px-2 py-0.5 text-xs text-slate-500 hover:bg-slate-50"
                    >
                      <Eye size={11} /> Test
                    </button>
                    {expandedRow === row.rowNo ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </div>
                </div>
                {expandedRow === row.rowNo && (
                  <div className="mt-3 space-y-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
                    <p><span className="font-semibold">Subject:</span> {row.subject}</p>
                    <p><span className="font-semibold">Body (text):</span> {row.body_text.slice(0, 120)}{row.body_text.length > 120 ? "…" : ""}</p>
                    <p>
                      <span className="font-semibold">Variables:</span>{" "}
                      {row.autoVars.length > 0 ? row.autoVars.map((v) => (
                        <code key={v} className="mr-1 rounded bg-blue-50 px-1 text-blue-600">{v}</code>
                      )) : <span className="text-slate-400">none</span>}
                    </p>
                    <p>
                      <span className="font-semibold">Active:</span>{" "}
                      <Badge label={row.is_active ? "Yes" : "No"} color={row.is_active ? "green" : "slate"} />
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Invalid rows */}
      {preview.invalidRows.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50">
          <div className="border-b border-red-100 px-5 py-3">
            <p className="font-semibold text-red-700">
              Invalid rows ({preview.invalidRows.length}) — will be skipped
            </p>
          </div>
          <div className="divide-y divide-red-100">
            {preview.invalidRows.map((row) => (
              <div key={row.rowNo} className="px-5 py-3 text-sm">
                <span className="mr-2 text-xs text-red-400">Row #{row.rowNo}</span>
                <span className="font-mono text-red-600">
                  {String(row.raw["template_key"] || "—")}
                </span>
                <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs text-red-500">
                  {row.errors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Duplicate rows */}
      {preview.duplicateRows.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50">
          <div className="border-b border-amber-100 px-5 py-3">
            <p className="font-semibold text-amber-700">
              Duplicate keys in file ({preview.duplicateRows.length}) — will be skipped
            </p>
          </div>
          <div className="divide-y divide-amber-100">
            {preview.duplicateRows.map((row) => (
              <div key={row.rowNo} className="px-5 py-3 text-sm">
                <span className="mr-2 text-xs text-amber-400">Row #{row.rowNo}</span>
                <span className="font-mono text-amber-700">
                  {String(row.raw["template_key"] || "—")}
                </span>
                <p className="mt-0.5 text-xs text-amber-600">{row.errors[0]}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-3">
        <button
          onClick={reset}
          className="rounded-lg border border-slate-200 px-5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
        >
          Cancel
        </button>
        <button
          onClick={confirmUpload}
          disabled={confirming || preview.validRows.length === 0}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {confirming ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <CheckCircle2 size={14} />
          )}
          {confirming
            ? "Importing…"
            : `Confirm Import (${preview.validRows.length} template${preview.validRows.length !== 1 ? "s" : ""})`}
        </button>
      </div>
    </div>
  );

  // ─── STEP: Done ────────────────────────────────────────────────────────────
  const DoneStep = result && (
    <div className="flex flex-col items-center space-y-6 py-12 text-center">
      <CheckCircle2 size={56} className="text-green-500" />
      <div>
        <h2 className="text-2xl font-bold text-slate-800">Import Complete</h2>
        <p className="mt-1 text-slate-500">Batch ID: {result.batchId}</p>
      </div>
      <div className="flex gap-6">
        <div className="rounded-xl bg-green-50 px-8 py-4">
          <p className="text-3xl font-bold text-green-700">{result.inserted}</p>
          <p className="text-sm text-green-600">New templates added</p>
        </div>
        <div className="rounded-xl bg-blue-50 px-8 py-4">
          <p className="text-3xl font-bold text-blue-700">{result.updated}</p>
          <p className="text-sm text-blue-600">Existing templates updated</p>
        </div>
      </div>
      <button
        onClick={reset}
        className="flex items-center gap-2 rounded-lg bg-slate-800 px-6 py-2.5 text-sm font-semibold text-white hover:bg-slate-700"
      >
        <RefreshCcw size={14} />
        Import Another File
      </button>
    </div>
  );

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-5xl space-y-2 p-6">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-1.5 text-xs text-slate-400">
          <span>Settings</span>
          <ChevronRight size={12} />
          <span>Notification Templates</span>
          <ChevronRight size={12} />
          <span className="font-medium text-slate-600">Email Templates Bulk Import</span>
        </nav>

        {/* Step indicator */}
        <div className="flex items-center gap-2 pb-2">
          {(["upload", "preview", "done"] as Step[]).map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              {i > 0 && <div className="h-px w-8 bg-slate-200" />}
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                  s === step
                    ? "bg-blue-600 text-white"
                    : step === "done" || (step === "preview" && i === 0)
                    ? "bg-green-100 text-green-700"
                    : "bg-slate-100 text-slate-400"
                }`}
              >
                {i + 1}
              </div>
              <span
                className={`text-sm capitalize ${s === step ? "font-semibold text-slate-800" : "text-slate-400"}`}
              >
                {s}
              </span>
            </div>
          ))}
        </div>

        {/* Content */}
        {step === "upload" && UploadStep}
        {step === "preview" && PreviewStep}
        {step === "done" && DoneStep}
      </div>

      {/* Test render modal */}
      {testModal && (
        <TestRenderModal
          templateKey={testModal.key}
          variables={testModal.vars}
          onClose={() => setTestModal(null)}
        />
      )}
    </DashboardLayout>
  );
}
