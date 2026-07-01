import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  History,
  Loader,
  RefreshCcw,
  RotateCcw,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

// ─── Types ────────────────────────────────────────────────────────────────────

type DispatchLog = {
  id: string;
  template_name?: string;
  template_id?: string;
  recipient_contact?: string;
  employee_id?: string;
  channel: string;
  status: "queued" | "sent" | "failed" | "retrying";
  sent_at?: string;
  created_at: string;
  error_message?: string;
};

type DispatchLogPage = {
  logs: DispatchLog[];
  total: number;
  page: number;
  limit: number;
};

// ─── Badge helpers ────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  queued:   "bg-amber-50 text-amber-700",
  sent:     "bg-emerald-50 text-emerald-700",
  failed:   "bg-red-50 text-red-700",
  retrying: "bg-violet-50 text-violet-700",
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function NativeDispatchHistory() {
  const [logs, setLogs] = useState<DispatchLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"info" | "error" | "success">("info");
  const [retryingId, setRetryingId] = useState<string | null>(null);

  // ── Loaders ──────────────────────────────────────────────────────────────────

  const loadLogs = async () => {
    setLoading(true);
    setMessage("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: DispatchLogPage }>("/api/communication/dispatch/logs");
      setLogs(res.data?.logs ?? []);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to load dispatch logs");
      setMessageType("error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await hrmsApi.get<{ success: boolean; data: DispatchLogPage }>("/api/communication/dispatch/logs");
        if (!cancelled) setLogs(res.data?.logs ?? []);
      } catch (err: unknown) {
        if (!cancelled) {
          setMessage(err instanceof Error ? err.message : "Failed to load dispatch logs");
          setMessageType("error");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

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
              View all sent and failed messages. Retry failed dispatches directly from here.
            </p>
          </div>
          <button
            onClick={() => void loadLogs()}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors cursor-pointer"
          >
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </button>
        </div>

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

        {/* Table */}
        <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
          <div className="border-b p-5">
            <h2 className="font-black text-slate-950">Dispatch Log</h2>
            <p className="text-sm text-slate-500">{logs.length} records</p>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader className="h-8 w-8 animate-spin text-slate-400" />
            </div>
          ) : logs.length === 0 ? (
            <div className="py-16 text-center text-slate-400">
              <History className="mx-auto mb-3 h-10 w-10 opacity-30" />
              <p className="font-semibold">No dispatch records found.</p>
              <p className="text-xs mt-1">Records will appear here after messages are sent.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px] text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    {["Template", "Recipient", "Channel", "Status", "Sent At", "Error", ""].map((h) => (
                      <th key={h} className="p-4 font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id} className="border-t hover:bg-slate-50/80 transition-colors">
                      <td className="p-4">
                        <div className="font-semibold text-slate-900 truncate max-w-[180px]">
                          {log.template_name ?? "—"}
                        </div>
                      </td>
                      <td className="p-4 font-mono text-xs text-slate-600 truncate max-w-[160px]">
                        {log.recipient_contact ?? log.employee_id ?? "—"}
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
                            className="text-xs text-red-600 font-medium truncate max-w-[160px] block cursor-help"
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
        </div>
      </div>
    </DashboardLayout>
  );
}
