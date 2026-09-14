import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  RefreshCw, Search, AlertCircle, FileText, X, RotateCcw,
  CheckCircle2, Mail, Clock, Users, TrendingDown,
} from "lucide-react";
import { HrmsModernShell } from "@/components/ui/hrms-modern";
import { hrmsApi } from "@/lib/hrmsApi";
import RequestStatusBadge from "@/components/reports/RequestStatusBadge";

interface OverviewStats {
  total_all_time: number;
  today: number;
  queued: number;
  processing: number;
  emailed: number;
  failed: number;
  retried: number;
  unique_users: number;
  avg_generation_seconds: number | null;
  avg_delivery_seconds: number | null;
}

interface TopReport {
  report_code: string;
  report_name_snapshot: string;
  request_count: number;
}

interface ReportRequestRow {
  id: string;
  request_reference: string;
  report_code: string;
  report_name_snapshot: string;
  requested_by_employee_name: string;
  requested_by_employee_code: string;
  official_email: string;
  status: string;
  requested_at: string;
  generation_completed_at: string | null;
  email_sent_at: string | null;
  failed_at: string | null;
  failure_message: string | null;
  retry_count: number;
}

interface AuditEvent {
  id: number;
  event_type: string;
  event_status: string | null;
  activity_at: string;
  actor_type: string;
  actor_name: string | null;
  actor_role: string | null;
  message: string | null;
  error_code: string | null;
  error_detail: string | null;
}

interface RequestDetail extends ReportRequestRow {
  requested_filters_json: Record<string, unknown> | null;
  resolved_scope_json: Record<string, unknown> | null;
  audit_events: AuditEvent[];
  file?: {
    original_filename: string;
    file_size_bytes: number;
    generated_row_count: number;
    sha256_checksum: string;
    expires_at: string;
    deleted_at: string | null;
  };
  email_deliveries?: Array<{
    delivery_attempt_number: number;
    status: string;
    queued_at: string;
    sent_at: string | null;
    failed_at: string | null;
    failure_message: string | null;
  }>;
}

function formatTs(ts: string | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function KpiTile({ label, value, sub, color = "blue" }: { label: string; value: string | number; sub?: string; color?: string }) {
  const colors: Record<string, string> = {
    blue: "bg-blue-50 text-blue-700",
    emerald: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    red: "bg-red-50 text-red-700",
    slate: "bg-slate-50 text-slate-700",
  };
  return (
    <div className={`rounded-xl p-4 ${colors[color] ?? colors.slate}`}>
      <p className="text-[10px] font-bold uppercase tracking-wider opacity-70">{label}</p>
      <p className="text-2xl font-black mt-1">{value}</p>
      {sub && <p className="text-[10px] opacity-60 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function ReportAuditPage() {
  const [filters, setFilters] = useState({
    requestReference: "",
    reportCode: "",
    employeeCode: "",
    status: "",
    fromDate: "",
    toDate: "",
  });
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [retryReason, setRetryReason] = useState("");
  const [retryError, setRetryError] = useState("");
  const [retrying, setRetrying] = useState(false);
  const pageSize = 50;

  const statsQuery = useQuery({
    queryKey: ["report-audit-stats"],
    queryFn: () =>
      hrmsApi.get<{ success: boolean; data: { stats: OverviewStats; topReports: TopReport[] } }>(
        "/api/admin/report-requests/overview-stats"
      ),
    staleTime: 60_000,
  });

  const buildQs = () => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
    return params.toString();
  };

  const listQuery = useQuery({
    queryKey: ["report-audit-list", filters, page],
    queryFn: () =>
      hrmsApi.get<{ success: boolean; data: ReportRequestRow[]; total: number }>(
        `/api/admin/report-requests?${buildQs()}`
      ),
    staleTime: 30_000,
  });

  const detailQuery = useQuery({
    queryKey: ["report-audit-detail", selectedId],
    queryFn: () =>
      hrmsApi.get<{ success: boolean; data: RequestDetail }>(
        `/api/admin/report-requests/${selectedId}`
      ),
    enabled: !!selectedId,
    staleTime: 10_000,
  });

  const rows = listQuery.data?.data ?? [];
  const total = listQuery.data?.total ?? 0;
  const totalPages = Math.ceil(total / pageSize);
  const stats = statsQuery.data?.data?.stats;
  const topReports = statsQuery.data?.data?.topReports ?? [];
  const detail = detailQuery.data?.data;

  async function handleRetry() {
    if (!selectedId || !retryReason.trim()) {
      setRetryError("Please provide a retry reason.");
      return;
    }
    setRetrying(true);
    setRetryError("");
    try {
      await hrmsApi.post(`/api/admin/report-requests/${selectedId}/retry`, { reason: retryReason });
      setRetryReason("");
      detailQuery.refetch();
      listQuery.refetch();
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : "Retry failed");
    } finally {
      setRetrying(false);
    }
  }

  return (
    <HrmsModernShell
      eyebrow="REPORTS"
      title="Report Audit Trail"
      description="Complete organisation-wide audit trail for all report requests, generation, and email delivery events."
      icon={<FileText size={22} />}
    >
      <div className="space-y-6">

        {/* KPI tiles */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-3">
            <KpiTile label="Today" value={stats.today} color="blue" />
            <KpiTile label="Emailed" value={stats.emailed} color="emerald" />
            <KpiTile label="Queued" value={stats.queued} color="amber" />
            <KpiTile label="Failed" value={stats.failed} color="red" />
            <KpiTile label="Total (all time)" value={stats.total_all_time} color="slate" sub={`${stats.unique_users} unique users`} />
          </div>
        )}

        {/* Filters */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {[
            { key: "requestReference", placeholder: "Reference (RPT-…)" },
            { key: "reportCode", placeholder: "Report code" },
            { key: "employeeCode", placeholder: "Employee code" },
          ].map(f => (
            <input
              key={f.key}
              type="text"
              placeholder={f.placeholder}
              value={filters[f.key as keyof typeof filters]}
              onChange={e => setFilters(p => ({ ...p, [f.key]: e.target.value }))}
              className="h-9 text-xs border border-slate-200 rounded-lg px-3 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          ))}
          <select
            value={filters.status}
            onChange={e => setFilters(p => ({ ...p, status: e.target.value }))}
            className="h-9 text-xs border border-slate-200 rounded-lg px-3 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            <option value="">All statuses</option>
            {["REQUESTED","QUEUED","PROCESSING","GENERATED","EMAILED","DELIVERY_FAILED","GENERATION_FAILED","CANCELLED","EXPIRED"].map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <input type="date" value={filters.fromDate} onChange={e => setFilters(p => ({ ...p, fromDate: e.target.value }))} className="h-9 text-xs border border-slate-200 rounded-lg px-3 focus:outline-none focus:ring-2 focus:ring-blue-400" />
          <input type="date" value={filters.toDate} onChange={e => setFilters(p => ({ ...p, toDate: e.target.value }))} className="h-9 text-xs border border-slate-200 rounded-lg px-3 focus:outline-none focus:ring-2 focus:ring-blue-400" />
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => { setPage(1); listQuery.refetch(); }}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700"
          >
            <Search size={13} /> Search
          </button>
          <button
            type="button"
            onClick={() => { setFilters({ requestReference: "", reportCode: "", employeeCode: "", status: "", fromDate: "", toDate: "" }); setPage(1); }}
            className="px-3 py-2 text-xs font-semibold text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50"
          >
            Clear
          </button>
          <button type="button" onClick={() => listQuery.refetch()} className="ml-auto flex items-center gap-1 px-3 py-2 text-xs font-semibold text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50">
            <RefreshCw size={12} /> Refresh
          </button>
        </div>

        {/* Table */}
        {listQuery.isLoading && (
          <div className="flex items-center justify-center py-10 text-slate-400">
            <RefreshCw size={16} className="animate-spin mr-2" /> Loading…
          </div>
        )}
        {listQuery.error && (
          <div className="flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertCircle size={16} /> {listQuery.error instanceof Error ? listQuery.error.message : "Failed to load"}
          </div>
        )}
        {!listQuery.isLoading && rows.length === 0 && !listQuery.error && (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-2">
            <FileText size={36} className="opacity-30" />
            <p className="text-sm">No report requests match the current filters.</p>
          </div>
        )}
        {rows.length > 0 && (
          <div className="rounded-xl border border-slate-200 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-4 py-3 text-left font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">Reference</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-500 uppercase tracking-wider">Report</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-500 uppercase tracking-wider">Employee</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">Requested</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-500 uppercase tracking-wider">Email</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-500 uppercase tracking-wider">Retries</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => setSelectedId(row.id)}
                    className={`hover:bg-blue-50 cursor-pointer transition-colors ${selectedId === row.id ? "bg-blue-50" : ""}`}
                  >
                    <td className="px-4 py-3 font-mono font-semibold text-slate-700 whitespace-nowrap">{row.request_reference}</td>
                    <td className="px-4 py-3 text-slate-700 max-w-[160px] truncate" title={row.report_name_snapshot}>{row.report_name_snapshot}</td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                      <span className="font-semibold">{row.requested_by_employee_code}</span>
                      {row.requested_by_employee_name && <span className="text-slate-400 ml-1">— {row.requested_by_employee_name}</span>}
                    </td>
                    <td className="px-4 py-3"><RequestStatusBadge status={row.status} /></td>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{formatTs(row.requested_at)}</td>
                    <td className="px-4 py-3 text-slate-400 font-mono text-[10px]">{row.official_email}</td>
                    <td className="px-4 py-3 text-slate-500">{row.retry_count > 0 ? <span className="text-amber-600 font-semibold">{row.retry_count}</span> : "0"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2">
            <button type="button" disabled={page === 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1.5 text-xs font-semibold border border-slate-200 rounded-lg disabled:opacity-40">Previous</button>
            <span className="text-xs text-slate-500">Page {page} of {totalPages} ({total.toLocaleString()} requests)</span>
            <button type="button" disabled={page === totalPages} onClick={() => setPage(p => p + 1)} className="px-3 py-1.5 text-xs font-semibold border border-slate-200 rounded-lg disabled:opacity-40">Next</button>
          </div>
        )}
      </div>

      {/* Detail Drawer */}
      {selectedId && (
        <div className="fixed inset-y-0 right-0 w-full max-w-2xl bg-white shadow-2xl border-l border-slate-200 z-50 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50 shrink-0">
            <div>
              <p className="text-xs text-slate-500 font-bold uppercase tracking-widest">Request Detail</p>
              <p className="text-sm font-black text-slate-800 font-mono">{detail?.request_reference ?? "…"}</p>
            </div>
            <button type="button" onClick={() => setSelectedId(null)} className="p-1.5 rounded-lg hover:bg-slate-200 transition-colors">
              <X size={16} />
            </button>
          </div>

          <div className="overflow-y-auto flex-1 px-5 py-4 space-y-5">
            {detailQuery.isLoading && <div className="text-slate-400 text-sm">Loading detail…</div>}
            {detailQuery.error && <div className="text-red-600 text-sm">{detailQuery.error instanceof Error ? detailQuery.error.message : "Failed to load"}</div>}
            {detail && (
              <>
                {/* Status + key times */}
                <div className="flex items-center gap-3 flex-wrap">
                  <RequestStatusBadge status={detail.status} />
                  <span className="text-xs text-slate-500">Requested: {formatTs(detail.requested_at)}</span>
                  {detail.email_sent_at && <span className="text-xs text-emerald-600">Emailed: {formatTs(detail.email_sent_at)}</span>}
                  {detail.failed_at && <span className="text-xs text-red-600">Failed: {formatTs(detail.failed_at)}</span>}
                </div>

                {/* Requester */}
                <section>
                  <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Requester</h3>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div><span className="text-slate-400">Name</span><p className="font-semibold text-slate-700">{detail.requested_by_employee_name ?? "—"}</p></div>
                    <div><span className="text-slate-400">Code</span><p className="font-semibold text-slate-700 font-mono">{detail.requested_by_employee_code ?? "—"}</p></div>
                    <div className="col-span-2"><span className="text-slate-400">Official Email (authoritative)</span><p className="font-semibold text-slate-700 font-mono">{detail.official_email}</p></div>
                  </div>
                </section>

                {/* File metadata */}
                {detail.file && (
                  <section>
                    <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Generated File</h3>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div><span className="text-slate-400">Filename</span><p className="font-semibold text-slate-700 font-mono text-[10px] break-all">{detail.file.original_filename}</p></div>
                      <div><span className="text-slate-400">Size</span><p className="font-semibold text-slate-700">{(detail.file.file_size_bytes / 1024).toFixed(1)} KB</p></div>
                      <div><span className="text-slate-400">Rows</span><p className="font-semibold text-slate-700">{detail.file.generated_row_count?.toLocaleString()}</p></div>
                      <div><span className="text-slate-400">Expires</span><p className="font-semibold text-slate-700">{formatTs(detail.file.expires_at)}</p></div>
                      <div className="col-span-2"><span className="text-slate-400">SHA256</span><p className="font-mono text-[9px] text-slate-500 break-all">{detail.file.sha256_checksum}</p></div>
                    </div>
                  </section>
                )}

                {/* Failure info */}
                {detail.failure_message && (
                  <section>
                    <h3 className="text-[10px] font-bold uppercase tracking-widest text-red-400 mb-2">Failure</h3>
                    <p className="text-xs text-red-700 bg-red-50 rounded-lg px-3 py-2">{detail.failure_message}</p>
                  </section>
                )}

                {/* Retry for DELIVERY_FAILED */}
                {detail.status === "DELIVERY_FAILED" && !detail.file?.deleted_at && (
                  <section>
                    <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Retry Email Delivery</h3>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={retryReason}
                        onChange={e => setRetryReason(e.target.value)}
                        placeholder="Reason for retry (required)"
                        className="flex-1 h-9 text-xs border border-slate-200 rounded-lg px-3 focus:outline-none focus:ring-2 focus:ring-blue-400"
                      />
                      <button
                        type="button"
                        onClick={handleRetry}
                        disabled={retrying || !retryReason.trim()}
                        className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50"
                      >
                        <RotateCcw size={12} /> {retrying ? "Retrying…" : "Retry"}
                      </button>
                    </div>
                    {retryError && <p className="text-xs text-red-600 mt-1">{retryError}</p>}
                  </section>
                )}

                {/* Email deliveries */}
                {detail.email_deliveries && detail.email_deliveries.length > 0 && (
                  <section>
                    <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Email Delivery Attempts</h3>
                    <div className="space-y-2">
                      {detail.email_deliveries.map((d) => (
                        <div key={d.delivery_attempt_number} className="text-xs border border-slate-100 rounded-lg px-3 py-2">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold">Attempt #{d.delivery_attempt_number}</span>
                            <RequestStatusBadge status={d.status} />
                          </div>
                          {d.sent_at && <p className="text-slate-500 mt-0.5">Sent: {formatTs(d.sent_at)}</p>}
                          {d.failure_message && <p className="text-red-600 mt-0.5">{d.failure_message}</p>}
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Audit timeline */}
                {detail.audit_events && detail.audit_events.length > 0 && (
                  <section>
                    <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Audit Timeline ({detail.audit_events.length} events)</h3>
                    <div className="relative pl-4 border-l-2 border-slate-100 space-y-3">
                      {detail.audit_events.map((ev) => (
                        <div key={ev.id} className="relative">
                          <div className="absolute -left-[17px] top-1 w-3 h-3 rounded-full bg-slate-200 border-2 border-white" />
                          <p className="text-[10px] font-black uppercase text-slate-500">{ev.event_type.replace(/_/g, " ")}</p>
                          <p className="text-[10px] text-slate-400">{formatTs(ev.activity_at)}{ev.actor_name ? ` · ${ev.actor_name}` : ""}{ev.actor_role ? ` (${ev.actor_role})` : ""}</p>
                          {ev.message && <p className="text-xs text-slate-600 mt-0.5">{ev.message}</p>}
                          {ev.error_detail && <p className="text-[10px] text-red-500 mt-0.5 bg-red-50 px-2 py-1 rounded">{ev.error_detail}</p>}
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}
          </div>
        </div>
      )}
      {selectedId && <div className="fixed inset-0 bg-black/20 z-40" onClick={() => setSelectedId(null)} />}
    </HrmsModernShell>
  );
}
