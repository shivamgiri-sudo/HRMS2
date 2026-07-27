import { useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Mail, Clock, FileText, AlertCircle } from "lucide-react";
import { HrmsModernShell } from "@/components/ui/hrms-modern";
import { hrmsApi } from "@/lib/hrmsApi";
import RequestStatusBadge from "@/components/reports/RequestStatusBadge";

interface ReportRequest {
  id: string;
  request_reference: string;
  report_code: string;
  report_name_snapshot: string;
  status: string;
  official_email: string;
  requested_at: string;
  generation_completed_at: string | null;
  email_sent_at: string | null;
  failure_message: string | null;
  retry_count: number;
  expires_at: string | null;
}

const ACTIVE_STATUSES = new Set(["REQUESTED", "QUEUED", "PROCESSING", "GENERATED"]);

function formatTs(ts: string | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export default function MyReportRequests() {
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const { data, isLoading, error, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["my-report-requests", page],
    queryFn: () =>
      hrmsApi.get<{ success: boolean; data: ReportRequest[]; total: number }>(
        `/api/reports/my-requests?page=${page}&pageSize=${pageSize}`
      ),
    staleTime: 15_000,
    refetchInterval: (query) => {
      const rows = query.state.data?.data ?? [];
      const hasActive = rows.some((r) => ACTIVE_STATUSES.has(r.status));
      return hasActive ? 20_000 : false;
    },
  });

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / pageSize);
  const hasActive = rows.some((r) => ACTIVE_STATUSES.has(r.status));

  const handleCancel = useCallback(async (id: string) => {
    try {
      await hrmsApi.post(`/api/reports/my-requests/${id}/cancel`);
      refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Cancel failed");
    }
  }, [refetch]);

  return (
    <HrmsModernShell
      eyebrow="REPORTS"
      title="My Report Requests"
      subtitle="Track the status of report requests you have submitted. Reports are delivered to your registered company email."
    >
      <div className="space-y-4">
        {/* Header row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            {hasActive && (
              <span className="inline-flex items-center gap-1 text-blue-600 text-xs font-medium">
                <RefreshCw size={12} className="animate-spin" /> Auto-refreshing…
              </span>
            )}
            <span>{total.toLocaleString()} requests total</span>
          </div>
          <button
            type="button"
            onClick={() => refetch()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
          >
            <RefreshCw size={12} /> Refresh
          </button>
        </div>

        {/* Notice */}
        <div className="flex items-start gap-2 rounded-lg bg-blue-50 border border-blue-100 px-4 py-3 text-sm text-blue-800">
          <Mail size={16} className="mt-0.5 shrink-0" />
          <p>
            Reports are generated server-side and emailed to your registered company email address.
            There are no download links — check your inbox once the status shows <strong>Emailed</strong>.
          </p>
        </div>

        {/* Table */}
        {isLoading && (
          <div className="flex items-center justify-center py-12 text-slate-400">
            <RefreshCw size={18} className="animate-spin mr-2" /> Loading…
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertCircle size={16} /> {error instanceof Error ? error.message : "Failed to load requests"}
          </div>
        )}
        {!isLoading && !error && rows.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-2">
            <FileText size={36} className="opacity-30" />
            <p className="text-sm">You have not submitted any report requests yet.</p>
            <p className="text-xs">Use the Reports section to request a report. It will appear here.</p>
          </div>
        )}
        {rows.length > 0 && (
          <div className="rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-4 py-3 text-left font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">Reference</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-500 uppercase tracking-wider">Report</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">Requested</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">Generated</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">Emailed</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-500 uppercase tracking-wider">Email</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-mono font-semibold text-slate-700 whitespace-nowrap">{row.request_reference}</td>
                    <td className="px-4 py-3 text-slate-700 max-w-[180px] truncate" title={row.report_name_snapshot}>{row.report_name_snapshot}</td>
                    <td className="px-4 py-3">
                      <RequestStatusBadge status={row.status} />
                      {row.failure_message && (
                        <p className="text-red-500 mt-1 text-[10px] max-w-[160px] truncate" title={row.failure_message}>
                          {row.failure_message}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{formatTs(row.requested_at)}</td>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{formatTs(row.generation_completed_at)}</td>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{formatTs(row.email_sent_at)}</td>
                    <td className="px-4 py-3 text-slate-400 font-mono text-[10px]">{row.official_email}</td>
                    <td className="px-4 py-3">
                      {(row.status === "QUEUED" || row.status === "REQUESTED") && (
                        <button
                          type="button"
                          onClick={() => handleCancel(row.id)}
                          className="text-[10px] font-semibold text-red-500 hover:text-red-700 uppercase tracking-wide"
                        >
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2">
            <button
              type="button"
              disabled={page === 1}
              onClick={() => setPage(p => p - 1)}
              className="px-3 py-1.5 text-xs font-semibold border border-slate-200 rounded-lg disabled:opacity-40 hover:bg-slate-50"
            >
              Previous
            </button>
            <span className="text-xs text-slate-500">Page {page} of {totalPages}</span>
            <button
              type="button"
              disabled={page === totalPages}
              onClick={() => setPage(p => p + 1)}
              className="px-3 py-1.5 text-xs font-semibold border border-slate-200 rounded-lg disabled:opacity-40 hover:bg-slate-50"
            >
              Next
            </button>
          </div>
        )}

        <p className="text-[10px] text-slate-400 text-center">
          Last updated: {dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString("en-IN") : "—"}
          {" · "}
          <Clock size={10} className="inline" /> Reports expire after 7 days (2 days for payroll reports)
        </p>
      </div>
    </HrmsModernShell>
  );
}
