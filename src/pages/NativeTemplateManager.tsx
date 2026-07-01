import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Loader,
  MessageSquare,
  Plus,
  RefreshCcw,
  X,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

// ─── Types ────────────────────────────────────────────────────────────────────

type Template = {
  id: string;
  name: string;
  subject?: string;
  body_html?: string;
  category: string;
  channel: string;
  is_critical: boolean;
  is_active: boolean;
  created_at: string;
};

type TemplateForm = {
  name: string;
  subject: string;
  body_html: string;
  category: string;
  channel: string;
  is_critical: boolean;
};

// ─── Badge helpers ────────────────────────────────────────────────────────────

const CHANNEL_STYLES: Record<string, string> = {
  email:    "bg-blue-50 text-blue-700",
  sms:      "bg-green-50 text-green-700",
  whatsapp: "bg-emerald-50 text-emerald-800",
};

const CATEGORY_STYLES: Record<string, string> = {
  onboarding:   "bg-violet-50 text-violet-700",
  offboarding:  "bg-orange-50 text-orange-700",
  payroll:      "bg-amber-50 text-amber-700",
  attendance:   "bg-cyan-50 text-cyan-700",
  compliance:   "bg-red-50 text-red-700",
  announcement: "bg-slate-100 text-slate-700",
  general:      "bg-slate-100 text-slate-600",
};

function ChannelBadge({ channel }: { channel: string }) {
  const cls = CHANNEL_STYLES[channel] ?? "bg-slate-100 text-slate-600";
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${cls}`}>{channel}</span>;
}

function CategoryBadge({ category }: { category: string }) {
  const cls = CATEGORY_STYLES[category] ?? "bg-slate-100 text-slate-600";
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${cls}`}>{category}</span>;
}

const inputCls = "w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-slate-700 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

const EMPTY_FORM: TemplateForm = {
  name: "",
  subject: "",
  body_html: "",
  category: "general",
  channel: "email",
  is_critical: false,
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function NativeTemplateManager() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"info" | "error">("info");

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<TemplateForm>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);

  // ── Loaders ──────────────────────────────────────────────────────────────────

  const loadTemplates = async () => {
    setLoading(true);
    setMessage("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: Template[] }>("/api/communication/templates");
      setTemplates(res.data ?? []);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to load templates");
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
        const res = await hrmsApi.get<{ success: boolean; data: Template[] }>("/api/communication/templates");
        if (!cancelled) setTemplates(res.data ?? []);
      } catch (err: unknown) {
        if (!cancelled) {
          setMessage(err instanceof Error ? err.message : "Failed to load templates");
          setMessageType("error");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Actions ──────────────────────────────────────────────────────────────────

  const submitCreate = async () => {
    if (!form.name.trim()) {
      setMessage("Template name is required.");
      setMessageType("error");
      return;
    }
    setBusy(true);
    try {
      await hrmsApi.post("/api/communication/templates", form);
      setShowCreate(false);
      setForm(EMPTY_FORM);
      setMessage("Template created successfully.");
      setMessageType("info");
      await loadTemplates();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to create template.");
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
            <h1 className="mt-2 text-3xl font-black text-slate-950">Template Manager</h1>
            <p className="mt-2 max-w-4xl text-slate-600">
              Manage email, SMS and WhatsApp message templates used across automated workflows.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => void loadTemplates()}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors cursor-pointer"
            >
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </button>
            <button
              onClick={() => { setShowCreate(true); setMessage(""); }}
              className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              Create Template
            </button>
          </div>
        </div>

        {/* Message */}
        {message && (
          <div className={`flex items-center gap-3 rounded-2xl border p-4 text-sm font-bold ${messageType === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-blue-200 bg-blue-50 text-blue-800"}`}>
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            {message}
          </div>
        )}

        {/* Table */}
        <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
          <div className="border-b p-5">
            <h2 className="font-black text-slate-950">Templates</h2>
            <p className="text-sm text-slate-500">{templates.length} templates</p>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader className="h-8 w-8 animate-spin text-slate-400" />
            </div>
          ) : templates.length === 0 ? (
            <div className="py-16 text-center text-slate-400">
              <MessageSquare className="mx-auto mb-3 h-10 w-10 opacity-30" />
              <p className="font-semibold">No templates found.</p>
              <p className="text-xs mt-1">Create your first template to get started.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    {["Name", "Category", "Channel", "Critical", "Status", "Created"].map((h) => (
                      <th key={h} className="p-4 font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {templates.map((t) => (
                    <tr key={t.id} className="border-t hover:bg-slate-50/80 transition-colors">
                      <td className="p-4">
                        <div className="font-semibold text-slate-900">{t.name}</div>
                        {t.subject && <div className="text-xs text-slate-400 mt-0.5 truncate max-w-[200px]">{t.subject}</div>}
                      </td>
                      <td className="p-4"><CategoryBadge category={t.category} /></td>
                      <td className="p-4"><ChannelBadge channel={t.channel} /></td>
                      <td className="p-4">
                        {t.is_critical ? (
                          <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700">Critical</span>
                        ) : (
                          <span className="text-slate-400 text-xs">—</span>
                        )}
                      </td>
                      <td className="p-4">
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${t.is_active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                          {t.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="p-4 font-mono text-xs text-slate-400">{t.created_at?.slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Create Template Modal ─────────────────────────────────────────────── */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-xl rounded-3xl bg-white shadow-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b p-6 shrink-0">
              <h2 className="text-lg font-black text-slate-950">Create Template</h2>
              <button onClick={() => setShowCreate(false)} className="cursor-pointer text-slate-400 hover:text-slate-700 transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto flex-1">
              <Field label="Template Name *">
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Welcome Email"
                  className={inputCls}
                />
              </Field>
              <Field label="Subject">
                <input
                  value={form.subject}
                  onChange={(e) => setForm({ ...form, subject: e.target.value })}
                  placeholder="Email subject line"
                  className={inputCls}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Category">
                  <select
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    className={inputCls}
                  >
                    {["general", "onboarding", "offboarding", "payroll", "attendance", "compliance", "announcement"].map((c) => (
                      <option key={c} value={c} className="capitalize">{c}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Channel">
                  <select
                    value={form.channel}
                    onChange={(e) => setForm({ ...form, channel: e.target.value })}
                    className={inputCls}
                  >
                    <option value="email">Email</option>
                    <option value="sms">SMS</option>
                    <option value="whatsapp">WhatsApp</option>
                  </select>
                </Field>
              </div>
              <Field label="Body / Message *">
                <textarea
                  value={form.body_html}
                  onChange={(e) => setForm({ ...form, body_html: e.target.value })}
                  rows={5}
                  placeholder="Message content (HTML or plain text)…"
                  className={`${inputCls} resize-none`}
                />
              </Field>
              <div className="flex items-center h-[44px]">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.is_critical}
                    onChange={(e) => setForm({ ...form, is_critical: e.target.checked })}
                    className="h-4 w-4 rounded"
                  />
                  <span className="text-sm text-slate-700 font-semibold">Mark as Critical</span>
                  <span className="text-xs text-slate-400">(bypasses quiet hours)</span>
                </label>
              </div>
            </div>
            <div className="flex gap-3 border-t p-6 shrink-0">
              <button
                onClick={() => setShowCreate(false)}
                className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => void submitCreate()}
                disabled={busy}
                className="flex-1 cursor-pointer rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
              >
                {busy ? "Creating…" : "Create Template"}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
