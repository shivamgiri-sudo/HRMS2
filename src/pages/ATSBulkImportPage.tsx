import { useState, useRef } from "react";
import { Upload, FileText, CheckCircle2, AlertTriangle, XCircle, Download, RefreshCw } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { HrmsModernShell } from "@/components/ui/hrms-modern";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { hrmsApi } from "@/lib/hrmsApi";
import { toast } from "sonner";

// ── Types ──────────────────────────────────────────────────────────────────────

interface PreviewResult {
  totalRows: number;
  columns: string[];
  previewRows: Record<string, string>[];
  validationSummary: {
    errors: number;
    warnings: number;
    sampleErrors: string[];
  };
}

interface ImportSummary {
  totalRows: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
}

interface ImportError {
  row: number;
  candidateId: string;
  field: string;
  message: string;
}

interface ImportWarning {
  row: number;
  candidateId: string;
  message: string;
}

interface ImportResult {
  dryRun: boolean;
  summary: ImportSummary;
  errors: ImportError[];
  warnings: ImportWarning[];
}

type Step = "upload" | "previewing" | "preview" | "importing" | "done";

// ── Column Mapping Display ─────────────────────────────────────────────────────

const COLUMN_MAP: Record<string, string> = {
  CandidateID: "candidate_code",
  FullName: "full_name",
  Mobile: "mobile",
  Email: "email",
  Gender: "gender",
  CreatedDate: "created_at (date)",
  CreatedTime: "created_at (time)",
  Branch: "applied_for_branch",
  RoleApplied: "applied_for_process",
  Process: "applied_for_process",
  "Walk-in EndStage": "current_stage",
  Status: "current_stage (fallback)",
  RecruiterAssignedName: "assigned_recruiter_id (lookup)",
  RecruiterEmail: "assigned_recruiter_id (lookup)",
  Round1_Result: "ats_interview_result (Round1)",
  SkillTest_Result: "ats_interview_result (SkillTest)",
  Round2_Result: "ats_interview_result (Round2)",
  Round3_Result: "ats_interview_result (Round3)",
  Offer_Salary: "ats_employment_offer.ctc",
  Offer_DOJ: "ats_employment_offer.date_of_joining",
};

function downloadErrorReport(errors: ImportError[], warnings: ImportWarning[]) {
  const lines = ["Row,CandidateID,Type,Field,Message"];
  for (const e of errors) lines.push(`${e.row},"${e.candidateId}","Error","${e.field}","${e.message}"`);
  for (const w of warnings) lines.push(`${w.row},"${w.candidateId}","Warning","","${w.message}"`);
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "import-errors.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function ATSBulkImportPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dryRun, setDryRun] = useState(true);
  const [step, setStep] = useState<Step>("upload");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = (file: File) => {
    setSelectedFile(file);
    setPreview(null);
    setResult(null);
    setStep("upload");
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const runPreview = async () => {
    if (!selectedFile) return;
    setStep("previewing");
    try {
      const fd = new FormData();
      fd.append("file", selectedFile);
      const res: any = await hrmsApi.postForm("/api/ats/bulk-import/preview", fd);
      const payload = res?.data ?? res;
      setPreview(payload);
      setStep("preview");
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? err?.message ?? "Failed to parse file");
      setStep("upload");
    }
  };

  const runImport = async () => {
    if (!selectedFile) return;
    setStep("importing");
    try {
      const fd = new FormData();
      fd.append("file", selectedFile);
      fd.append("dryRun", String(dryRun));
      const res: any = await hrmsApi.postForm("/api/ats/bulk-import/candidates", fd);
      const payload = res?.data ?? res;
      setResult(payload);
      setStep("done");
      if (!dryRun) toast.success(`Import complete — ${payload.summary.created} created, ${payload.summary.updated} updated`);
      else toast.info(`Dry run complete — ${payload.summary.created} would be created`);
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? err?.message ?? "Import failed");
      setStep("preview");
    }
  };

  const reset = () => {
    setSelectedFile(null);
    setPreview(null);
    setResult(null);
    setStep("upload");
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <DashboardLayout>
      <HrmsModernShell
        eyebrow="ATS"
        title="Bulk Candidate Import"
        description="Upload historical candidate registration data (TSV / CSV / XLSX) to import into the ATS system."
        icon={<Upload className="h-6 w-6" />}
        actions={
          step !== "upload" && (
            <Button variant="outline" onClick={reset} className="gap-2 min-h-[44px]">
              <RefreshCw className="h-4 w-4" /> Start Over
            </Button>
          )
        }
      >
        {/* ── Step 1: Upload ─────────────────────────────────────────────────── */}
        {(step === "upload" || step === "previewing") && (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Upload Data File</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Dropzone */}
                <div
                  className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 transition-colors cursor-pointer ${
                    dragOver ? "border-emerald-500 bg-emerald-50" : "border-slate-300 hover:border-slate-400 hover:bg-slate-50"
                  }`}
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  onClick={() => fileRef.current?.click()}
                >
                  <FileText className="h-10 w-10 text-slate-400 mb-3" />
                  {selectedFile ? (
                    <p className="font-medium text-slate-700">{selectedFile.name}</p>
                  ) : (
                    <>
                      <p className="font-medium text-slate-700">Drag & drop or click to browse</p>
                      <p className="text-sm text-slate-500 mt-1">Supports .csv, .tsv, .xlsx — max 20 MB</p>
                    </>
                  )}
                  <input
                    ref={fileRef}
                    type="file"
                    className="hidden"
                    accept=".csv,.tsv,.xlsx,.xls"
                    onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
                  />
                </div>

                {/* Options */}
                <div className="flex items-center gap-6 pt-2">
                  <div className="flex items-center gap-2">
                    <Checkbox id="dryRun" checked={dryRun} onCheckedChange={v => setDryRun(!!v)} />
                    <Label htmlFor="dryRun" className="cursor-pointer">
                      Dry Run <span className="text-slate-500 font-normal">(validate without saving)</span>
                    </Label>
                  </div>
                </div>

                <div className="flex gap-3">
                  <Button
                    onClick={runPreview}
                    disabled={!selectedFile || step === "previewing"}
                    className="min-h-[44px] gap-2"
                  >
                    {step === "previewing" ? (
                      <><RefreshCw className="h-4 w-4 animate-spin" /> Parsing…</>
                    ) : (
                      <><FileText className="h-4 w-4" /> Preview File</>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Column Mapping Reference */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm text-slate-600">Column Mapping Reference</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5 text-xs">
                  {Object.entries(COLUMN_MAP).map(([src, dst]) => (
                    <div key={src} className="flex items-center gap-1.5 rounded-md bg-slate-50 px-2 py-1.5">
                      <span className="font-mono text-slate-700 truncate">{src}</span>
                      <span className="text-slate-400 flex-shrink-0">→</span>
                      <span className="text-emerald-700 truncate">{dst}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ── Step 2: Preview ────────────────────────────────────────────────── */}
        {step === "preview" && preview && (
          <div className="space-y-4">
            {/* Summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card className="bg-slate-50">
                <CardContent className="pt-4">
                  <p className="text-xs text-slate-500">Total Rows</p>
                  <p className="text-2xl font-bold text-slate-800">{preview.totalRows}</p>
                </CardContent>
              </Card>
              <Card className="bg-slate-50">
                <CardContent className="pt-4">
                  <p className="text-xs text-slate-500">Columns Detected</p>
                  <p className="text-2xl font-bold text-slate-800">{preview.columns.length}</p>
                </CardContent>
              </Card>
              <Card className={preview.validationSummary.errors > 0 ? "bg-rose-50" : "bg-emerald-50"}>
                <CardContent className="pt-4">
                  <p className="text-xs text-slate-500">Validation Errors</p>
                  <p className="text-2xl font-bold">{preview.validationSummary.errors}</p>
                </CardContent>
              </Card>
              <Card className={preview.validationSummary.warnings > 0 ? "bg-amber-50" : "bg-slate-50"}>
                <CardContent className="pt-4">
                  <p className="text-xs text-slate-500">Warnings</p>
                  <p className="text-2xl font-bold">{preview.validationSummary.warnings}</p>
                </CardContent>
              </Card>
            </div>

            {/* Sample errors */}
            {preview.validationSummary.sampleErrors.length > 0 && (
              <Card className="border-rose-200">
                <CardContent className="pt-4">
                  <p className="text-sm font-semibold text-rose-700 mb-2">Sample Validation Errors (first 50 rows)</p>
                  <ul className="space-y-1">
                    {preview.validationSummary.sampleErrors.map((e, i) => (
                      <li key={i} className="text-xs text-rose-600 flex items-start gap-1.5">
                        <XCircle className="h-3 w-3 mt-0.5 flex-shrink-0" />{e}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {/* Data Preview Table */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm text-slate-600">Data Preview (first {preview.previewRows.length} rows)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 border-b">
                      <tr>
                        {["CandidateID","FullName","Mobile","Email","Branch","RoleApplied","Status","Walk-in EndStage","Round1_Result","FinalDecision"].map(col => (
                          <th key={col} className="px-3 py-2 text-left font-medium text-slate-600 whitespace-nowrap">{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {preview.previewRows.map((row, i) => (
                        <tr key={i} className="hover:bg-slate-50">
                          {["CandidateID","FullName","Mobile","Email","Branch","RoleApplied","Status","Walk-in EndStage","Round1_Result","FinalDecision"].map(col => (
                            <td key={col} className="px-3 py-2 text-slate-700 whitespace-nowrap max-w-[120px] truncate" title={row[col] ?? ""}>
                              {row[col] || <span className="text-slate-300">—</span>}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* Actions */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Checkbox id="dryRun2" checked={dryRun} onCheckedChange={v => setDryRun(!!v)} />
                <Label htmlFor="dryRun2" className="cursor-pointer">
                  Dry Run <span className="text-slate-500 font-normal">(validate without saving)</span>
                </Label>
              </div>
              <Button onClick={runImport} className="min-h-[44px] gap-2">
                <Upload className="h-4 w-4" />
                {dryRun ? "Run Dry Import" : `Import ${preview.totalRows} Records`}
              </Button>
              <Button variant="outline" onClick={reset} className="min-h-[44px]">Cancel</Button>
            </div>
          </div>
        )}

        {/* ── Step 3: Importing ──────────────────────────────────────────────── */}
        {step === "importing" && (
          <Card>
            <CardContent className="pt-8 pb-8 flex flex-col items-center gap-4">
              <RefreshCw className="h-10 w-10 text-slate-400 animate-spin" />
              <p className="text-lg font-semibold text-slate-700">
                {dryRun ? "Running dry import…" : "Importing candidates…"}
              </p>
              <p className="text-sm text-slate-500">This may take a moment for large files. Please wait.</p>
              <Progress value={undefined} className="w-48 h-2" />
            </CardContent>
          </Card>
        )}

        {/* ── Step 4: Results ────────────────────────────────────────────────── */}
        {step === "done" && result && (
          <div className="space-y-4">
            {/* Badge */}
            <div className="flex items-center gap-2">
              <Badge variant="outline" className={result.dryRun ? "bg-amber-100 text-amber-800 border-amber-300" : "bg-emerald-100 text-emerald-800 border-emerald-300"}>
                {result.dryRun ? "Dry Run" : "Live Import"}
              </Badge>
            </div>

            {/* Summary */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              {[
                { label: "Total Rows", value: result.summary.totalRows, cls: "bg-slate-50" },
                { label: "Created", value: result.summary.created, cls: "bg-emerald-50 text-emerald-800" },
                { label: "Updated", value: result.summary.updated, cls: "bg-sky-50 text-sky-800" },
                { label: "Skipped", value: result.summary.skipped, cls: "bg-slate-50 text-slate-600" },
                { label: "Errors", value: result.summary.errors, cls: result.summary.errors > 0 ? "bg-rose-50 text-rose-800" : "bg-slate-50" },
              ].map(tile => (
                <Card key={tile.label} className={tile.cls}>
                  <CardContent className="pt-4">
                    <p className="text-xs text-slate-500">{tile.label}</p>
                    <p className="text-2xl font-bold">{tile.value}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Success message */}
            {result.summary.errors === 0 && (
              <div className="flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 p-4">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 flex-shrink-0" />
                <p className="text-sm text-emerald-700">
                  {result.dryRun
                    ? `Dry run succeeded — ${result.summary.created} candidates would be created, ${result.summary.updated} updated.`
                    : `Import complete — ${result.summary.created} candidates created, ${result.summary.updated} updated.`}
                </p>
              </div>
            )}

            {/* Errors */}
            {result.errors.length > 0 && (
              <Card className="border-rose-200">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm text-rose-700 flex items-center gap-2">
                      <XCircle className="h-4 w-4" /> {result.errors.length} Errors
                    </CardTitle>
                    <Button size="sm" variant="outline" onClick={() => downloadErrorReport(result.errors, result.warnings)} className="min-h-[36px] gap-1.5 text-xs">
                      <Download className="h-3.5 w-3.5" /> Download Report
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-rose-50 border-b border-rose-100">
                        <tr>
                          {["Row","CandidateID","Field","Error"].map(h => (
                            <th key={h} className="px-3 py-2 text-left font-medium text-rose-700">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-rose-50">
                        {result.errors.slice(0, 100).map((e, i) => (
                          <tr key={i}>
                            <td className="px-3 py-2 text-slate-500">{e.row}</td>
                            <td className="px-3 py-2 font-mono text-slate-700">{e.candidateId}</td>
                            <td className="px-3 py-2 text-slate-600">{e.field}</td>
                            <td className="px-3 py-2 text-rose-600">{e.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {result.errors.length > 100 && <p className="text-xs text-slate-500 mt-2">Showing first 100 of {result.errors.length} errors. Download report for full list.</p>}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Warnings */}
            {result.warnings.length > 0 && (
              <Card className="border-amber-200">
                <CardHeader>
                  <CardTitle className="text-sm text-amber-700 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" /> {result.warnings.length} Warnings
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-amber-50 border-b border-amber-100">
                        <tr>
                          {["Row","CandidateID","Warning"].map(h => (
                            <th key={h} className="px-3 py-2 text-left font-medium text-amber-700">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-amber-50">
                        {result.warnings.slice(0, 50).map((w, i) => (
                          <tr key={i}>
                            <td className="px-3 py-2 text-slate-500">{w.row}</td>
                            <td className="px-3 py-2 font-mono text-slate-700">{w.candidateId}</td>
                            <td className="px-3 py-2 text-amber-700">{w.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Follow-up actions */}
            <div className="flex gap-3">
              {result.dryRun && (
                <Button onClick={() => { setDryRun(false); setStep("preview"); }} className="min-h-[44px] gap-2 bg-emerald-600 hover:bg-emerald-700">
                  <Upload className="h-4 w-4" /> Run Live Import
                </Button>
              )}
              <Button variant="outline" onClick={reset} className="min-h-[44px]">Import Another File</Button>
              {(result.errors.length > 0 || result.warnings.length > 0) && (
                <Button variant="outline" onClick={() => downloadErrorReport(result.errors, result.warnings)} className="min-h-[44px] gap-2">
                  <Download className="h-4 w-4" /> Download Full Report
                </Button>
              )}
            </div>
          </div>
        )}
      </HrmsModernShell>
    </DashboardLayout>
  );
}
