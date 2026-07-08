import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, CheckCircle2, Download, FileSpreadsheet, Loader2, RefreshCw, Upload } from "lucide-react";
import * as XLSX from "xlsx";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { hrmsApi } from "@/lib/hrmsApi";

type Batch = {
  id: string;
  batch_number: string;
  status: string;
  total_items: number;
  valid_items: number;
  error_items: number;
  exported_at: string | null;
  uploaded_at: string | null;
  branch_name: string | null;
  establishment_name: string | null;
  created_by_name: string | null;
  created_at: string;
};

type BatchItem = {
  id: string;
  employee_id: string;
  employee_code: string;
  full_name: string;
  date_of_joining: string | null;
  item_status: string;
  error_count: number;
  validation_errors: string | null;
  uan_masked: string | null;
  aadhaar_masked: string | null;
  pan_masked: string | null;
  basic_wage: number | null;
  epfo_uan_assigned: string | null;
  epfo_member_id_assigned: string | null;
  epfo_response_message: string | null;
};

type BatchDetail = {
  batch: Batch;
  items: BatchItem[];
};

type AckRecord = {
  employee_code: string;
  uan_assigned: string;
  member_id: string;
  status: string;
  error_message: string;
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600",
  validating: "bg-blue-50 text-blue-700",
  validated: "bg-blue-100 text-blue-800",
  pending_review: "bg-amber-50 text-amber-700",
  approved: "bg-emerald-50 text-emerald-700",
  exported: "bg-indigo-50 text-indigo-700",
  uploaded_to_epfo: "bg-purple-50 text-purple-700",
  partial_success: "bg-amber-100 text-amber-800",
  completed: "bg-green-50 text-green-800",
  failed: "bg-red-100 text-red-800",
};

export default function PfBatchesPage() {
  const [searchParams] = useSearchParams();
  const focusBatchId = searchParams.get("batchId");

  const [batches, setBatches] = useState<Batch[]>([]);
  const [detail, setDetail] = useState<BatchDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [ackText, setAckText] = useState("");

  const loadBatches = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await hrmsApi.get<{ data: Batch[] }>("/api/payroll/pf/batches");
      setBatches(res.data ?? []);
      if (focusBatchId) {
        const detailRes = await hrmsApi.get<{ data: BatchDetail }>(`/api/payroll/pf/batches/${focusBatchId}`);
        setDetail(detailRes.data ?? null);
      }
    } catch (err: any) {
      setError(err?.message || "Unable to load batches.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadBatches(); }, [focusBatchId]);

  const openDetail = async (batchId: string) => {
    setBusy("detail");
    try {
      const res = await hrmsApi.get<{ data: BatchDetail }>(`/api/payroll/pf/batches/${batchId}`);
      setDetail(res.data ?? null);
    } catch (err: any) {
      setError(err?.message || "Unable to load batch detail.");
    } finally {
      setBusy(null);
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  const downloadAckTemplate = () => {
    const header = ["employee_code", "uan_assigned", "member_id", "status", "error_message"];
    const sampleRows = [
      ["EMP001", "123456789012", "PF/MH/54321/001", "success", ""],
      ["EMP002", "", "", "error", "Aadhaar name mismatch"],
    ];
    const ws = XLSX.utils.aoa_to_sheet([header, ...sampleRows]);
    ws["!cols"] = [{ wch: 16 }, { wch: 16 }, { wch: 24 }, { wch: 10 }, { wch: 40 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "EPFO_Acknowledgement");
    XLSX.writeFile(wb, `epfo-acknowledgement-template.xlsx`);
  };

  const parseAckFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });

        const headerRow = rows[0]?.map((h) => String(h).toLowerCase().trim()) ?? [];
        const codeIdx = headerRow.findIndex((h) => h.includes("employee") && h.includes("code")) >= 0
          ? headerRow.findIndex((h) => h.includes("employee") && h.includes("code"))
          : 0;
        const uanIdx = headerRow.findIndex((h) => h.includes("uan")) >= 0
          ? headerRow.findIndex((h) => h.includes("uan"))
          : 1;
        const memberIdx = headerRow.findIndex((h) => h.includes("member")) >= 0
          ? headerRow.findIndex((h) => h.includes("member"))
          : 2;
        const statusIdx = headerRow.findIndex((h) => h === "status" || h.includes("result")) >= 0
          ? headerRow.findIndex((h) => h === "status" || h.includes("result"))
          : 3;
        const errorIdx = headerRow.findIndex((h) => h.includes("error") || h.includes("message")) >= 0
          ? headerRow.findIndex((h) => h.includes("error") || h.includes("message"))
          : 4;

        const dataRows = rows.slice(1).filter((r) => r.length > 0 && String(r[codeIdx] ?? "").trim());
        const csvLines = dataRows.map((r) =>
          `${String(r[codeIdx] ?? "").trim()},${String(r[uanIdx] ?? "").trim()},${String(r[memberIdx] ?? "").trim()},${String(r[statusIdx] ?? "success").trim()},${String(r[errorIdx] ?? "").trim()}`
        );
        setAckText(csvLines.join("\n"));
      } catch {
        setError("Unable to parse the uploaded file. Ensure it is a valid XLSX/CSV.");
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) parseAckFile(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const importAck = async () => {
    if (!detail || !ackText.trim()) return;
    setBusy("import");
    setError(null);
    try {
      const lines = ackText.trim().split("\n").filter((l) => l.trim());
      const records: AckRecord[] = lines.map((line) => {
        const parts = line.split(",").map((s) => s.trim());
        return {
          employee_code: parts[0] || "",
          uan_assigned: parts[1] || "",
          member_id: parts[2] || "",
          status: parts[3] || "success",
          error_message: parts[4] || "",
        };
      });
      await hrmsApi.post("/api/payroll/pf/import-acknowledgement", {
        batchId: detail.batch.id,
        records,
      });
      setAckText("");
      await openDetail(detail.batch.id);
      await loadBatches();
    } catch (err: any) {
      setError(err?.message || "Import failed.");
    } finally {
      setBusy(null);
    }
  };

  if (detail) {
    return (
      <DashboardLayout>
        <div className="min-h-screen bg-slate-50 p-4 sm:p-6">
          <div className="mx-auto max-w-7xl space-y-5">
            <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-4">
                <Button variant="outline" size="sm" className="gap-1" onClick={() => setDetail(null)}>
                  <ArrowLeft className="h-4 w-4" /> Back
                </Button>
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.22em] text-blue-600">Batch Detail</p>
                  <h1 className="text-xl font-black text-slate-900">{detail.batch.batch_number}</h1>
                </div>
                <span className={`ml-auto rounded-full px-3 py-1 text-xs font-bold uppercase ${STATUS_COLORS[detail.batch.status] ?? "bg-slate-100"}`}>
                  {detail.batch.status.replace(/_/g, " ")}
                </span>
              </div>
              <div className="mt-4 grid gap-2 text-sm text-slate-600 sm:grid-cols-4">
                <p>Total: <strong>{detail.batch.total_items}</strong></p>
                <p>Valid: <strong className="text-emerald-700">{detail.batch.valid_items}</strong></p>
                <p>Errors: <strong className="text-red-600">{detail.batch.error_items}</strong></p>
                <p>Created: {new Date(detail.batch.created_at).toLocaleDateString("en-IN")}</p>
              </div>
            </div>

            {/* Import Acknowledgement */}
            {(detail.batch.status === "exported" || detail.batch.status === "uploaded_to_epfo") && (
              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-xs font-bold uppercase text-slate-500">Import EPFO Acknowledgement</p>
                    <p className="mt-1 text-xs text-slate-500">
                      Upload the EPFO response file (XLSX/CSV) or paste data manually below.
                    </p>
                  </div>
                  <Button type="button" variant="outline" size="sm" className="gap-1.5 text-xs" onClick={downloadAckTemplate}>
                    <FileSpreadsheet className="h-3.5 w-3.5" /> Download Template
                  </Button>
                </div>

                <div className="mb-3 flex items-center gap-3">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={handleFileUpload}
                    className="hidden"
                    id="ack-file-input"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="gap-2"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="h-4 w-4" /> Upload XLSX / CSV
                  </Button>
                  <span className="text-xs text-slate-400">or paste CSV below</span>
                </div>

                <textarea
                  value={ackText}
                  onChange={(e) => setAckText(e.target.value)}
                  rows={6}
                  placeholder={"employee_code, uan_assigned, member_id, status, error_message\nEMP001,123456789012,PF/MH/12345/001,success,\nEMP002,,,error,Name mismatch with EPFO"}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 font-mono text-xs outline-none focus:border-blue-500"
                />

                {ackText.trim() && (
                  <p className="mt-1 text-xs text-slate-500">
                    {ackText.trim().split("\n").filter((l) => l.trim()).length} record(s) ready to import
                  </p>
                )}

                <Button type="button" className="mt-3 gap-2 bg-blue-600 text-white hover:bg-blue-700" onClick={importAck} disabled={busy === "import" || !ackText.trim()}>
                  {busy === "import" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Import Acknowledgement
                </Button>
              </div>
            )}

            {error && (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                <AlertTriangle className="mr-2 inline h-4 w-4" />{error}
              </div>
            )}

            {/* Items Table */}
            <div className="overflow-x-auto rounded-[28px] border border-slate-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="border-b bg-slate-50 text-xs font-bold uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Employee</th>
                    <th className="px-4 py-3">DOJ</th>
                    <th className="px-4 py-3">UAN</th>
                    <th className="px-4 py-3">Errors</th>
                    <th className="px-4 py-3">EPFO UAN</th>
                    <th className="px-4 py-3">Member ID</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">EPFO Response</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {detail.items.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <Link to={`/employees/${item.employee_id}/epf-compliance`} className="font-bold text-blue-600 hover:underline">
                          {item.full_name}
                        </Link>
                        <p className="text-xs text-slate-500">{item.employee_code}</p>
                      </td>
                      <td className="px-4 py-3 text-xs">{item.date_of_joining ? new Date(item.date_of_joining).toLocaleDateString("en-IN") : "—"}</td>
                      <td className="px-4 py-3 text-xs font-mono">{item.uan_masked ?? "—"}</td>
                      <td className="px-4 py-3">
                        {item.error_count > 0 ? <span className="font-bold text-red-600">{item.error_count}</span> : <span className="text-emerald-600">0</span>}
                      </td>
                      <td className="px-4 py-3 text-xs font-mono font-bold text-emerald-700">{item.epfo_uan_assigned ?? "—"}</td>
                      <td className="px-4 py-3 text-xs font-mono">{item.epfo_member_id_assigned ?? "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_COLORS[item.item_status] ?? "bg-slate-100"}`}>
                          {item.item_status.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">{item.epfo_response_message ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-slate-50 p-4 sm:p-6">
        <div className="mx-auto max-w-7xl space-y-5">
          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.22em] text-blue-600">EPF Automation</p>
                <h1 className="mt-2 text-2xl font-black text-slate-900">PF Creation Batches</h1>
                <p className="mt-1 text-sm text-slate-500">View all PF creation batches, their status, and manage EPFO acknowledgement imports.</p>
              </div>
              <Button type="button" variant="outline" className="min-h-[44px] gap-2 self-start" onClick={() => void loadBatches()}>
                <RefreshCw className="h-4 w-4" /> Refresh
              </Button>
            </div>
          </div>

          {error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <AlertTriangle className="mr-2 inline h-4 w-4" />{error}
            </div>
          )}

          {loading ? (
            <div className="flex h-64 items-center justify-center rounded-[28px] border bg-white">
              <Loader2 className="h-7 w-7 animate-spin text-slate-400" />
            </div>
          ) : batches.length === 0 ? (
            <div className="rounded-[28px] border bg-white p-12 text-center text-slate-500">
              No PF creation batches yet. Generate one from the <Link to="/payroll/pf-creation-queue" className="text-blue-600 hover:underline">queue page</Link>.
            </div>
          ) : (
            <div className="grid gap-4">
              {batches.map((batch) => (
                <div key={batch.id} className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-lg font-black text-slate-900">{batch.batch_number}</h2>
                        <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${STATUS_COLORS[batch.status] ?? "bg-slate-100"}`}>
                          {batch.status.replace(/_/g, " ")}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-600">
                        <span>Total: <strong>{batch.total_items}</strong></span>
                        <span>Valid: <strong className="text-emerald-700">{batch.valid_items}</strong></span>
                        <span>Errors: <strong className="text-red-600">{batch.error_items}</strong></span>
                        {batch.branch_name && <span>Branch: {batch.branch_name}</span>}
                        {batch.establishment_name && <span>Est: {batch.establishment_name}</span>}
                        <span>Created: {new Date(batch.created_at).toLocaleDateString("en-IN")}</span>
                      </div>
                    </div>
                    <Button type="button" variant="outline" size="sm" className="gap-1 self-start" onClick={() => openDetail(batch.id)} disabled={busy === "detail"}>
                      {busy === "detail" ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                      View Details
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
