import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  History,
  Loader,
  RefreshCcw,
  RotateCcw,
  X,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

// ─── Types ────────────────────────────────────────────────────────────────────
//
// GET /api/communication/dispatch/logs returns {success, logs, total, page, limit} at the TOP
// LEVEL — not nested under `data`, unlike most HRMS endpoints (hrmsApi.ts's HrmsEnvelope is the
// default shape; this one doesn't use it). The previous version of this page read `res.data?.logs`
// against that response, which is always undefined here — every dispatch this page has ever
// listed came back empty, and the fallback `?? []` render meant an always-empty table read as
// "no records" rather than a fetch bug. Fixed by reading the actual top-level fields.

type DispatchStatus =
  | "queued" | "sent" | "delivered" | "opened" | "clicked" | "bounced" | "failed" | "skipped";

type DispatchLog = {
  id: string;
  template_name?: string;
  template_id?: string;
  event_code?: string | null;
  recipient_contact?: string;
  recipient_employee_id?: string;
  channel: string;
  status: DispatchStatus;
  sent_at?: string | null;
  created_at: string;
  error_message?: string | null;
  retry_count?: number;
};

type DispatchLogsResponse = {
  success: boolean;
  logs: DispatchLog[];
  total: number;
  page: number;
  limit: number;
};

type DispatchStats = {
  total_sent_today: number;
  delivery_rate: number;
  failed_count: number;
  retried_count: number;
  bounced_count: number;
  by_channel: { email: number; sms: number; whatsapp: number };
};

// ─── Badge helpers ────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  queued:    "bg-amber-50 text-amber-700",
  sent:      "bg-emerald-50 text-emerald-700",
  delivered: "bg-emerald-50 text-emerald-700",
  opened:    "bg-sky-50 text-sky-700",
  clicked:   "bg-sky-50 text-sky-700",
  bounced:   "bg-orange-50 text-orange-700",
  failed:    "bg-red-50 text-red-700",
  skipped:   "bg-slate-100 text-slate-500",
};

const CHANNEL_STYLES: Record<string, string> = {
  email:    "bg-blue-50 text-blue-700",
  sms:      "bg-green-50 text-green-700",
  whatsapp: "bg-emerald-50 text-emerald-800",
};

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_STYLES[status] ?? "bg-slate-100 text-slate-600";
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${cls}`}>{status}</span>;
}

function ChannelBadge({ channel }: { channel: string }) {
  const cls = CHANNEL_STYLES[channel] ?? "bg-slate-100 text-slate-600";
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${cls}`}>{channel}</span>;
}

const STATUS_OPTIONS: DispatchStatus[] = ["queued", "sent", "delivered", "opened", "clicked", "bounced", "failed", "skipped"];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function NativeDispatchHistory() {
  const [logs, setLogs] = useState<DispatchLog[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<DispatchStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"info" | "error" | "success">("info");
  const [retryingId, setRetryingId] = useState<string | null>(null);

  // Defaults to SMS: the immediate reason this page needed a rework was "why can't I see what
  // was actually sent by SMS" — landing on that filter answers the question the page was built
  // to answer, while All/Email/WhatsApp stay one click away.
  const [channel, setChannel] = useState<string>("sms");
  const [status, setStatus] = useState<string>("");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [page, setPage] = useState(1);
  const limit = 25;

  const hasFilters = channel !== "sms" || status || dateFrom || dateTo;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  // ── Loaders ──────────────────────────────────────────────────────────────────

  const buildQuery = () => {
    const qs = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (channel !== "all") qs.set("channel", channel);
    if (status) qs.set("status", status);
    if (dateFrom) qs.set("from_date", dateFrom);
    if (dateTo) qs.set("to_date", dateTo);
    return qs.toString();
  };

  const loadLogs = async () => {
    setLoading(true);
    setMessage("");
    try {
      const res = await hrmsApi.get<DispatchLogsResponse>(`/api/communication/dispatch/logs?${buildQuery()}`);
      setLogs(res.logs ?? []);
      setTotal(res.total ?? 0);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to load dispatch logs");
      setMessageType("error");
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const res = await hrmsApi.get<{ success: boolean; data: DispatchStats }>("/api/communication/dispatch/stats");
      setStats(res.data ?? null);
    } catch {
      // Stats are a summary strip, not the record of truth — a failure here shouldn't block the
      // log table itself from rendering.
      setStats(null);
    }
  };

  useEffect(() => {
    void loadLogs();
    void loadStats();
  }, [channel, status, dateFrom, dateTo, page]);

  // Any filter change invalidates the current page number — land back on page 1 rather than
  // showing an empty "page 3 of 1" result, same pattern used elsewhere in this app.
  useEffect(() => {
    setPage(1);
  }, [channel, status, dateFrom, dateTo]);

  // ── Actions ──────────────────────────────────────────────────────────────────

  const handleRetry = async (id: string) => {
    setRetryingId(id);
    setMessage("");
    try {
      await hrmsApi.post(`/api/communication/dispatch/retry/${id}`, {});
      setMessage("Message queued for retry.");
      setMessageType("success");
      await loadLogs();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Retry failed.");
      setMessageType("error");
    } finally {
      setRetryingId(null);
    }
  };

  const clearFilters = () => {
    setChannel("all");
    setStatus("");
    setDateFrom("");
    setDateTo("");
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <DashboardLayout>
      <div className="space-y-6">

        {/* Header */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">Communication</p>
            <h1 className="mt-2 text-3xl font-black text-slate-950">Dispatch History</h1>
            <p className="mt-2 max-w-4xl text-slate-600">
              Every message this system has attempted to send — email, SMS and WhatsApp — with
              its real delivery status. Retry failed dispatches directly from here.
            </p>
          </div>
          <button
            onClick={() => { void loadLogs(); void loadStats(); }}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors cursor-pointer"
          >
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </button>
        </div>

        {/* Stats strip */}
        {stats && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              { label: "Sent today", value: stats.total_sent_today },
              { label: "Delivery rate (7d)", value: `${stats.delivery_rate}%` },
              { label: "Failed (7d)", value: stats.failed_count },
              { label: "Retried (7d)", value: stats.retried_count },
              { label: "Email today", value: stats.by_channel?.email ?? 0 },
              { label: "SMS today", value: stats.by_channel?.sms ?? 0 },
            ].map((tile) => (
              <div key={tile.label} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                <p className="text-xl font-black text-slate-950 tabular-nums">{tile.value}</p>
                <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{tile.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Message */}
        {message && (
          <div className={`flex items-center gap-3 rounded-2xl border p-4 text-sm font-bold ${
            messageType === "error"   ? "border-red-200 bg-red-50 text-red-800" :
            messageType === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" :
                                        "border-blue-200 bg-blue-50 text-blue-800"
          }`}>
            {messageType === "success"
              ? <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
              : <AlertTriangle className="h-4 w-4 flex-shrink-0" />}
            {message}
          </div>
        )}

        {/* Filters */}
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm"
            >
              <option value="all">All channels</option>
              <option value="sms">SMS</option>
              <option value="email">Email</option>
              <option value="whatsapp">WhatsApp</option>
            </select>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm capitalize"
            >
              <option value="">All statuses</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s} className="capitalize">{s}</option>
              ))}
            </select>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              placeholder="From"
              className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm text-slate-600"
            />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              placeholder="To"
              className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm shadow-sm text-slate-600"
            />
            {hasFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl px-3 text-xs font-semibold text-slate-500 hover:bg-white hover:text-slate-900"
              >
                <X className="h-3.5 w-3.5" />
                Clear filters
              </button>
            )}
          </div>
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
          <div className="border-b p-5">
            <h2 className="font-black text-slate-950">Dispatch Log</h2>
            <p className="text-sm text-slate-500">{total} record{total !== 1 ? "s" : ""}</p>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader className="h-8 w-8 animate-spin text-slate-400" />
            </div>
          ) : logs.length === 0 ? (
            <div className="py-16 text-center text-slate-400">
              <History className="mx-auto mb-3 h-10 w-10 opacity-30" />
              <p className="font-semibold">No dispatch records match these filters.</p>
              <p className="text-xs mt-1">
                {hasFilters ? "Try widening the date range or clearing a filter." : "Records will appear here after messages are sent."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    {["Event / Template", "Recipient", "Channel", "Status", "Sent At", "Error", ""].map((h) => (
                      <th key={h} className="p-4 font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id} className="border-t hover:bg-slate-50/80 transition-colors">
                      <td className="p-4">
                        <div className="font-semibold text-slate-900 truncate max-w-[200px]">
                          {log.template_name ?? "—"}
                        </div>
                        {log.event_code && (
                          <div className="mt-0.5 font-mono text-[10px] text-slate-400 truncate max-w-[200px]">
                            {log.event_code}
                          </div>
                        )}
                      </td>
                      <td className="p-4 font-mono text-xs text-slate-600 truncate max-w-[160px]">
                        {log.recipient_contact ?? log.recipient_employee_id ?? "—"}
                      </td>
                      <td className="p-4"><ChannelBadge channel={log.channel} /></td>
                      <td className="p-4"><StatusBadge status={log.status} /></td>
                      <td className="p-4 font-mono text-xs text-slate-400">
                        {log.sent_at ? log.sent_at.slice(0, 16).replace("T", " ") : "—"}
                      </td>
                      <td className="p-4">
                        {log.error_message ? (
                          <span
                            title={log.error_message}
                            className="text-xs text-red-600 font-medium truncate max-w-[200px] block cursor-help"
                          >
                            {log.error_message.slice(0, 60)}{log.error_message.length > 60 ? "…" : ""}
                          </span>
                        ) : (
                          <span className="text-slate-300 text-xs">—</span>
                        )}
                      </td>
                      <td className="p-4">
                        {log.status === "failed" && (
                          <button
                            onClick={() => void handleRetry(log.id)}
                            disabled={retryingId === log.id}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
                          >
                            <RotateCcw className={`h-3.5 w-3.5 ${retryingId === log.id ? "animate-spin" : ""}`} />
                            {retryingId === log.id ? "Retrying…" : "Retry"}
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
          {total > limit && (
            <div className="flex items-center justify-between border-t p-4">
              <p className="text-xs text-slate-500">
                Showing {Math.min((page - 1) * limit + 1, total)}–{Math.min(page * limit, total)} of {total}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-xs font-medium text-slate-600">{page} / {totalPages}</span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
