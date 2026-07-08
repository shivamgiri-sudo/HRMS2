import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Download, Loader2, Plus, RefreshCw, Upload } from "lucide-react";

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { hrmsApi } from "@/lib/hrmsApi";

type QueueItem = {
  id: string;
  batch_id: string;
  employee_id: string;
  item_status: string;
  error_count: number;
  validation_errors: string | null;
  validation_warnings: string | null;
  epfo_uan_assigned: string | null;
  epfo_member_id_assigned: string | null;
  employee_code: string;
  full_name: string;
  date_of_joining: string | null;
  uan_masked: string | null;
  aadhaar_masked: string | null;
  pan_masked: string | null;
  basic_wage: number | null;
  pf_wage: number | null;
  pf_applicable: number;
  previous_pf_member: number;
  previous_eps_member: number;
  bank_verification_status: string | null;
  pan_verification_status: string | null;
  uan_verification_status: string | null;
  branch_name: string | null;
  process_name: string | null;
  batch_number: string | null;
};

type ReadinessRow = {
  branch_name: string | null;
  process_name: string | null;
  total_employees: number;
  pf_ready: number;
  pf_pending: number;
  pf_not_applicable: number;
  pf_error: number;
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  validation_failed: "Validation Failed",
  pending_uan: "Pending UAN",
  pending_review: "Pending Review",
  ready_for_epfo: "Ready for EPFO",
  exported: "Exported",
  uploaded: "Uploaded",
  pf_created: "PF Created",
  rejected_by_epfo: "Rejected by EPFO",
  correction_required: "Correction Required",
  closed: "Closed",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600",
  validation_failed: "bg-red-50 text-red-700",
  ready_for_epfo: "bg-emerald-50 text-emerald-700",
  exported: "bg-blue-50 text-blue-700",
  pf_created: "bg-green-50 text-green-800",
  rejected_by_epfo: "bg-red-100 text-red-800",
  correction_required: "bg-amber-50 text-amber-700",
};

function statusBadge(status: string) {
  const cls = STATUS_COLORS[status] ?? "bg-slate-100 text-slate-600";
  return (
    <span className={`inline-block rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${cls}`}>
      {STATUS_LABELS[status] ?? status.replace(/_/g, " ")}
    </span>
  );
}

function verifyBadge(status: string | null) {
  if (!status) return <span className="text-xs text-slate-400">N/A</span>;
  if (status === "verified") return <span className="text-xs font-bold text-emerald-600">Verified</span>;
  if (status === "failed") return <span className="text-xs font-bold text-red-600">Failed</span>;
  return <span className="text-xs text-amber-600">{status}</span>;
}

export default function PfCreationQueuePage() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [readiness, setReadiness] = useState<ReadinessRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [search, setSearch] = useState("");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = {};
      if (statusFilter) params.status = statusFilter;
      if (search) params.search = search;
      const qs = new URLSearchParams(params).toString();
      const [queueRes, readinessRes] = await Promise.all([
        hrmsApi.get<{ data: { items: QueueItem[]; total: number } }>(`/api/payroll/pf/queue${qs ? `?${qs}` : ""}`),
        hrmsApi.get<{ data: ReadinessRow[] }>("/api/payroll/pf/reports/readiness"),
      ]);
      setItems(queueRes.data?.items ?? []);
      setTotal(queueRes.data?.total ?? 0);
      setReadiness(readinessRes.data ?? []);
    } catch (err: any) {
      setError(err?.message || "Unable to load PF creation queue.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [statusFilter]);

  const generateBatch = async () => {
    setBusy("generate");
    try {
      await hrmsApi.post("/api/payroll/pf/queue/generate-from-joiners", {});
      await load();
    } catch (err: any) {
      setError(err?.message || "Failed to generate batch.");
    } finally {
      setBusy(null);
    }
  };

  const validateBatch = async (batchId: string) => {
    setBusy("validate");
    try {
      await hrmsApi.post("/api/payroll/pf/validate", { batchId });
      await load();
    } catch (err: any) {
      setError(err?.message || "Validation failed.");
    } finally {
      setBusy(null);
    }
  };

  const exportBatch = async (batchId: string) => {
    setBusy("export");
    try {
      const res = await hrmsApi.post<{ data: { columns: Array<{ key: string; label: string }>; rows: Array<Record<string, unknown>>; exported_count: number } }>("/api/payroll/pf/export", { batchId });
      const data = res.data;
      if (data?.rows && data.columns) {
        const header = data.columns.map((c) => c.label).join(",");
        const csvRows = data.rows.map((r) => data.columns.map((c) => `"${String(r[c.key] ?? "").replace(/"/g, '""')}"`).join(","));
        const csv = [header, ...csvRows].join("\n");
        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `pf-export-${batchId.slice(0, 8)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      }
      await load();
    } catch (err: any) {
      setError(err?.message || "Export failed.");
    } finally {
      setBusy(null);
    }
  };

  const uniqueBatchIds = [...new Set(items.map((i) => i.batch_id).filter(Boolean))];

  const readinessTotals = readiness.reduce(
    (acc, r) => ({
      total: acc.total + r.total_employees,
      ready: acc.ready + r.pf_ready,
      pending: acc.pending + r.pf_pending,
      na: acc.na + r.pf_not_applicable,
      error: acc.error + r.pf_error,
    }),
    { total: 0, ready: 0, pending: 0, na: 0, error: 0 },
  );

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-slate-50 p-4 sm:p-6">
        <div className="mx-auto max-w-7xl space-y-5">
          {/* Header */}
          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.22em] text-blue-600">EPF Automation</p>
                <h1 className="mt-2 text-2xl font-black text-slate-900">PF Creation Queue</h1>
                <p className="mt-1 text-sm text-slate-500">
                  Generate batches from approved joiners, validate, export for EPFO, and import acknowledgements.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 self-start">
                <Button type="button" variant="outline" className="min-h-[44px] gap-2" onClick={() => void load()}>
                  <RefreshCw className="h-4 w-4" /> Refresh
                </Button>
                <Button type="button" className="min-h-[44px] gap-2 bg-blue-600 text-white hover:bg-blue-700" onClick={generateBatch} disabled={busy === "generate"}>
                  {busy === "generate" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Generate from Joiners
                </Button>
              </div>
            </div>
          </div>

          {/* Readiness Summary */}
          {readinessTotals.total > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <div className="rounded-2xl border bg-white p-4 text-center">
                <p className="text-2xl font-black text-slate-900">{readinessTotals.total}</p>
                <p className="text-xs text-slate-500">Total</p>
              </div>
              <div className="rounded-2xl border bg-emerald-50 p-4 text-center">
                <p className="text-2xl font-black text-emerald-700">{readinessTotals.ready}</p>
                <p className="text-xs text-emerald-600">PF Ready</p>
              </div>
              <div className="rounded-2xl border bg-amber-50 p-4 text-center">
                <p className="text-2xl font-black text-amber-700">{readinessTotals.pending}</p>
                <p className="text-xs text-amber-600">Pending</p>
              </div>
              <div className="rounded-2xl border bg-slate-50 p-4 text-center">
                <p className="text-2xl font-black text-slate-600">{readinessTotals.na}</p>
                <p className="text-xs text-slate-500">Not Applicable</p>
              </div>
              <div className="rounded-2xl border bg-red-50 p-4 text-center">
                <p className="text-2xl font-black text-red-700">{readinessTotals.error}</p>
                <p className="text-xs text-red-600">Errors</p>
              </div>
            </div>
          )}

          {/* Batch Actions */}
          {uniqueBatchIds.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="mb-2 text-xs font-bold uppercase text-slate-500">Batch Actions</p>
              <div className="flex flex-wrap gap-2">
                {uniqueBatchIds.map((bId) => (
                  <div key={bId} className="flex items-center gap-2 rounded-xl border px-3 py-2">
                    <span className="text-xs font-mono text-slate-600">{items.find((i) => i.batch_id === bId)?.batch_number ?? bId.slice(0, 8)}</span>
                    <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => validateBatch(bId)} disabled={!!busy}>
                      <CheckCircle2 className="h-3 w-3" /> Validate
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => exportBatch(bId)} disabled={!!busy}>
                      <Download className="h-3 w-3" /> Export
                    </Button>
                    <Button asChild size="sm" variant="outline" className="h-7 gap-1 text-xs">
                      <Link to={`/payroll/pf-batches?batchId=${bId}`}>
                        <Upload className="h-3 w-3" /> Details
                      </Link>
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              placeholder="Search employee..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void load()}
              className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-blue-500"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none"
            >
              <option value="">All statuses</option>
              {Object.entries(STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <span className="ml-auto text-xs text-slate-500">{total} items</span>
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p className="font-semibold">{error}</p>
              </div>
            </div>
          )}

          {/* Table */}
          {loading ? (
            <div className="flex h-64 items-center justify-center rounded-[28px] border bg-white">
              <Loader2 className="h-7 w-7 animate-spin text-slate-400" />
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-[28px] border bg-white p-12 text-center text-slate-500">
              No items in the PF creation queue. Click "Generate from Joiners" to populate.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-[28px] border border-slate-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="border-b bg-slate-50 text-xs font-bold uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Employee</th>
                    <th className="px-4 py-3">Branch / Process</th>
                    <th className="px-4 py-3">DOJ</th>
                    <th className="px-4 py-3">UAN</th>
                    <th className="px-4 py-3">Aadhaar</th>
                    <th className="px-4 py-3">PAN</th>
                    <th className="px-4 py-3">Bank</th>
                    <th className="px-4 py-3">Basic Wage</th>
                    <th className="px-4 py-3">EPS</th>
                    <th className="px-4 py-3">Errors</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {items.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <p className="font-bold text-slate-900">{item.full_name}</p>
                        <p className="text-xs text-slate-500">{item.employee_code}</p>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {item.branch_name ?? "—"}<br />{item.process_name ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-xs">{item.date_of_joining ? new Date(item.date_of_joining).toLocaleDateString("en-IN") : "—"}</td>
                      <td className="px-4 py-3 text-xs font-mono">
                        {item.epfo_uan_assigned ?? item.uan_masked ?? <span className="text-amber-600">Pending</span>}
                      </td>
                      <td className="px-4 py-3 text-xs font-mono">{item.aadhaar_masked ?? "—"}</td>
                      <td className="px-4 py-3">{verifyBadge(item.pan_verification_status)}</td>
                      <td className="px-4 py-3">{verifyBadge(item.bank_verification_status)}</td>
                      <td className="px-4 py-3 text-xs">{item.basic_wage ? `₹${Number(item.basic_wage).toLocaleString("en-IN")}` : "—"}</td>
                      <td className="px-4 py-3 text-xs">{item.previous_eps_member ? "Yes" : "No"}</td>
                      <td className="px-4 py-3">
                        {item.error_count > 0 ? (
                          <span className="font-bold text-red-600">{item.error_count}</span>
                        ) : (
                          <span className="text-emerald-600">0</span>
                        )}
                      </td>
                      <td className="px-4 py-3">{statusBadge(item.item_status)}</td>
                      <td className="px-4 py-3">
                        <Link to={`/employees/${item.employee_id}/epf-compliance`} className="text-xs font-bold text-blue-600 hover:underline">
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
