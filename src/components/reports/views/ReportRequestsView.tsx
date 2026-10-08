import { Fragment, useState, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Mail, Clock, FileText, AlertCircle, ChevronDown, ChevronRight, RotateCcw, Search, Copy } from "lucide-react";
import { HrmsModernShell } from "@/components/ui/hrms-modern";
import { hrmsApi } from "@/lib/hrmsApi";
import { useToast } from "@/hooks/use-toast";
import RequestStatusBadge from "@/components/reports/RequestStatusBadge";

interface ReportRequest {
  id: string;
  requestReference: string;
  reportCode: string;
  reportName: string;
  requestedFilters: Record<string, unknown>;
  officialEmailMasked: string;
  status: string;
  requestedAt: string;
  generationCompletedAt: string | null;
  emailSentAt: string | null;
  failureMessage: string | null;
  failureCode: string | null;
  retryCount: number;
  expiresAt: string | null;
  generatedRowCount: number | null;
  fileSizeBytes: number | null;
}

const ACTIVE_STATUSES = new Set(["REQUESTED", "QUEUED", "PROCESSING", "GENERATED"]);
const FAILED_STATUSES = new Set(["GENERATION_FAILED", "DELIVERY_FAILED", "FAILED"]);
/** A report normally lands in the inbox within a minute; past this the row is flagged. */
const SLOW_AFTER_MS = 3 * 60_000;

const STATUS_TABS: Array<{ key: string; label: string }> = [
  { key: "", label: "All" },
  { key: "active", label: "In progress" },
  { key: "EMAILED", label: "Emailed" },
  { key: "failed", label: "Failed" },
  { key: "CANCELLED", label: "Cancelled" },
  { key: "EXPIRED", label: "Expired" },
];

function formatTs(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function formatBytes(n: number | null): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1_048_576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1_048_576).toFixed(1)} MB`;
}

/** "2m 10s" between two timestamps, or "—" when either is missing. */
function elapsed(from: string | null, to: string | null): string {
  if (!from || !to) return "—";
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function filterEntries(filters: Record<string, unknown>): Array<[string, string]> {
  return Object.entries(filters ?? {})
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : String(v)]);
}

export default function MyReportRequests() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const pageSize = 20;

  // Debounce the search box so typing does not fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => { setQ(search.trim()); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading, error, refetch, dataUpdatedAt, isFetching } = useQuery({
    queryKey: ["my-report-requests", page, status, q],
    queryFn: () => {
      const p = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (status) p.set("status", status);
      if (q) p.set("q", q);
      return hrmsApi.get<{ success: boolean; data: ReportRequest[]; total: number }>(`/api/reports/my-requests?${p}`);
    },
    staleTime: 5_000,
    // In-flight reports are expected within a minute, so poll quickly while any are active.
    refetchInterval: (query) => {
      const rows = query.state.data?.data ?? [];
      return rows.some((r) => ACTIVE_STATUSES.has(r.status)) ? 5_000 : false;
    },
  });

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasActive = rows.some((r) => ACTIVE_STATUSES.has(r.status));

  useEffect(() => {
    if (!hasActive) return;
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, [hasActive]);

  const cancelMutation = useMutation({
    mutationFn: (id: string) => hrmsApi.post(`/api/reports/my-requests/${id}/cancel`),
    onSuccess: () => { toast({ title: "Request cancelled" }); void queryClient.invalidateQueries({ queryKey: ["my-report-requests"] }); },
    onError: (err) => toast({ title: "Cancel failed", description: err instanceof Error ? err.message : undefined, variant: "destructive" }),
  });

  const resubmitMutation = useMutation({
    mutationFn: (id: string) => hrmsApi.post<{ requestReference: string; message?: string }>(`/api/reports/my-requests/${id}/resubmit`),
    onSuccess: (res) => {
      toast({ title: "Report requested again", description: res?.requestReference ? `Reference ${res.requestReference}` : res?.message });
      setStatus("");
      setPage(1);
      void queryClient.invalidateQueries({ queryKey: ["my-report-requests"] });
    },
    onError: (err) => toast({ title: "Could not request again", description: err instanceof Error ? err.message : undefined, variant: "destructive" }),
  });

  const copyRef = useCallback((ref: string) => {
    void navigator.clipboard?.writeText(ref).then(() => toast({ title: "Reference copied", description: ref })).catch(() => undefined);
  }, [toast]);

  const isSlow = (r: ReportRequest) =>
    ACTIVE_STATUSES.has(r.status) && now - new Date(r.requestedAt).getTime() > SLOW_AFTER_MS;

  return (
    <HrmsModernShell
      eyebrow="REPORTS"
      title="My Report Requests"
      description="Track the status of report requests you have submitted. Reports are delivered to your registered company email."
      icon={<Clock size={22} />}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            {hasActive && (
              <span className="inline-flex items-center gap-1 text-blue-600 text-xs font-medium">
                <RefreshCw size={12} className="animate-spin" /> Auto-refreshing…
              </span>
            )}
            <span>{total.toLocaleString()} request{total === 1 ? "" : "s"}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search reference or report"
                aria-label="Search report requests"
                className="w-56 rounded-lg border border-slate-200 bg-white py-1.5 pl-7 pr-2 text-xs text-slate-700 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={() => void refetch()}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50"
            >
              <RefreshCw size={12} className={isFetching ? "animate-spin" : ""} /> Refresh
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter by status">
          {STATUS_TABS.map((t) => (
            <button
              key={t.key || "all"}
              type="button"
              role="tab"
              aria-selected={status === t.key}
              onClick={() => { setStatus(t.key); setPage(1); }}
              className={`cursor-pointer rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                status === t.key
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex items-start gap-2 rounded-lg bg-blue-50 border border-blue-100 px-4 py-3 text-sm text-blue-800">
          <Mail size={16} className="mt-0.5 shrink-0" />
          <p>
            Reports are generated server-side and emailed to your registered company email address.
            There are no download links — check your inbox once the status shows <strong>Emailed</strong>.
            Most reports arrive within a minute; very large ones can take a few.
          </p>
        </div>

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
            <p className="text-sm">{status || q ? "No requests match this filter." : "You have not submitted any report requests yet."}</p>
            <p className="text-xs">{status || q ? "Clear the filter or search to see all of your requests." : "Use the Reports section to request a report. It will appear here."}</p>
          </div>
        )}

        {rows.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="w-8 px-2 py-3"></th>
                  {["Reference", "Report", "Status", "Requested", "Generated", "Emailed", "Sent to", ""].map((h, i) => (
                    <th key={i} className="whitespace-nowrap px-4 py-3 text-left font-semibold uppercase tracking-wider text-slate-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => {
                  const open = openId === row.id;
                  const filters = filterEntries(row.requestedFilters);
                  const canCancel = row.status === "QUEUED" || row.status === "REQUESTED";
                  const canRetry = FAILED_STATUSES.has(row.status) || row.status === "EXPIRED" || row.status === "CANCELLED" || row.status === "EMAILED";
                  return (
                    <Fragment key={row.id}>
                      <tr
                        className="cursor-pointer transition-colors hover:bg-slate-50"
                        onClick={() => setOpenId(open ? null : row.id)}
                      >
                        <td className="px-2 py-3 text-slate-400">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono font-semibold text-slate-700">{row.requestReference}</td>
                        <td className="max-w-[220px] truncate px-4 py-3 text-slate-700" title={row.reportName}>{row.reportName}</td>
                        <td className="px-4 py-3">
                          <RequestStatusBadge status={row.status} />
                          {isSlow(row) && (
                            <p className="mt-1 text-[10px] text-amber-600">Taking longer than usual</p>
                          )}
                          {row.failureMessage && FAILED_STATUSES.has(row.status) && (
                            <p className="mt-1 max-w-[200px] truncate text-[10px] text-red-500" title={row.failureMessage}>{row.failureMessage}</p>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-500">{formatTs(row.requestedAt)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-500">{formatTs(row.generationCompletedAt)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-500">{formatTs(row.emailSentAt)}</td>
                        <td className="px-4 py-3 font-mono text-[10px] text-slate-400">{row.officialEmailMasked}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                          {canCancel && (
                            <button
                              type="button"
                              disabled={cancelMutation.isPending}
                              onClick={() => cancelMutation.mutate(row.id)}
                              className="cursor-pointer text-[10px] font-semibold uppercase tracking-wide text-red-500 hover:text-red-700 disabled:opacity-50"
                            >
                              Cancel
                            </button>
                          )}
                          {canRetry && (
                            <button
                              type="button"
                              disabled={resubmitMutation.isPending}
                              onClick={() => resubmitMutation.mutate(row.id)}
                              className="inline-flex cursor-pointer items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-blue-600 hover:text-blue-800 disabled:opacity-50"
                              title="Request this report again with the same filters"
                            >
                              <RotateCcw size={11} /> {row.status === "EMAILED" ? "Send again" : "Retry"}
                            </button>
                          )}
                        </td>
                      </tr>
                      {open && (
                        <tr className="bg-slate-50/70">
                          <td></td>
                          <td colSpan={8} className="px-4 py-4">
                            <div className="grid gap-4 text-xs sm:grid-cols-2 lg:grid-cols-3">
                              <div className="space-y-1">
                                <p className="font-semibold uppercase tracking-wider text-slate-500">Timing</p>
                                <p className="text-slate-600">Generation: {elapsed(row.requestedAt, row.generationCompletedAt)}</p>
                                <p className="text-slate-600">Delivery: {elapsed(row.generationCompletedAt, row.emailSentAt)}</p>
                                <p className="text-slate-600">Total: {elapsed(row.requestedAt, row.emailSentAt)}</p>
                                {row.retryCount > 0 && <p className="text-amber-600">Retried {row.retryCount} time{row.retryCount === 1 ? "" : "s"}</p>}
                              </div>
                              <div className="space-y-1">
                                <p className="font-semibold uppercase tracking-wider text-slate-500">Output</p>
                                <p className="text-slate-600">Rows: {row.generatedRowCount == null ? "—" : row.generatedRowCount.toLocaleString()}</p>
                                <p className="text-slate-600">File size: {formatBytes(row.fileSizeBytes)}</p>
                                <p className="text-slate-600">Expires: {formatTs(row.expiresAt)}</p>
                                <p className="text-slate-600">Report code: <span className="font-mono">{row.reportCode}</span></p>
                              </div>
                              <div className="space-y-1">
                                <p className="font-semibold uppercase tracking-wider text-slate-500">Filters used</p>
                                {filters.length === 0
                                  ? <p className="text-slate-400">None (all data you can access)</p>
                                  : filters.map(([k, v]) => (
                                    <p key={k} className="text-slate-600"><span className="text-slate-400">{k}:</span> {v}</p>
                                  ))}
                              </div>
                            </div>
                            {row.failureMessage && (
                              <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-red-700">
                                {row.failureCode ? <span className="font-mono">[{row.failureCode}] </span> : null}{row.failureMessage}
                              </p>
                            )}
                            <button
                              type="button"
                              onClick={() => copyRef(row.requestReference)}
                              className="mt-3 inline-flex cursor-pointer items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-700"
                            >
                              <Copy size={11} /> Copy reference
                            </button>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2">
            <button
              type="button"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
              className="cursor-pointer rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-xs text-slate-500">Page {page} of {totalPages}</span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="cursor-pointer rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}

        <p className="text-center text-[10px] text-slate-400">
          Last updated: {dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString("en-IN") : "—"}
          {" · "}
          <Clock size={10} className="inline" /> Reports expire after 7 days (2 days for payroll reports)
        </p>
      </div>
    </HrmsModernShell>
  );
}
