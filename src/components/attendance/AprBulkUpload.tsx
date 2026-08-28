import React, { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Upload, Download, CheckCircle2, XCircle, AlertCircle } from "lucide-react";

interface UploadResult {
  uploaded: number;
  skipped_locked: number;
  errors: Array<{ row: number; employee_code: string; reason: string }>;
}

const REQUIRED_COLUMNS = ["employee_code", "attendance_date", "net_login_minutes"];

const SAMPLE_CSV = `employee_code,attendance_date,net_login_minutes
MAS001,01-06-2026,490
MAS002,01-06-2026,250
MAS003,01-06-2026,0`;

const ACCEPTED_EXTENSIONS = [".csv", ".xlsx", ".xls"];

function isAcceptedFile(name: string): boolean {
  const lower = name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function isExcelFile(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(".xlsx") || lower.endsWith(".xls");
}

/**
 * Formats one attendance_date cell into a form the backend's parseCsv accepts
 * (DD-MM-YYYY or YYYY-MM-DD).
 *
 * A genuine Excel date cell comes through `sheet_to_json({raw:true})` as a plain
 * serial number, regardless of how the cell is displayed — `raw:false` was tried
 * first and rejected: it formats using the cell's OWN number format, and an
 * author's real spreadsheet (unlike a freshly-built one with no format set) very
 * often carries a locale default like `m/d/yy`, which `dateNF` cannot override
 * once the cell already has a `.z` format. That produced "6/1/26" — a shape the
 * backend does not parse — which is why this reads raw and converts explicitly
 * with SSF.parse_date_code instead of trusting the display string.
 *
 * A text cell (someone typed the date rather than letting Excel format it) is
 * passed through only lightly normalised — a `/`-separated date becomes
 * `-`-separated, since that is the one difference between a common alternate
 * typing and what the backend already accepts. Anything else is left as-is, so a
 * genuinely malformed date still reaches the backend's own clear per-row error
 * ("attendance_date must be DD-MM-YYYY") naming the row and the bad value, rather
 * than being silently mangled here.
 */
function normaliseExcelDateCell(raw: unknown): string {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const d = XLSX.SSF.parse_date_code(raw);
    if (d && Number.isFinite(d.y) && Number.isFinite(d.m) && Number.isFinite(d.d)) {
      const mm = String(d.m).padStart(2, "0");
      const dd = String(d.d).padStart(2, "0");
      return `${d.y}-${mm}-${dd}`;
    }
  }
  return String(raw ?? "").trim().replace(/\//g, "-");
}

/**
 * Turns a parsed sheet (header row + data rows, as `sheet_to_json({header:1})`
 * returns) into the CSV text the backend route already parses. Split out from
 * `excelFileToCsvText` so it can be unit-tested directly against plain arrays,
 * without needing a real workbook or the File/ArrayBuffer plumbing around it.
 *
 * Column order is read from the header row, not assumed by position — the backend
 * route does the same (`header.indexOf('employee_code')`, etc.), so a reordered
 * sheet is accepted here exactly as it would be as a CSV.
 */
export function sheetRowsToCsvText(rows: unknown[][]): string {
  if (rows.length === 0) throw new Error("The sheet is empty.");

  const headerRow = (rows[0] ?? []).map((h) => String(h ?? "").trim().toLowerCase());
  const colIndex: Record<string, number> = {};
  for (const col of REQUIRED_COLUMNS) colIndex[col] = headerRow.indexOf(col);
  const missing = REQUIRED_COLUMNS.filter((col) => colIndex[col] === -1);
  if (missing.length > 0) {
    throw new Error(
      `The sheet's header row must contain: ${REQUIRED_COLUMNS.join(", ")}. Missing: ${missing.join(", ")}.`,
    );
  }

  const csvLines = [REQUIRED_COLUMNS.join(",")];
  for (const row of rows.slice(1)) {
    if (!row || row.every((cell) => String(cell ?? "").trim() === "")) continue;
    const values = REQUIRED_COLUMNS.map((col) => {
      const cell = row[colIndex[col]!];
      return col === "attendance_date" ? normaliseExcelDateCell(cell) : String(cell ?? "").trim();
    });
    csvLines.push(values.join(","));
  }

  if (csvLines.length === 1) throw new Error("No data rows found below the header.");
  return csvLines.join("\n");
}

/**
 * The server route this posts to is deliberately CSV-only — multer's fileFilter
 * rejects anything else with a clear "save as CSV" message (see
 * attendance-apr-bulk.routes.ts), and that contract is tested and left alone here.
 * Excel support is added at this layer instead: convert the workbook's first sheet
 * to CSV, client-side, before the file ever reaches the network. A parsing failure
 * here is caught and shown before any upload is attempted, rather than surfacing
 * as a server error.
 */
export async function excelFileToCsvText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(new Uint8Array(buffer), { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) throw new Error("The workbook has no sheets.");
  const sheet = workbook.Sheets[firstSheetName];
  // raw: true — see normaliseExcelDateCell for why a formatted read is not used.
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    blankrows: false,
  });
  return sheetRowsToCsvText(rows);
}

export function AprBulkUpload() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);

  function downloadSample() {
    const blob = new Blob([SAMPLE_CSV], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "apr_attendance_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function pickFile(candidate: File | null) {
    if (candidate && !isAcceptedFile(candidate.name)) {
      setApiError("Only CSV or Excel (.xlsx/.xls) files are accepted.");
      return;
    }
    setApiError(null);
    setResult(null);
    setFile(candidate);
  }

  async function handleUpload() {
    if (!file) return;
    setLoading(true);
    setResult(null);
    setApiError(null);

    try {
      let csvBlob: Blob;
      if (isExcelFile(file.name)) {
        const csvText = await excelFileToCsvText(file);
        csvBlob = new Blob([csvText], { type: "text/csv" });
      } else {
        csvBlob = file;
      }

      const formData = new FormData();
      // Always uploaded under a .csv filename: the server route reads CSV only,
      // and this is the same file whether it started as .csv or was just converted
      // from Excel above.
      formData.append("file", csvBlob, file.name.replace(/\.(xlsx|xls)$/i, ".csv"));

      const res = await fetch("/api/wfm/attendance/apr-bulk-upload", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${localStorage.getItem("hrms_access_token") ?? ""}`,
        },
        body: formData,
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message ?? "Upload failed");
      setResult(json);
    } catch (err) {
      setApiError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h3 className="text-sm font-semibold text-slate-700">APR / Dialler Attendance Bulk Upload</h3>
        <Button variant="ghost" size="sm" onClick={downloadSample} className="text-xs text-blue-600 gap-1">
          <Download className="w-3 h-3" /> Download Template
        </Button>
      </div>

      <p className="text-xs text-slate-500">
        Use this to manually upload dialler login data for Operations Executive employees when APR auto-sync is missing.
        CSV or Excel (.xlsx/.xls) — the header row must contain <strong>employee_code, attendance_date, net_login_minutes</strong> in any order.
        Date format: <strong>DD-MM-YYYY</strong> (e.g. 14-07-2026). Same classification rules apply: ≥480 min = Present, &gt;240 min = Half-Day, ≤240 min = Absent.
        Locked records are automatically skipped.
      </p>

      <div
        className="border-2 border-dashed border-slate-200 rounded-lg p-6 text-center cursor-pointer hover:border-blue-400 transition-colors"
        onClick={() => fileRef.current?.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={e => {
          e.preventDefault();
          pickFile(e.dataTransfer.files[0] ?? null);
        }}
      >
        <Upload className="w-6 h-6 text-slate-400 mx-auto mb-2" />
        {file ? (
          <p className="text-sm font-medium text-slate-700">{file.name}</p>
        ) : (
          <p className="text-sm text-slate-400">Click or drag CSV or Excel file here</p>
        )}
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPTED_EXTENSIONS.join(",")}
          className="hidden"
          onChange={e => pickFile(e.target.files?.[0] ?? null)}
        />
      </div>

      <Button
        onClick={handleUpload}
        disabled={!file || loading}
        className="w-full"
        size="sm"
      >
        {loading ? "Uploading..." : "Upload APR Data"}
      </Button>

      {apiError && (
        <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded p-3">
          <XCircle className="w-4 h-4 shrink-0" />
          {apiError}
        </div>
      )}

      {result && (
        <div className="space-y-3">
          <div className="flex gap-3 flex-wrap">
            <Badge className="bg-green-100 text-green-700 gap-1">
              <CheckCircle2 className="w-3 h-3" /> {result.uploaded} uploaded
            </Badge>
            {result.skipped_locked > 0 && (
              <Badge className="bg-amber-100 text-amber-700 gap-1">
                <AlertCircle className="w-3 h-3" /> {result.skipped_locked} skipped (locked)
              </Badge>
            )}
            {result.errors.length > 0 && (
              <Badge className="bg-red-100 text-red-700 gap-1">
                <XCircle className="w-3 h-3" /> {result.errors.length} errors
              </Badge>
            )}
          </div>

          {result.errors.length > 0 && (
            <div className="bg-red-50 rounded p-3 max-h-48 overflow-y-auto">
              <p className="text-xs font-semibold text-red-700 mb-2">Row Errors</p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-red-600">
                    <th className="text-left pr-3">Row</th>
                    <th className="text-left pr-3">Employee Code</th>
                    <th className="text-left">Reason</th>
                  </tr>
                </thead>
                <tbody className="text-red-700">
                  {result.errors.map((e, i) => (
                    <tr key={i} className="border-t border-red-100">
                      <td className="pr-3 py-1">{e.row}</td>
                      <td className="pr-3 py-1">{e.employee_code || "-"}</td>
                      <td className="py-1">{e.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
