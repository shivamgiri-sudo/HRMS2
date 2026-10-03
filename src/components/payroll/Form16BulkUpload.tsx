import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, FileUp, Loader2, ShieldCheck, TriangleAlert } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Button } from "@/components/ui/button";

/** Indian financial years, newest completed first (FY 2025-26 ends 31 Mar 2026). */
export function financialYearOptions(now = new Date(), count = 4): string[] {
  const y = now.getFullYear();
  const lastCompletedStart = now.getMonth() >= 3 ? y - 1 : y - 2; // Apr (month 3) onward: previous FY is complete
  return Array.from({ length: count }, (_, i) => {
    const start = lastCompletedStart - i;
    return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
  });
}

type Outcome = "ready" | "uploaded" | "duplicate" | "no_pan" | "not_pdf" | "too_large" | "no_employee" | "ambiguous" | "out_of_scope" | "failed";
interface Row { filename: string; outcome: Outcome; label: string; employee_code?: string; employee_name?: string }
interface Result { mode: "preview" | "commit"; financial_year: string; summary: Record<string, number>; results: Row[] }

const GOOD: Outcome[] = ["ready", "uploaded"];
const CHIP: Record<string, string> = {
  good: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warn: "border-amber-200 bg-amber-50 text-amber-800",
  bad: "border-red-200 bg-red-50 text-red-800",
};
const tone = (o: Outcome) => (GOOD.includes(o) ? "good" : o === "duplicate" ? "warn" : "bad");

/**
 * HR / payroll upload the Form 16 PDFs issued by TRACES. Each file is matched to an employee by the PAN in
 * its file name; a preview shows exactly what would happen before anything is saved. The in-app Part B
 * summary is not the statutory certificate, so this is the route for the official one.
 */
export function Form16BulkUpload() {
  const years = useMemo(() => financialYearOptions(), []);
  const [fy, setFy] = useState(years[0]);
  const [files, setFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<Result | null>(null);
  const [done, setDone] = useState<Result | null>(null);
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const reset = () => { setPreview(null); setDone(null); setError(""); };

  const run = async (mode: "preview" | "commit") => {
    setBusy(mode); setError("");
    try {
      const form = new FormData();
      form.append("financial_year", fy);
      form.append("mode", mode);
      files.forEach((f) => form.append("files", f));
      const res = await hrmsApi.postForm<{ data: Result }>("/api/employee-docs/form16/bulk", form);
      if (mode === "preview") { setPreview(res.data); setDone(null); }
      else {
        setDone(res.data); setPreview(null); setFiles([]);
        if (input.current) input.current.value = "";
        toast.success(`${res.data.summary.uploaded ?? 0} Form 16 file(s) uploaded`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(null);
    }
  };

  const shown = done ?? preview;
  const ready = preview?.summary.ready ?? 0;

  return (
    <section aria-labelledby="f16-title" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 text-blue-600" aria-hidden />
        <div>
          <h2 id="f16-title" className="text-base font-bold text-slate-900">Upload Form 16 (TRACES)</h2>
          <p className="text-sm text-slate-600">
            Upload the certificates issued by TRACES. Name each file with the employee's PAN (for example
            <span className="font-mono"> ABCDE1234F_{fy}.pdf</span>). Employees will see and download their own.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-700">Financial year</span>
          <select className="h-10 rounded-md border bg-white px-3 text-sm" value={fy}
            onChange={(e) => { setFy(e.target.value); reset(); }}>
            {years.map((y) => <option key={y} value={y}>FY {y}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-700">PDF files (up to 50)</span>
          <input ref={input} type="file" accept="application/pdf,.pdf" multiple className="block text-sm"
            onChange={(e) => { setFiles(Array.from(e.target.files ?? [])); reset(); }} />
        </label>
        <Button type="button" disabled={!files.length || busy !== null} onClick={() => void run("preview")}>
          {busy === "preview" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileUp className="mr-2 h-4 w-4" />}
          Check {files.length ? `${files.length} file${files.length === 1 ? "" : "s"}` : "files"}
        </Button>
        {preview && (
          <Button type="button" variant="default" className="bg-emerald-600 hover:bg-emerald-700"
            disabled={ready === 0 || busy !== null} onClick={() => void run("commit")}>
            {busy === "commit" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
            Upload {ready} matched file{ready === 1 ? "" : "s"}
          </Button>
        )}
      </div>

      {error && <p role="alert" className="mt-3 flex items-center gap-2 text-sm text-red-700"><TriangleAlert className="h-4 w-4" />{error}</p>}

      {shown && (
        <div className="mt-4" aria-live="polite">
          <p className="mb-2 text-sm font-semibold text-slate-800">
            {shown.mode === "commit"
              ? `${shown.summary.uploaded ?? 0} of ${shown.summary.total} uploaded for FY ${shown.financial_year}.`
              : `${ready} of ${shown.summary.total} ready for FY ${shown.financial_year}. Nothing is saved until you upload.`}
          </p>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr><th className="px-3 py-2">File</th><th className="px-3 py-2">Employee</th><th className="px-3 py-2">Result</th></tr>
              </thead>
              <tbody>
                {shown.results.map((r, i) => (
                  <tr key={`${r.filename}-${i}`} className="border-t">
                    <td className="max-w-[260px] truncate px-3 py-2 font-mono text-xs" title={r.filename}>{r.filename}</td>
                    <td className="px-3 py-2">{r.employee_name ? `${r.employee_name} (${r.employee_code})` : "—"}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full border px-2 py-0.5 text-xs ${CHIP[tone(r.outcome)]}`}>{r.label}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
