import React, { useRef, useState } from "react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Upload, Download, CheckCircle2, XCircle, AlertCircle } from "lucide-react";

interface UploadResult {
  uploaded: number;
  skipped_locked: number;
  errors: Array<{ row: number; employee_code: string; reason: string }>;
}

const SAMPLE_CSV = `employee_code,attendance_date,net_login_minutes
MAS001,2026-06-01,490
MAS002,2026-06-01,250
MAS003,2026-06-01,0`;

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

  async function handleUpload() {
    if (!file) return;
    setLoading(true);
    setResult(null);
    setApiError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

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
        Same classification rules apply: ≥480 min = Present, &gt;240 min = Half-Day, ≤240 min = Absent.
        Locked records are automatically skipped.
      </p>

      <div
        className="border-2 border-dashed border-slate-200 rounded-lg p-6 text-center cursor-pointer hover:border-blue-400 transition-colors"
        onClick={() => fileRef.current?.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={e => {
          e.preventDefault();
          const dropped = e.dataTransfer.files[0];
          if (dropped?.name.endsWith(".csv")) setFile(dropped);
        }}
      >
        <Upload className="w-6 h-6 text-slate-400 mx-auto mb-2" />
        {file ? (
          <p className="text-sm font-medium text-slate-700">{file.name}</p>
        ) : (
          <p className="text-sm text-slate-400">Click or drag CSV file here</p>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={e => setFile(e.target.files?.[0] ?? null)}
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
