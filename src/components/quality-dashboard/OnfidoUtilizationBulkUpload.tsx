import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Upload, Download, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";

/**
 * "Onfido Utilization" bulk upload — feeds the Onfido Process Dashboard's Queue Wise panel
 * (Queue / Required HC / Active HC / Buffer % / Shortfall) directly from an uploaded sheet.
 *
 * SCAFFOLD NOTE: the column set below (upload_date, queue_name, approved_hc, required_hc,
 * active_hc, buffer_pct, shortfall) is modelled on the Queue Wise panel already shown in the
 * Onfido dashboard mock, because the real "Onfido Utilization" sheet referenced in the original
 * request was never attached to this change. If the real template uses different column names,
 * update REQUIRED_COLUMNS/OPTIONAL_COLUMNS here and the matching columns in
 * backend/src/modules/quality-dashboard/onfido-utilization.routes.ts and
 * backend/sql/1644_onfido_utilization_upload.sql together — all three read/write by column name.
 *
 * Static values only, matching the existing AprBulkUpload pattern: an .xlsx/.xls file is read
 * with `raw: true` and converted to plain CSV text client-side before it is ever posted, so a
 * cell that happens to contain a formula in the source workbook is read as its last computed
 * value, not as a formula — the upload can never carry a formula to the backend.
 *
 * Re-uploading the same date + queue overrides the existing row rather than creating a
 * duplicate — enforced server-side by an `ON DUPLICATE KEY UPDATE` keyed on the table's
 * UNIQUE KEY (upload_date, queue_name).
 */

interface UploadResult {
  uploaded: number;
  errors: Array<{ row: number; queue_name: string; reason: string }>;
}

const REQUIRED_COLUMNS = ["upload_date", "queue_name", "required_hc", "active_hc"];
const OPTIONAL_COLUMNS = ["approved_hc", "buffer_pct", "shortfall"];
const ALL_COLUMNS = [...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS];

const SAMPLE_CSV = `upload_date,queue_name,approved_hc,required_hc,active_hc,buffer_pct,shortfall
01-06-2026,Extraction Queue,55,66,60,9.1,0
01-06-2026,POA Queue,50,60,66,-,-
01-06-2026,Encord,-,-,-,-,-`;

const ACCEPTED_EXTENSIONS = [".csv", ".xlsx", ".xls"];

function isAcceptedFile(name: string): boolean {
  const lower = name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function isExcelFile(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(".xlsx") || lower.endsWith(".xls");
}

/** Same date-cell handling as AprBulkUpload's normaliseExcelDateCell — a genuine Excel date
 *  cell arrives as a serial number regardless of display format, so it is converted explicitly
 *  rather than trusting a locale-formatted display string. */
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

export function sheetRowsToCsvText(rows: unknown[][]): string {
  if (rows.length === 0) throw new Error("The sheet is empty.");

  const headerRow = (rows[0] ?? []).map((h) => String(h ?? "").trim().toLowerCase());
  const colIndex: Record<string, number> = {};
  for (const col of ALL_COLUMNS) colIndex[col] = headerRow.indexOf(col);
  const missing = REQUIRED_COLUMNS.filter((col) => colIndex[col] === -1);
  if (missing.length > 0) {
    throw new Error(
      `The sheet's header row must contain: ${REQUIRED_COLUMNS.join(", ")}. Missing: ${missing.join(", ")}.`,
    );
  }
  const presentColumns = ALL_COLUMNS.filter((col) => colIndex[col] !== -1);

  const csvLines = [presentColumns.join(",")];
  for (const row of rows.slice(1)) {
    if (!row || row.every((cell) => String(cell ?? "").trim() === "")) continue;
    const values = presentColumns.map((col) => {
      const cell = row[colIndex[col]!];
      return col === "upload_date" ? normaliseExcelDateCell(cell) : String(cell ?? "").trim();
    });
    csvLines.push(values.join(","));
  }

  if (csvLines.length === 1) throw new Error("No data rows found below the header.");
  return csvLines.join("\n");
}

export async function excelFileToCsvText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(new Uint8Array(buffer), { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) throw new Error("The workbook has no sheets.");
  const sheet = workbook.Sheets[firstSheetName];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, blankrows: false });
  return sheetRowsToCsvText(rows);
}

export function OnfidoUtilizationBulkUpload() {
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
    a.download = "onfido_utilization_template.csv";
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
      formData.append("file", csvBlob, file.name.replace(/\.(xlsx|xls)$/i, ".csv"));

      const res = await fetch("/api/quality-dashboard/onfido-utilization-bulk-upload", {
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
        <h3 className="text-sm font-semibold text-slate-700">Onfido Utilization Bulk Upload</h3>
        <Button variant="ghost" size="sm" onClick={downloadSample} className="text-xs text-blue-600 gap-1">
          <Download className="w-3 h-3" /> Download Template
        </Button>
      </div>

      <p className="text-xs text-slate-500">
        Weekly or daily queue-wise headcount for the Onfido process (Extraction Queue, POA Queue, Encord, etc.),
        feeding the dashboard&apos;s Queue Wise panel directly. CSV or Excel (.xlsx/.xls) — the header row must contain{" "}
        <strong>upload_date, queue_name, required_hc, active_hc</strong> (optionally <strong>approved_hc, buffer_pct, shortfall</strong>) in any order.
        Date format: <strong>DD-MM-YYYY</strong> or <strong>YYYY-MM-DD</strong>. The uploaded file must contain static values only — no formulas.
        Re-uploading the same date and queue replaces the existing row instead of creating a duplicate.
      </p>

      <div
        className="border-2 border-dashed border-slate-200 rounded-lg p-6 text-center cursor-pointer hover:border-blue-400 transition-colors"
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
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
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
        />
      </div>

      <Button onClick={handleUpload} disabled={!file || loading} className="w-full" size="sm">
        {loading ? "Uploading..." : "Upload Onfido Utilization"}
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
              <CheckCircle2 className="w-3 h-3" /> {result.uploaded} row(s) saved
            </Badge>
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
                    <th className="text-left pr-3">Queue</th>
                    <th className="text-left">Reason</th>
                  </tr>
                </thead>
                <tbody className="text-red-700">
                  {result.errors.map((e, i) => (
                    <tr key={i} className="border-t border-red-100">
                      <td className="pr-3 py-1">{e.row}</td>
                      <td className="pr-3 py-1">{e.queue_name || "-"}</td>
                      <td className="py-1">{e.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {result.errors.length === 0 && (
            <div className="flex items-center gap-2 text-sm text-slate-500 bg-slate-50 rounded p-3">
              <AlertCircle className="w-4 h-4 shrink-0 text-slate-400" />
              The dashboard&apos;s Queue Wise panel now reflects this upload for the date(s) submitted.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
