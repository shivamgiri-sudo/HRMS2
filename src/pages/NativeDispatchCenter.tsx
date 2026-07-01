import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader,
  RefreshCcw,
  Send,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

// ─── Types ────────────────────────────────────────────────────────────────────

type Template = {
  id: string;
  name: string;
  category: string;
  channel: string;
  is_active: boolean;
};

type DispatchStats = {
  total_sent: number;
  total_queued: number;
  total_failed: number;
  today_sent?: number;
};

type SendResult = {
  queued: number;
  failed: number;
  errors?: string[];
};

// ─── Page ─────────────────────────────────────────────────────────────────────

const inputCls = "w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors";

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-slate-700 mb-1.5">{label}</label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div className={`rounded-2xl border p-5 ${color}`}>
      <p className="text-2xl font-black">{value}</p>
      <p className="text-xs font-semibold uppercase tracking-wide mt-1 opacity-70">{label}</p>
    </div>
  );
}

export default function NativeDispatchCenter() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [stats, setStats] = useState<DispatchStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  const [templateId, setTemplateId] = useState("");
  const [employeeIds, setEmployeeIds] = useState("");
  const [channel, setChannel] = useState("email");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"info" | "error" | "success">("info");

  // ── Loaders ──────────────────────────────────────────────────────────────────

  const loadTemplates = async () => {
    setTemplatesLoading(true);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: Template[] }>("/api/communication/templates");
      setTemplates((res.data ?? []).filter((t) => t.is_active));
    } catch {
      // silently ignore — page still usable
    } finally {
      setTemplatesLoading(false);
    }
  };

  const loadStats = async () => {
    setStatsLoading(true);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: DispatchStats }>("/api/communication/dispatch/stats");
      setStats(res.data);
    } catch {
      // stats are optional — don't block on failure
    } finally {
      setStatsLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setTemplatesLoading(true);
      try {
        const res = await hrmsApi.get<{ success: boolean; data: Template[] }>("/api/communication/templates");
        if (!cancelled) setTemplates((res.data ?? []).filter((t) => t.is_active));
      } catch {
        // silently ignore — page still usable
      } finally {
        if (!cancelled) setTemplatesLoading(false);
      }
    })();
    (async () => {
      setStatsLoading(true);
      try {
        const res = await hrmsApi.get<{ success: boolean; data: DispatchStats }>("/api/communication/dispatch/stats");
        if (!cancelled) setStats(res.data);
      } catch {
        // stats are optional — don't block on failure
      } finally {
        if (!cancelled) setStatsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Actions ──────────────────────────────────────────────────────────────────

  const handleSend = async () => {
    if (!templateId) {
      setMessage("Please select a template.");
      setMessageType("error");
      return;
    }
    const ids = employeeIds
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (ids.length === 0) {
      setMessage("Please enter at least one employee ID.");
      setMessageType("error");
      return;
    }

    setBusy(true);
    setMessage("");
    setResult(null);
    try {
      const res = await hrmsApi.post<{ success: boolean; data: SendResult }>("/api/communication/dispatch/send", {
        template_id: templateId,
        recipient_employee_ids: ids,
        data: {},
        channel,
      });
      const data = res.data;
      setResult(data);
      setMessage(`Dispatch complete — Queued: ${data.queued}, Failed: ${data.failed}`);
      setMessageType(data.failed > 0 ? "error" : "success");
      void loadStats();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to dispatch messages.");
      setMessageType("error");
    } finally {
      setBusy(false);
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
            <h1 className="mt-2 text-3xl font-black text-slate-950">Dispatch Center</h1>
            <p className="mt-2 max-w-4xl text-slate-600">
              Send templated messages to employees via email, SMS or WhatsApp.
            </p>
          </div>
          <button
            onClick={() => { void loadStats(); }}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors cursor-pointer"
          >
            <RefreshCcw className="h-4 w-4" />
            Refresh Stats
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {statsLoading ? (
            <div className="col-span-4 flex items-center justify-center py-8">
              <Loader className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : stats ? (
            <>
              <StatCard label="Total Sent" value={stats.total_sent ?? 0} color="bg-white border-slate-200 text-slate-900" />
              <StatCard label="Queued" value={stats.total_queued ?? 0} color="bg-amber-50 border-amber-100 text-amber-900" />
              <StatCard label="Failed" value={stats.total_failed ?? 0} color="bg-red-50 border-red-100 text-red-900" />
              <StatCard label="Today" value={stats.today_sent ?? 0} color="bg-blue-50 border-blue-100 text-blue-900" />
            </>
          ) : (
            <div className="col-span-4 rounded-2xl border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">
              Stats unavailable
            </div>
          )}
        </div>

        {/* Message result */}
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

        {/* Dispatch form */}
        <div className="rounded-3xl border bg-white shadow-sm">
          <div className="border-b p-5">
            <h2 className="font-black text-slate-950">Send Message</h2>
            <p className="text-sm text-slate-500">Choose a template, add recipients and hit Send.</p>
          </div>
          <div className="p-6 space-y-5">
            <Field label="Template *">
              {templatesLoading ? (
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <Loader className="h-4 w-4 animate-spin" /> Loading templates…
                </div>
              ) : (
                <select
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                  className={inputCls}
                >
                  <option value="">— Select a template —</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.channel} · {t.category})
                    </option>
                  ))}
                </select>
              )}
            </Field>

            <Field
              label="Channel"
              hint="Override the template's default channel if needed."
            >
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
                className={inputCls}
              >
                <option value="email">Email</option>
                <option value="sms">SMS</option>
                <option value="whatsapp">WhatsApp</option>
              </select>
            </Field>

            <Field
              label="Employee IDs *"
              hint="Comma-separated UUID values. e.g. uuid1, uuid2, uuid3"
            >
              <textarea
                value={employeeIds}
                onChange={(e) => setEmployeeIds(e.target.value)}
                rows={4}
                placeholder="uuid-1, uuid-2, uuid-3…"
                className={`${inputCls} resize-none font-mono text-xs`}
              />
            </Field>

            {/* Result breakdown */}
            {result && (
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-emerald-50 border border-emerald-100 p-4 text-center">
                  <p className="text-2xl font-black text-emerald-700">{result.queued}</p>
                  <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600 mt-1">Queued</p>
                </div>
                <div className="rounded-2xl bg-red-50 border border-red-100 p-4 text-center">
                  <p className="text-2xl font-black text-red-700">{result.failed}</p>
                  <p className="text-xs font-semibold uppercase tracking-wide text-red-600 mt-1">Failed</p>
                </div>
              </div>
            )}

            <button
              onClick={() => void handleSend()}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-6 py-3 text-sm font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
              {busy ? "Dispatching…" : "Send Messages"}
            </button>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
