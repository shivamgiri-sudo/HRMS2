import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Upload, XCircle } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";

// ── CSV Template ──────────────────────────────────────────────────────────────
const CSV_COLUMNS = [
  { key: "employee_code",      label: "Employee Code",      required: true,  example: "MAS0001",                           note: "Must match HRMS employee code exactly" },
  { key: "official_email",     label: "Official Email",     required: true,  example: "john.doe@teammas.in",               note: "Must be @teammas.in or @teammas.co.in" },
  { key: "domain_account",     label: "Domain Account",     required: true,  example: "john.d",                            note: "AD login username (without domain)" },
  { key: "asset_tag",          label: "Asset Tag",          required: false, example: "LAP-0042",                          note: "Laptop / device asset tag from inventory" },
  { key: "biometric_enrolled", label: "Biometric Enrolled", required: false, example: "yes",                              note: "yes / no — biometric attendance enrolled" },
  { key: "id_card_printed",    label: "ID Card Printed",    required: false, example: "yes",                              note: "yes / no — employee ID card issued" },
];

const SAMPLE_ROWS = [
  ["MAS0001", "john.doe@teammas.in",    "john.d",    "LAP-0042", "yes", "yes"],
  ["MAS0002", "priya.sharma@teammas.in","priya.s",   "LAP-0043", "yes", "no"],
  ["MAS0003", "rahul.kumar@teammas.in", "rahul.k",   "",         "no",  "no"],
];

function buildCsvTemplate(): string {
  const header = CSV_COLUMNS.map(c => c.key).join(",");
  const rows   = SAMPLE_ROWS.map(r => r.join(","));
  return [header, ...rows].join("\n");
}

function downloadCsv(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
// ── Tab: Bulk Upload ──────────────────────────────────────────────────────────

type ParsedRow = {
  employee_code: string;
  official_email: string;
  domain_account: string;
  asset_tag: string;
  biometric_enrolled: string;
  id_card_printed: string;
  _rowNum: number;
  _errors: string[];
};

type SyncResult = {
  employee_code: string;
  employee_name?: string;
  status: "updated" | "task_completed" | "skipped" | "error";
  actions: string[];
  message?: string;
};

function validateRow(row: ParsedRow): string[] {
  const errs: string[] = [];
  if (!row.employee_code.trim()) errs.push("employee_code is required");
  if (!row.official_email.trim()) errs.push("official_email is required");
  else if (!/^[^\s@]+@(teammas\.in|teammas\.co\.in)$/i.test(row.official_email.trim()))
    errs.push("email must be @teammas.in or @teammas.co.in");
  if (!row.domain_account.trim()) errs.push("domain_account is required");
  return errs;
}

export function BulkUploadTab() {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [parseError, setParseError] = useState("");
  const [results, setResults] = useState<SyncResult[] | null>(null);
  const [fileName, setFileName] = useState("");

  function resetFile() {
    setRows([]); setParseError(""); setResults(null); setFileName("");
    if (fileRef.current) fileRef.current.value = "";
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    resetFile();
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target?.result as string;
      try {
        const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) { setParseError("File must have a header row and at least one data row."); return; }
        const header = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/\s+/g, "_"));
        const idx = (col: string) => header.indexOf(col);
        if (idx("employee_code") === -1) { setParseError("Column 'employee_code' not found. Check header row."); return; }
        const parsed: ParsedRow[] = lines.slice(1).map((line, i) => {
          // Handle quoted fields
          const cols = line.split(",").map(c => c.trim().replace(/^"|"$/g, ""));
          const get = (col: string) => { const j = idx(col); return j >= 0 ? (cols[j] ?? "").trim() : ""; };
          const row: ParsedRow = {
            employee_code:      get("employee_code"),
            official_email:     get("official_email"),
            domain_account:     get("domain_account"),
            asset_tag:          get("asset_tag"),
            biometric_enrolled: get("biometric_enrolled"),
            id_card_printed:    get("id_card_printed"),
            _rowNum: i + 2,
            _errors: [],
          };
          row._errors = validateRow(row);
          return row;
        });
        setRows(parsed);
      } catch {
        setParseError("Failed to parse file. Ensure it is a valid CSV.");
      }
    };
    reader.readAsText(file);
  }

  const validRows   = rows.filter(r => r._errors.length === 0);
  const invalidRows = rows.filter(r => r._errors.length > 0);

  const uploadMutation = useMutation({
    mutationFn: async () => {
      const payload = validRows.map(r => ({
        employee_code:      r.employee_code,
        official_email:     r.official_email,
        domain_account:     r.domain_account,
        asset_tag:          r.asset_tag || undefined,
        biometric_enrolled: r.biometric_enrolled || undefined,
        id_card_printed:    r.id_card_printed || undefined,
      }));
      return hrmsApi.post<{ success: boolean; processed: number; completed: number; updated: number; errors: number; results: SyncResult[] }>(
        "/api/it-provisioning/bulk-sync",
        { rows: payload },
      );
    },
    onSuccess: (res: any) => {
      const r = res as { completed?: number; updated?: number; processed?: number; errors?: number; results?: SyncResult[] };
      const updated = (Number(r.completed) || 0) + (Number(r.updated) || 0);
      toast.success(`Sync complete: ${updated} employees updated, ${Number(r.errors) || 0} errors`);
      setResults(r.results ?? []);
      queryClient.invalidateQueries({ queryKey: ["reference-dashboard-it-full"] });
      queryClient.invalidateQueries({ queryKey: ["reference-dashboard-it-provisioning"] });
    },
    onError: (err: any) => toast.error(err?.message ?? "Upload failed"),
  });

  const resultCompleted = (results ?? []).filter(r => r.status === "task_completed").length;
  const resultUpdated   = (results ?? []).filter(r => r.status === "updated").length;
  const resultErrors    = (results ?? []).filter(r => r.status === "error").length;

  return (
    <div className="space-y-5">
      {/* Format guide */}
      <div className="rounded-2xl border border-[#edf1f6] bg-white overflow-hidden">
        <div className="flex items-center justify-between border-b border-[#edf1f6] px-5 py-3">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-[#3b82f6]" />
            <h3 className="text-sm font-bold text-[#0b1f44]">CSV Format Guide</h3>
          </div>
          <button
            onClick={() => downloadCsv(buildCsvTemplate(), "it_bulk_upload_template.csv")}
            className="inline-flex items-center gap-2 rounded-lg bg-[#3b82f6] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#2563eb] transition-colors"
          >
            <Download className="h-3.5 w-3.5" /> Download Template
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[#edf1f6] bg-[#f8fafc] text-[10px] font-semibold uppercase tracking-wider text-[#a0aec0]">
                <th className="px-4 py-2.5 text-left">Column</th>
                <th className="px-4 py-2.5 text-left">Required</th>
                <th className="px-4 py-2.5 text-left">Example Value</th>
                <th className="px-4 py-2.5 text-left">Notes</th>
              </tr>
            </thead>
            <tbody>
              {CSV_COLUMNS.map(col => (
                <tr key={col.key} className="border-b border-[#f8fafc]">
                  <td className="px-4 py-2 font-mono font-semibold text-[#0b1f44]">{col.key}</td>
                  <td className="px-4 py-2">
                    {col.required
                      ? <span className="inline-flex rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700">Required</span>
                      : <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">Optional</span>}
                  </td>
                  <td className="px-4 py-2 font-mono text-[#61708a]">{col.example}</td>
                  <td className="px-4 py-2 text-[#61708a]">{col.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-[#edf1f6] bg-[#fffbeb] px-5 py-3">
          <p className="text-xs text-amber-700">
            <strong>Important:</strong> This upload works for <em>all active employees</em> — whether or not they have a pending provisioning task.
            If a pending IT provisioning task exists it will be automatically marked completed.
            Employees already provisioned will have their records updated silently.
          </p>
        </div>
      </div>

      {/* Upload area */}
      <div className="rounded-2xl border border-[#edf1f6] bg-white p-5 space-y-4">
        <h3 className="text-sm font-bold text-[#0b1f44]">Upload IT Data</h3>

        <label className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-8 cursor-pointer transition-colors ${rows.length > 0 ? "border-[#3b82f6] bg-blue-50/40" : "border-[#e2e8f0] bg-[#f8fafc] hover:border-[#3b82f6] hover:bg-blue-50/30"}`}>
          <Upload className={`h-8 w-8 mb-2 ${rows.length > 0 ? "text-[#3b82f6]" : "text-[#a0aec0]"}`} />
          {fileName
            ? <p className="text-sm font-semibold text-[#0b1f44]">{fileName}</p>
            : <p className="text-sm font-semibold text-[#0b1f44]">Click to choose a CSV file</p>}
          <p className="text-xs text-[#a0aec0] mt-1">or drag and drop · .csv files only</p>
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
        </label>

        {parseError && (
          <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <XCircle className="h-4 w-4 shrink-0" /> {parseError}
          </div>
        )}

        {rows.length > 0 && !results && (
          <>
            {/* Stats row */}
            <div className="flex flex-wrap gap-3">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                {rows.length} rows total
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" /> {validRows.length} valid
              </span>
              {invalidRows.length > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">
                  <XCircle className="h-3.5 w-3.5" /> {invalidRows.length} with errors
                </span>
              )}
            </div>

            {/* Preview table */}
            <div className="rounded-xl border border-[#edf1f6] overflow-hidden">
              <div className="overflow-x-auto max-h-72">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-[#f8fafc] z-10">
                    <tr className="border-b border-[#edf1f6] text-[10px] font-semibold uppercase tracking-wider text-[#a0aec0]">
                      <th className="px-3 py-2.5 text-left">Row</th>
                      <th className="px-3 py-2.5 text-left">Employee Code</th>
                      <th className="px-3 py-2.5 text-left">Official Email</th>
                      <th className="px-3 py-2.5 text-left">Domain Account</th>
                      <th className="px-3 py-2.5 text-left">Asset Tag</th>
                      <th className="px-3 py-2.5 text-left">Biometric</th>
                      <th className="px-3 py-2.5 text-left">ID Card</th>
                      <th className="px-3 py-2.5 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r._rowNum} className={`border-b ${r._errors.length > 0 ? "bg-red-50/40" : "hover:bg-[#f8fafc]"}`}>
                        <td className="px-3 py-2 text-[#a0aec0]">{r._rowNum}</td>
                        <td className="px-3 py-2 font-mono font-semibold text-[#0b1f44]">{r.employee_code || <span className="text-red-400">—</span>}</td>
                        <td className="px-3 py-2 font-mono text-[#61708a]">{r.official_email || <span className="text-[#a0aec0]">—</span>}</td>
                        <td className="px-3 py-2 font-mono text-[#61708a]">{r.domain_account || <span className="text-[#a0aec0]">—</span>}</td>
                        <td className="px-3 py-2 text-[#61708a]">{r.asset_tag || <span className="text-[#a0aec0]">—</span>}</td>
                        <td className="px-3 py-2 text-[#61708a] capitalize">{r.biometric_enrolled || <span className="text-[#a0aec0]">—</span>}</td>
                        <td className="px-3 py-2 text-[#61708a] capitalize">{r.id_card_printed || <span className="text-[#a0aec0]">—</span>}</td>
                        <td className="px-3 py-2">
                          {r._errors.length === 0
                            ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700"><CheckCircle2 className="h-3 w-3" /> Valid</span>
                            : (
                              <div className="space-y-0.5">
                                {r._errors.map((err, ei) => (
                                  <div key={ei} className="flex items-center gap-1 text-[10px] text-red-600">
                                    <XCircle className="h-3 w-3 shrink-0" /> {err}
                                  </div>
                                ))}
                              </div>
                            )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {invalidRows.length > 0 && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5">
                {invalidRows.length} row{invalidRows.length > 1 ? "s" : ""} with errors will be skipped. Fix the CSV and re-upload, or proceed with {validRows.length} valid rows only.
              </p>
            )}

            <div className="flex items-center justify-between pt-1">
              <button onClick={resetFile} className="text-xs text-[#61708a] underline hover:text-[#0b1f44]">Clear and start over</button>
              <button
                disabled={validRows.length === 0 || uploadMutation.isPending}
                onClick={() => uploadMutation.mutate()}
                className="inline-flex items-center gap-2 rounded-xl bg-[#0b1f44] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#1a3060] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {uploadMutation.isPending
                  ? <><span className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" /> Uploading…</>
                  : <><Upload className="h-4 w-4" /> Upload {validRows.length} Employee{validRows.length !== 1 ? "s" : ""}</>}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Results */}
      {results && (
        <div className="rounded-2xl border border-[#edf1f6] bg-white overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#edf1f6] px-5 py-3">
            <h3 className="text-sm font-bold text-[#0b1f44]">Upload Results</h3>
            <div className="flex gap-2">
              {resultCompleted > 0 && <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">{resultCompleted} tasks completed</span>}
              {resultUpdated   > 0 && <span className="inline-flex rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">{resultUpdated} records updated</span>}
              {resultErrors    > 0 && <span className="inline-flex rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700">{resultErrors} errors</span>}
            </div>
          </div>
          <div className="overflow-x-auto max-h-96">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[#f8fafc] z-10">
                <tr className="border-b border-[#edf1f6] text-[10px] font-semibold uppercase tracking-wider text-[#a0aec0]">
                  <th className="px-4 py-2.5 text-left">Code</th>
                  <th className="px-4 py-2.5 text-left">Employee</th>
                  <th className="px-4 py-2.5 text-left">Result</th>
                  <th className="px-4 py-2.5 text-left">Actions Taken</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => {
                  const statusInfo = {
                    task_completed: { cls: "bg-emerald-50 text-emerald-700", icon: <CheckCircle2 className="h-3 w-3" />, label: "Task Completed" },
                    updated:        { cls: "bg-blue-50 text-blue-700",     icon: <CheckCircle2 className="h-3 w-3" />, label: "Updated" },
                    skipped:        { cls: "bg-slate-100 text-slate-500",  icon: <AlertTriangle className="h-3 w-3" />, label: "Skipped" },
                    error:          { cls: "bg-red-50 text-red-700",       icon: <XCircle className="h-3 w-3" />, label: "Error" },
                  }[r.status] ?? { cls: "bg-slate-100 text-slate-500", icon: null, label: r.status };
                  return (
                    <tr key={i} className="border-b border-[#f8fafc] hover:bg-[#f8fafc]">
                      <td className="px-4 py-2.5 font-mono font-semibold text-[#0b1f44]">{r.employee_code}</td>
                      <td className="px-4 py-2.5 text-[#61708a]">{r.employee_name ?? "—"}</td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusInfo.cls}`}>
                          {statusInfo.icon} {statusInfo.label}
                        </span>
                        {r.message && <p className="mt-0.5 text-[10px] text-red-500">{r.message}</p>}
                      </td>
                      <td className="px-4 py-2.5">
                        {r.actions.length > 0
                          ? <ul className="space-y-0.5">{r.actions.map((a, ai) => <li key={ai} className="text-[10px] text-[#61708a]">· {a}</li>)}</ul>
                          : <span className="text-[#a0aec0]">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="border-t border-[#edf1f6] px-5 py-3 flex justify-between items-center">
            <p className="text-xs text-[#61708a]">Upload complete. The Employee IT Directory tab will reflect updated data.</p>
            <button onClick={resetFile} className="text-xs text-[#3b82f6] font-semibold hover:underline">Upload another file</button>
          </div>
        </div>
      )}
    </div>
  );
}
