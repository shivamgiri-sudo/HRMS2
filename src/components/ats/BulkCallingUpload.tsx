import { useState, useRef, useCallback } from "react";
import { Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, XCircle, Download, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { hrmsApi } from "@/lib/hrmsApi";
import { toast } from "sonner";
import {
  autoMapHeaders,
  normalizeMobile,
  CALLING_TARGET_FIELDS,
  CALLING_FIELD_LABELS,
  REQUIRED_CALLING_FIELDS,
  type CallingTargetField,
} from "@/lib/headerMapping";

// ── Types ─────────────────────────────────────────────────────────────────────

interface BulkCallingUploadProps {
  bootstrap: {
    actor: {
      recruiterName: string;
      branchName: string;
      activityDate: string;
    };
    options: {
      callingOutcomeOptions: string[];
      wpGroupOptions: string[];
    };
  };
  sessionLocked: boolean;
  sessionContext: {
    process_name: string;
    hiring_source: string;
    position_name: string;
  };
}

type Step = "upload" | "mapping" | "preview" | "submitting" | "done";

interface MappedRow {
  candidate_name: string;
  mobile: string;
  gender: string;
  candidate_email: string;
  education_qualification: string;
  experience_level: string;
  candidate_location: string;
  wp_group: string;
  recruiter_remarks: string;
  _valid: boolean;
  _errors: string[];
}

interface ImportResult {
  batchId: string;
  fileName: string;
  totalRows: number;
  insertedRows: number;
  updatedRows: number;
  duplicateRows: number;
  failedRows: number;
  errors: { row_number: number; error_message: string }[];
}

// ── Component ─────────────────────────────────────────────────────────────────

export function BulkCallingUpload({ bootstrap, sessionLocked, sessionContext }: BulkCallingUploadProps) {
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [fileHeaders, setFileHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Record<string, unknown>[]>([]);
  const [mapping, setMapping] = useState<Record<CallingTargetField, string | null>>({} as never);
  const [mappedRows, setMappedRows] = useState<MappedRow[]>([]);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [mappingCollapsed, setMappingCollapsed] = useState(false);
  const [batchFeedback, setBatchFeedback] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  // ── File Parsing ────────────────────────────────────────────────────────────

  const parseFile = useCallback(async (selectedFile: File) => {
    setFile(selectedFile);
    try {
      const XLSX = await import("xlsx");
      const buffer = await selectedFile.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) { toast.error("No sheets found in file"); return; }

      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], { defval: "", raw: true });
      if (!rows.length) { toast.error("File has no data rows"); return; }

      const headers = Object.keys(rows[0]);
      setFileHeaders(headers);
      setRawRows(rows);

      const autoMapped = autoMapHeaders(headers);
      setMapping(autoMapped);
      setStep("mapping");
    } catch {
      toast.error("Failed to parse file. Please use CSV or Excel format.");
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) void parseFile(droppedFile);
  }, [parseFile]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) void parseFile(selected);
  }, [parseFile]);

  // ── Mapping Confirmation ────────────────────────────────────────────────────

  const requiredMapped = REQUIRED_CALLING_FIELDS.every((f) => mapping[f]);

  const confirmMapping = useCallback(() => {
    const rows: MappedRow[] = rawRows.map((raw) => {
      const row: MappedRow = {
        candidate_name: "",
        mobile: "",
        gender: "",
        candidate_email: "",
        education_qualification: "",
        experience_level: "",
        candidate_location: "",
        wp_group: "",
        recruiter_remarks: "",
        _valid: true,
        _errors: [],
      };

      for (const field of CALLING_TARGET_FIELDS) {
        const header = mapping[field];
        if (header) {
          row[field] = String(raw[header] ?? "").trim();
        }
      }

      // Normalize mobile
      const normalizedMobile = normalizeMobile(row.mobile);
      if (normalizedMobile) {
        row.mobile = normalizedMobile;
      }

      // Validate
      const errors: string[] = [];
      if (!row.candidate_name) errors.push("Name required");
      if (!normalizedMobile) errors.push("Invalid mobile");
      row._errors = errors;
      row._valid = errors.length === 0;

      return row;
    });

    setMappedRows(rows);
    setMappingCollapsed(true);
    setStep("preview");
  }, [rawRows, mapping]);

  // ── Inline Editing ──────────────────────────────────────────────────────────

  const updateRowFeedback = useCallback((index: number, value: string) => {
    setMappedRows((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], recruiter_remarks: value };
      return copy;
    });
  }, []);

  const applyBatchFeedback = useCallback((value: string) => {
    setBatchFeedback(value);
    if (!value) return;
    setMappedRows((prev) => prev.map((r) => ({ ...r, recruiter_remarks: value })));
  }, []);

  // ── Submit ──────────────────────────────────────────────────────────────────

  const handleSubmit = useCallback(async () => {
    const validRows = mappedRows.filter((r) => r._valid);
    if (!validRows.length) { toast.error("No valid rows to import"); return; }
    const missingFeedback = validRows.filter((r) => !r.recruiter_remarks);
    if (missingFeedback.length) {
      toast.error(`${missingFeedback.length} row(s) still need a Calling Feedback outcome`);
      return;
    }

    setStep("submitting");
    try {
      const enrichedRows = validRows.map((r) => ({
        candidate_name: r.candidate_name,
        mobile: r.mobile,
        gender: r.gender || undefined,
        candidate_email: r.candidate_email || undefined,
        education_qualification: r.education_qualification || undefined,
        experience_level: r.experience_level || undefined,
        candidate_location: r.candidate_location || undefined,
        wp_group: r.wp_group || undefined,
        recruiter_remarks: r.recruiter_remarks || undefined,
        activity_date: bootstrap.actor.activityDate,
        recruiter_name_snapshot: bootstrap.actor.recruiterName,
        hiring_source: sessionContext.hiring_source,
        position_name: sessionContext.position_name,
        location_name: bootstrap.actor.branchName,
        process_name: sessionContext.process_name,
      }));

      const res = await hrmsApi.post("/api/ats/recruiter/hiring-activity/import", {
        rows: enrichedRows,
        fileName: file?.name ?? "bulk_calling_upload.xlsx",
        duplicateMode: "insert_duplicates_with_warning",
      });

      setImportResult(res.data.data);
      setStep("done");
      toast.success(`Imported ${res.data.data?.insertedRows ?? 0} rows successfully`);
    } catch (err: unknown) {
      setStep("preview");
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? "Import failed";
      toast.error(msg);
    }
  }, [mappedRows, bootstrap, sessionContext, file]);

  // ── Template Download ───────────────────────────────────────────────────────

  const downloadTemplate = useCallback(() => {
    const headers = ["Candidate Name", "Mobile No.", "Gender", "Email", "Education", "Experience", "Location", "WP Group", "Calling Feedback"];
    const csvContent = headers.join(",") + "\n" + headers.map(() => "").join(",") + "\n";
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "calling_data_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  // ── Reset ───────────────────────────────────────────────────────────────────

  const reset = useCallback(() => {
    setStep("upload");
    setFile(null);
    setFileHeaders([]);
    setRawRows([]);
    setMapping({} as never);
    setMappedRows([]);
    setImportResult(null);
    setMappingCollapsed(false);
    setBatchFeedback("");
  }, []);

  // ── Step Progress ────────────────────────────────────────────────────────────

  const stepIndex = step === "upload" ? 0 : step === "mapping" ? 1 : step === "preview" || step === "submitting" ? 2 : 3;
  const STEPS = ["Upload File", "Map Columns", "Review & Edit", "Done"];

  const StepBar = () => stepIndex > 0 ? (
    <div className="mb-4 flex items-center gap-1">
      {STEPS.map((label, i) => (
        <div key={label} className="flex items-center gap-1 flex-1">
          <div className={`flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold transition-colors ${
            i < stepIndex ? "bg-emerald-500 text-white" : i === stepIndex ? "bg-slate-900 text-white" : "bg-slate-200 text-slate-400"
          }`}>{i < stepIndex ? "✓" : i + 1}</div>
          <span className={`text-[10px] font-bold ${i === stepIndex ? "text-slate-900" : "text-slate-400"}`}>{label}</span>
          {i < STEPS.length - 1 && <div className={`ml-1 h-px flex-1 ${i < stepIndex ? "bg-emerald-300" : "bg-slate-200"}`} />}
        </div>
      ))}
    </div>
  ) : null;

  // ── Session Lock Guard ──────────────────────────────────────────────────────

  if (!sessionLocked) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-amber-200 bg-amber-50 p-10 text-center">
        <AlertTriangle className="h-8 w-8 text-amber-500 mb-3" />
        <p className="text-sm font-bold text-amber-800">Lock session context first</p>
        <p className="mt-1 text-xs text-amber-600">Set Process, Source, and Position above before uploading calling data.</p>
      </div>
    );
  }

  // ── Render: Upload Step ─────────────────────────────────────────────────────

  if (step === "upload") {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="text-base font-black text-slate-950">Bulk Calling Data Upload</div>
            <div className="mt-0.5 text-xs text-slate-500">Upload a CSV or Excel file with candidate data. Headers will be auto-mapped.</div>
          </div>
          <Button variant="outline" size="sm" onClick={downloadTemplate} className="gap-1.5">
            <Download className="h-3.5 w-3.5" />
            Sample Template
          </Button>
        </div>

        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-12 transition-all duration-200 ${
            dragOver ? "border-sky-400 bg-sky-50 scale-[1.01] shadow-lg" : "border-slate-300 bg-slate-50 hover:border-slate-400 hover:bg-slate-100 hover:shadow-sm"
          }`}
        >
          <div className={`mb-3 rounded-full p-3 transition-colors ${dragOver ? "bg-sky-100" : "bg-slate-100"}`}>
            <Upload className={`h-8 w-8 transition-colors ${dragOver ? "text-sky-500" : "text-slate-400"}`} />
          </div>
          <p className="text-sm font-bold text-slate-700">Drop your file here or click to browse</p>
          <p className="mt-1 text-xs text-slate-500">Supports .csv, .xlsx, .xls — any column order</p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          className="hidden"
          onChange={handleFileInput}
        />
      </section>
    );
  }

  // ── Render: Mapping Step ────────────────────────────────────────────────────

  if (step === "mapping" || (step === "preview" && !mappingCollapsed)) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
        <StepBar />
        <div className="flex items-center justify-between">
          <div>
            <div className="text-base font-black text-slate-950">Map Your Columns</div>
            <div className="mt-0.5 text-xs text-slate-500">
              File: <span className="font-bold">{file?.name}</span> — {rawRows.length} rows detected
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={reset} className="text-slate-500">
            <XCircle className="h-3.5 w-3.5 mr-1" /> Start Over
          </Button>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="grid grid-cols-2 gap-3">
            {CALLING_TARGET_FIELDS.map((field) => {
              const isRequired = REQUIRED_CALLING_FIELDS.includes(field);
              const isMapped = !!mapping[field];
              return (
                <div key={field} className="flex items-center gap-3">
                  <div className="w-40 shrink-0">
                    <span className={`text-xs font-bold ${isRequired && !isMapped ? "text-rose-600" : "text-slate-700"}`}>
                      {CALLING_FIELD_LABELS[field]}
                      {isRequired && <span className="text-rose-500 ml-0.5">*</span>}
                    </span>
                  </div>
                  <select
                    value={mapping[field] ?? ""}
                    onChange={(e) => setMapping((prev) => ({ ...prev, [field]: e.target.value || null }))}
                    className={`h-8 w-full rounded-lg border px-2 text-xs font-medium ${
                      isMapped ? "border-green-300 bg-green-50 text-green-800" : "border-slate-200 bg-white text-slate-600"
                    }`}
                  >
                    <option value="">— Not mapped —</option>
                    {fileHeaders.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                  {isMapped && <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />}
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between pt-2">
          {!requiredMapped && (
            <p className="text-xs font-bold text-rose-600">Map required fields (Name, Mobile) to continue</p>
          )}
          <div className="ml-auto">
            <Button onClick={confirmMapping} disabled={!requiredMapped} className="gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Confirm Mapping &amp; Preview
            </Button>
          </div>
        </div>
      </section>
    );
  }

  // ── Render: Preview Step ────────────────────────────────────────────────────

  if (step === "preview" || step === "submitting") {
    const validCount = mappedRows.filter((r) => r._valid).length;
    const invalidCount = mappedRows.length - validCount;
    const noFeedbackCount = mappedRows.filter((r) => r._valid && !r.recruiter_remarks).length;

    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
        <StepBar />
        {/* Collapsed mapping toggle */}
        <button
          type="button"
          onClick={() => setMappingCollapsed(false)}
          className="flex items-center gap-2 text-xs font-bold text-sky-600 hover:text-sky-800"
        >
          {mappingCollapsed ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
          {mappingCollapsed ? "Show Column Mapping" : "Hide Column Mapping"}
        </button>

        {/* Summary bar */}
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5">
          <FileSpreadsheet className="h-4 w-4 text-slate-500" />
          <span className="text-xs font-bold text-slate-700">{mappedRows.length} rows total</span>
          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">{validCount} valid</Badge>
          {invalidCount > 0 && <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200">{invalidCount} errors</Badge>}
          {noFeedbackCount > 0 && <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">{noFeedbackCount} no feedback</Badge>}

          <div className="ml-auto flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase text-slate-500">Apply to all:</span>
            <select
              value={batchFeedback}
              onChange={(e) => applyBatchFeedback(e.target.value)}
              className="h-7 rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700"
            >
              <option value="">— Select —</option>
              {bootstrap.options.callingOutcomeOptions.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Data table */}
        <div className="max-h-[420px] overflow-auto rounded-xl border border-slate-200">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-slate-100 border-b border-slate-200">
              <tr>
                <th className="px-2 py-2 text-left font-bold text-slate-600 w-8">#</th>
                <th className="px-2 py-2 text-left font-bold text-slate-600">Name</th>
                <th className="px-2 py-2 text-left font-bold text-slate-600 w-28">Mobile</th>
                <th className="px-2 py-2 text-left font-bold text-slate-600">Email</th>
                <th className="px-2 py-2 text-left font-bold text-slate-600 w-20">Gender</th>
                <th className="px-2 py-2 text-left font-bold text-slate-600">Education</th>
                <th className="px-2 py-2 text-left font-bold text-slate-600">Location</th>
                <th className="px-2 py-2 text-left font-bold text-slate-600 w-44">Calling Feedback</th>
                <th className="px-2 py-2 text-left font-bold text-slate-600 w-16">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {mappedRows.map((row, idx) => (
                <tr key={idx} className={`transition-colors ${!row._valid ? "bg-rose-50/50" : row.recruiter_remarks ? "hover:bg-slate-50" : "bg-amber-50/30 hover:bg-amber-50/50"}`}>
                  <td className="px-2 py-1.5 text-slate-400 font-mono">{idx + 1}</td>
                  <td className="px-2 py-1.5 font-medium text-slate-900 max-w-[140px] truncate">{row.candidate_name || <span className="text-rose-400 italic">missing</span>}</td>
                  <td className="px-2 py-1.5 font-mono text-slate-700">{row.mobile || <span className="text-rose-400 italic">invalid</span>}</td>
                  <td className="px-2 py-1.5 text-slate-600 max-w-[120px] truncate">{row.candidate_email || "—"}</td>
                  <td className="px-2 py-1.5 text-slate-600">{row.gender || "—"}</td>
                  <td className="px-2 py-1.5 text-slate-600 max-w-[100px] truncate">{row.education_qualification || "—"}</td>
                  <td className="px-2 py-1.5 text-slate-600 max-w-[100px] truncate">{row.candidate_location || "—"}</td>
                  <td className="px-2 py-1.5">
                    <select
                      value={row.recruiter_remarks}
                      onChange={(e) => updateRowFeedback(idx, e.target.value)}
                      disabled={!row._valid}
                      className={`h-6 w-full rounded border px-1.5 text-xs font-medium text-slate-700 disabled:opacity-40 ${
                        row._valid && !row.recruiter_remarks ? "border-rose-400 bg-rose-50" : "border-slate-200 bg-white"
                      }`}
                    >
                      <option value="">— Select —</option>
                      {bootstrap.options.callingOutcomeOptions.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    {row._valid ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                    ) : (
                      <span title={row._errors.join(", ")}><XCircle className="h-3.5 w-3.5 text-rose-500" /></span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between pt-2">
          <Button variant="ghost" size="sm" onClick={reset} className="text-slate-500">
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Start Over
          </Button>
          <div className="flex items-center gap-3">
            {noFeedbackCount > 0 && (
              <p className="text-xs font-bold text-rose-600">
                <AlertTriangle className="inline h-3 w-3 mr-1" />
                {noFeedbackCount} row(s) need Calling Feedback before import
              </p>
            )}
            <Button
              onClick={() => void handleSubmit()}
              disabled={step === "submitting" || validCount === 0 || noFeedbackCount > 0}
              className="gap-1.5"
            >
              {step === "submitting" ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  Importing…
                </>
              ) : (
                <>
                  <Upload className="h-3.5 w-3.5" />
                  Import {validCount} Rows
                </>
              )}
            </Button>
          </div>
        </div>
      </section>
    );
  }

  // ── Render: Done Step ───────────────────────────────────────────────────────

  if (step === "done" && importResult) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
        <StepBar />
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-6 w-6 text-green-500" />
          <div>
            <div className="text-base font-black text-slate-950">Import Complete</div>
            <div className="text-xs text-slate-500">{file?.name}</div>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-center">
            <div className="text-lg font-black text-slate-900">{importResult.totalRows}</div>
            <div className="text-[10px] font-bold uppercase text-slate-500">Total</div>
          </div>
          <div className="rounded-xl border border-green-200 bg-green-50 p-3 text-center">
            <div className="text-lg font-black text-green-700">{importResult.insertedRows}</div>
            <div className="text-[10px] font-bold uppercase text-green-600">Inserted</div>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-center">
            <div className="text-lg font-black text-amber-700">{importResult.duplicateRows}</div>
            <div className="text-[10px] font-bold uppercase text-amber-600">Duplicates</div>
          </div>
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-center">
            <div className="text-lg font-black text-rose-700">{importResult.failedRows}</div>
            <div className="text-[10px] font-bold uppercase text-rose-600">Failed</div>
          </div>
        </div>

        {importResult.errors.length > 0 && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
            <div className="mb-2 text-xs font-bold text-rose-700">Errors ({importResult.errors.length})</div>
            <div className="max-h-32 overflow-auto space-y-1">
              {importResult.errors.map((err, i) => (
                <div key={i} className="text-xs text-rose-600">
                  <span className="font-mono font-bold">Row {err.row_number}:</span> {err.error_message}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end pt-2">
          <Button onClick={reset} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" />
            Upload Another File
          </Button>
        </div>
      </section>
    );
  }

  return null;
}
