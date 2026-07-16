import { useEffect, useState, useCallback } from "react";
import {
  AlertTriangle,
  BadgePercent,
  BookOpen,
  Building2,
  Calendar,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Clock,
  Edit2,
  History,
  Info,
  Loader,
  Plus,
  RefreshCcw,
  Save,
  Shield,
  TrendingUp,
  X,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { hrmsApi } from "@/lib/hrmsApi";

// ─── Types ────────────────────────────────────────────────────────────────────

interface StatutoryConfigRow {
  config_key: string;
  config_value: string;
  description: string;
  updated_at: string;
}

interface ConfigMap {
  [key: string]: StatutoryConfigRow;
}

interface AuditEntry {
  id: string;
  config_key: string;
  old_value: string | null;
  new_value: string;
  effective_from: string | null;
  changed_by: string;
  changed_at: string;
  reason: string | null;
}

interface PtSlab {
  id: string;
  state_code: string;
  state_name: string | null;
  income_from: number;
  income_to: number | null;
  pt_amount: number;
  frequency: string;
  effective_from: string;
  is_active: number;
}

interface PtSlabForm {
  state_code: string;
  state_name: string;
  income_from: string;
  income_to: string;
  pt_amount: string;
  frequency: string;
  effective_from: string;
}

interface MinWageRow {
  id: string;
  state?: string;
  state_code?: string;
  state_name?: string;
  skill_category?: string;
  category?: string;
  daily_rate: string;
  monthly_rate: string;
  effective_from: string;
  is_active: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtPct(raw: string | undefined): string {
  if (raw === undefined || raw === null) return "—";
  const n = parseFloat(raw);
  return isNaN(n) ? raw : `${n}%`;
}

function fmtCurrency(raw: string | undefined): string {
  if (raw === undefined || raw === null) return "—";
  const n = parseFloat(raw);
  if (isNaN(n)) return raw;
  return `₹${n.toLocaleString("en-IN")}`;
}

function fmtDate(raw: string | undefined): string {
  if (!raw) return "—";
  try {
    return new Date(raw).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "Asia/Kolkata",
    });
  } catch {
    return raw;
  }
}

async function apiGet<T>(path: string): Promise<T> {
  return hrmsApi.get<T>(path);
}

async function apiPatch(path: string, body: unknown): Promise<void> {
  await hrmsApi.patch(path, body);
}

async function apiPost(path: string, body: unknown): Promise<unknown> {
  return hrmsApi.post(path, body);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({
  icon,
  title,
  subtitle,
  collapsible,
  open,
  onToggle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  collapsible?: boolean;
  open?: boolean;
  onToggle?: () => void;
}) {
  return (
    <div
      className={`flex items-center gap-3 mb-4 ${collapsible ? "cursor-pointer select-none" : ""}`}
      onClick={collapsible ? onToggle : undefined}
    >
      <div className="rounded-2xl bg-slate-100 p-2.5 text-slate-700 flex-shrink-0">{icon}</div>
      <div className="flex-1">
        <h2 className="text-base font-black text-slate-950">{title}</h2>
        {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      {collapsible && (
        <div className="text-slate-400">{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</div>
      )}
    </div>
  );
}

function Toast({ message, type, onClose }: { message: string; type: "success" | "error"; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div
      className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-2xl px-5 py-3.5 text-sm font-semibold shadow-xl ${
        type === "success"
          ? "bg-green-600 text-white"
          : "bg-red-600 text-white"
      }`}
    >
      {type === "success" ? <CheckCircle className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
      {message}
      <button onClick={onClose} className="ml-2 opacity-70 hover:opacity-100 cursor-pointer">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ─── Editable Config Row ──────────────────────────────────────────────────────

function EditableRow({
  configKey,
  label,
  value,
  type = "number",
  unit,
  note,
  isSuperAdmin,
  onSave,
  showHistory,
}: {
  configKey: string;
  label: string;
  value: string;
  type?: "number" | "text" | "select";
  unit?: string;
  note?: string;
  options?: { value: string; label: string }[];
  isSuperAdmin: boolean;
  onSave: (key: string, newValue: string, reason: string) => Promise<void>;
  showHistory: (key: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState(value);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!editVal.trim()) return;
    setSaving(true);
    try {
      await onSave(configKey, editVal, reason);
      setEditing(false);
      setReason("");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">{label}</p>
        {editing ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <input
                type={type === "number" ? "number" : "text"}
                value={editVal}
                onChange={(e) => setEditVal(e.target.value)}
                className="w-32 rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-400"
                step={type === "number" ? "0.01" : undefined}
              />
              {unit && <span className="text-sm text-slate-500">{unit}</span>}
            </div>
            <input
              type="text"
              placeholder="Reason for change (optional)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={() => void handleSave()}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
              >
                {saving ? <Loader className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                Save
              </button>
              <button
                onClick={() => { setEditing(false); setEditVal(value); setReason(""); }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
              >
                <X className="h-3 w-3" />
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <p className="text-2xl font-black text-slate-950">
            {unit === "%" ? fmtPct(value) : unit === "₹" ? fmtCurrency(value) : (value || "—")}
          </p>
        )}
        {note && !editing && <p className="mt-1.5 text-xs text-slate-500 leading-relaxed">{note}</p>}
      </div>
      {isSuperAdmin && !editing && (
        <div className="flex flex-col gap-1.5 flex-shrink-0">
          <button
            onClick={() => { setEditing(true); setEditVal(value); }}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 cursor-pointer"
            title="Edit"
          >
            <Edit2 className="h-3 w-3" />
          </button>
          <button
            onClick={() => showHistory(configKey)}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50 cursor-pointer"
            title="History"
          >
            <History className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── History Panel ────────────────────────────────────────────────────────────

function HistoryPanel({ configKey, onClose }: { configKey: string; onClose: () => void }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    apiGet<{ success: boolean; data: AuditEntry[] }>(`/api/payroll/statutory-config/history/${configKey}`)
      .then((r) => setEntries(r.data ?? []))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [configKey]);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-end bg-black/30" onClick={onClose}>
      <div
        className="m-4 w-full max-w-md rounded-3xl bg-white shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b p-4">
          <div>
            <p className="font-black text-slate-950">Change History</p>
            <code className="text-xs text-slate-500">{configKey}</code>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-slate-100 cursor-pointer">
            <X className="h-4 w-4 text-slate-500" />
          </button>
        </div>
        <div className="max-h-96 overflow-y-auto p-4 space-y-3">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <Loader className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!loading && entries.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-6">No change history yet.</p>
          )}
          {entries.map((e) => (
            <div key={e.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-semibold text-slate-800">{e.old_value ?? "—"} → {e.new_value}</span>
                <span className="text-xs text-slate-400 font-mono">{fmtDate(e.changed_at)}</span>
              </div>
              {e.reason && <p className="text-xs text-slate-500 italic">{e.reason}</p>}
              <div className="mt-1 flex items-center gap-1 text-xs text-slate-400">
                <Clock className="h-3 w-3" />
                {e.effective_from ? `Effective ${fmtDate(e.effective_from)}` : "Immediate"}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Minimum Wages Section ────────────────────────────────────────────────────

function MinimumWagesSection({ isSuperAdmin, onToast }: { isSuperAdmin: boolean; onToast: (msg: string, type: "success" | "error") => void }) {
  const [rows, setRows] = useState<MinWageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<MinWageRow>>({});
  const [showAdd, setShowAdd] = useState(false);
  const [newRow, setNewRow] = useState({ state: "", skill_category: "unskilled", daily_rate: "", monthly_rate: "", effective_from: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiGet<{ success: boolean; data: MinWageRow[] }>("/api/payroll/minimum-wages");
      setRows(r.data ?? []);
    } catch (e: unknown) {
      onToast((e as Error).message, "error");
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  useEffect(() => { void load(); }, [load]);

  const handleSaveEdit = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      await apiPatch(`/api/payroll/minimum-wages/${editingId}`, editData);
      onToast("Minimum wage updated.", "success");
      setEditingId(null);
      void load();
    } catch (e: unknown) {
      onToast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = async () => {
    if (!newRow.state || !newRow.monthly_rate) return;
    setSaving(true);
    try {
      await apiPost("/api/payroll/minimum-wages", newRow);
      onToast("Minimum wage entry added.", "success");
      setShowAdd(false);
      setNewRow({ state: "", skill_category: "unskilled", daily_rate: "", monthly_rate: "", effective_from: "" });
      void load();
    } catch (e: unknown) {
      onToast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-400 py-4">
          <Loader className="h-4 w-4 animate-spin" /> Loading...
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-slate-500">State</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-slate-500">Category</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-slate-500">Daily Rate</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-slate-500">Monthly Rate</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-slate-500">Effective</th>
                {isSuperAdmin && <th className="px-4 py-2.5"></th>}
              </tr>
            </thead>
            <tbody>
              {rows.filter((r) => r.is_active).map((row) => (
                <tr key={row.id} className="border-t hover:bg-slate-50/60">
                  {editingId === row.id ? (
                    <>
                      <td className="px-4 py-2"><input type="text" className="w-24 rounded border px-2 py-1 text-xs" value={editData.state ?? editData.state_name ?? editData.state_code ?? ""} onChange={(e) => setEditData((p) => ({ ...p, state: e.target.value, state_name: e.target.value }))} /></td>
                      <td className="px-4 py-2">
                        <select className="rounded border px-2 py-1 text-xs" value={editData.skill_category ?? editData.category ?? "unskilled"} onChange={(e) => setEditData((p) => ({ ...p, skill_category: e.target.value, category: e.target.value }))}>
                          {["unskilled", "semi_skilled", "skilled", "highly_skilled"].map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-2"><input type="number" className="w-20 rounded border px-2 py-1 text-xs" value={editData.daily_rate ?? ""} onChange={(e) => setEditData((p) => ({ ...p, daily_rate: e.target.value }))} /></td>
                      <td className="px-4 py-2"><input type="number" className="w-24 rounded border px-2 py-1 text-xs" value={editData.monthly_rate ?? ""} onChange={(e) => setEditData((p) => ({ ...p, monthly_rate: e.target.value }))} /></td>
                      <td className="px-4 py-2"><input type="date" className="w-32 rounded border px-2 py-1 text-xs" value={editData.effective_from ?? ""} onChange={(e) => setEditData((p) => ({ ...p, effective_from: e.target.value }))} /></td>
                      <td className="px-4 py-2 text-right space-x-1">
                        <button onClick={() => void handleSaveEdit()} disabled={saving} className="text-xs bg-blue-600 text-white px-2.5 py-1 rounded cursor-pointer disabled:opacity-50">{saving ? "…" : "Save"}</button>
                        <button onClick={() => setEditingId(null)} className="text-xs border px-2.5 py-1 rounded cursor-pointer">Cancel</button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-2.5 font-medium text-slate-800">{row.state ?? row.state_name ?? row.state_code ?? "—"}</td>
                      <td className="px-4 py-2.5 text-slate-600 capitalize">{(row.skill_category ?? row.category ?? "").replace("_", " ")}</td>
                      <td className="px-4 py-2.5 text-slate-700">{row.daily_rate ? `₹${row.daily_rate}` : "—"}</td>
                      <td className="px-4 py-2.5 font-semibold text-slate-900">{row.monthly_rate ? `₹${Number(row.monthly_rate).toLocaleString("en-IN")}` : "—"}</td>
                      <td className="px-4 py-2.5 text-xs text-slate-500">{fmtDate(row.effective_from)}</td>
                      {isSuperAdmin && (
                        <td className="px-4 py-2.5 text-right">
                          <button
                            onClick={() => { setEditingId(row.id); setEditData({ state: row.state ?? row.state_name ?? row.state_code, state_name: row.state_name, state_code: row.state_code, skill_category: row.skill_category ?? row.category, category: row.category ?? row.skill_category, daily_rate: row.daily_rate, monthly_rate: row.monthly_rate, effective_from: row.effective_from?.slice(0, 10) }); }}
                            className="rounded-lg border px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 cursor-pointer"
                          >
                            <Edit2 className="h-3 w-3 inline-block mr-1" />Edit
                          </button>
                        </td>
                      )}
                    </>
                  )}
                </tr>
              ))}
              {rows.filter((r) => r.is_active).length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-slate-400">No minimum wage entries found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {isSuperAdmin && (
        showAdd ? (
          <div className="rounded-2xl border border-blue-200 bg-blue-50/40 p-4 space-y-3">
            <p className="text-sm font-semibold text-slate-700">Add Minimum Wage Entry</p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <div>
                <label className="text-xs text-slate-500 mb-1 block">State</label>
                <input type="text" placeholder="e.g. Maharashtra" value={newRow.state} onChange={(e) => setNewRow((p) => ({ ...p, state: e.target.value }))} className="w-full rounded-lg border px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Category</label>
                <select value={newRow.skill_category} onChange={(e) => setNewRow((p) => ({ ...p, skill_category: e.target.value }))} className="w-full rounded-lg border px-3 py-1.5 text-sm focus:outline-none">
                  {["unskilled", "semi_skilled", "skilled", "highly_skilled"].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Monthly Rate (₹)</label>
                <input type="number" placeholder="e.g. 15000" value={newRow.monthly_rate} onChange={(e) => setNewRow((p) => ({ ...p, monthly_rate: e.target.value }))} className="w-full rounded-lg border px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Daily Rate (₹)</label>
                <input type="number" placeholder="e.g. 577" value={newRow.daily_rate} onChange={(e) => setNewRow((p) => ({ ...p, daily_rate: e.target.value }))} className="w-full rounded-lg border px-3 py-1.5 text-sm focus:outline-none" />
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Effective From</label>
                <input type="date" value={newRow.effective_from} onChange={(e) => setNewRow((p) => ({ ...p, effective_from: e.target.value }))} className="w-full rounded-lg border px-3 py-1.5 text-sm focus:outline-none" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => void handleAdd()} disabled={saving || !newRow.state || !newRow.monthly_rate} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer">
                {saving ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Add Entry
              </button>
              <button onClick={() => setShowAdd(false)} className="inline-flex items-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer">Cancel</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setShowAdd(true)} className="inline-flex items-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer">
            <Plus className="h-4 w-4" /> Add Minimum Wage Entry
          </button>
        )
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function NativeStatutoryConfig() {
  const { roleKeys } = useWorkforceAccess();
  const isSuperAdmin = roleKeys.includes("super_admin");

  const [rows, setRows] = useState<StatutoryConfigRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [historyKey, setHistoryKey] = useState<string | null>(null);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    pf: true, esic: true, tds: true, gratuity: true, lwp: true, minwages: true,
  });

  // ── PT Slab state ──────────────────────────────────────────────────────────
  const [ptStateCode, setPtStateCode] = useState("MH");
  const [ptSlabs, setPtSlabs] = useState<PtSlab[]>([]);
  const [ptLoading, setPtLoading] = useState(false);
  const [ptFormOpen, setPtFormOpen] = useState(false);
  const [ptEditId, setPtEditId] = useState<string | null>(null);
  const [ptForm, setPtForm] = useState<PtSlabForm>({
    state_code: "MH",
    state_name: "Maharashtra",
    income_from: "",
    income_to: "",
    pt_amount: "",
    frequency: "monthly",
    effective_from: new Date().toISOString().slice(0, 10),
  });

  const loadPtSlabs = useCallback(async (sc: string) => {
    setPtLoading(true);
    try {
      const r = await apiGet<{ data?: PtSlab[]; success?: boolean } | PtSlab[]>(
        `/api/payroll/pt-slabs?state_code=${sc}`
      );
      const slabs = Array.isArray(r) ? r : ((r as { data?: PtSlab[] }).data ?? []);
      setPtSlabs(slabs);
    } catch {
      showToast("Failed to load PT slabs", "error");
    } finally {
      setPtLoading(false);
    }
  }, [showToast]);

  useEffect(() => { void loadPtSlabs(ptStateCode); }, [ptStateCode, loadPtSlabs]);

  const toggleSection = (key: string) => setOpenSections((p) => ({ ...p, [key]: !p[key] }));
  const showToast = useCallback((message: string, type: "success" | "error") => setToast({ message, type }), []);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const r = await apiGet<{ success: boolean; details?: StatutoryConfigRow[]; data?: unknown }>("/api/payroll/statutory-config");
      setRows(r.details ?? []);
    } catch (e: unknown) {
      setError((e as Error).message ?? "Failed to load statutory configuration");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const cfg: ConfigMap = {};
  for (const row of rows) cfg[row.config_key] = row;

  const tdsNewSlabs = rows.filter((r) => r.config_key.startsWith("tds_slab_"));
  const tdsOldSlabs = rows.filter((r) => r.config_key.startsWith("tds_old_slab_"));

  const handleSaveConfig = async (key: string, newValue: string, reason: string) => {
    await apiPatch(`/api/payroll/statutory-config/${key}`, { value: Number(newValue), reason: reason || undefined });
    setRows((prev) => prev.map((r) => r.config_key === key ? { ...r, config_value: newValue } : r));
    showToast(`${key} updated — takes effect in next payroll run.`, "success");
  };

  const v = (key: string) => cfg[key]?.config_value ?? "";
  const note = (key: string) => cfg[key]?.description ?? "";

  return (
    <DashboardLayout>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      {historyKey && <HistoryPanel configKey={historyKey} onClose={() => setHistoryKey(null)} />}

      <div className="space-y-6">

        {/* ── Page Header ─────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">Payroll Settings</p>
            <h1 className="mt-2 text-3xl font-black text-slate-950">Statutory Configuration</h1>
            {isSuperAdmin ? (
              <div className="mt-2 flex items-center gap-2 text-sm text-emerald-700 font-semibold">
                <Shield className="h-4 w-4" />
                <span>Super Admin — edit mode enabled. All changes are audit-logged.</span>
              </div>
            ) : (
              <div className="mt-2 flex items-center gap-2 text-sm text-slate-500">
                <Info className="h-4 w-4 flex-shrink-0 text-amber-500" />
                <span>Read-only view. Only Super Admin can modify statutory configuration.</span>
              </div>
            )}
          </div>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50 self-start lg:self-auto"
          >
            <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {/* ── Error Banner ─────────────────────────────────────────────────── */}
        {error && (
          <div className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-3 py-12 justify-center text-slate-400">
            <Loader className="h-5 w-5 animate-spin" /> Loading configuration...
          </div>
        )}

        {!loading && rows.length > 0 && (
          <div className="space-y-4">

            {/* ── Section 1: Provident Fund ─────────────────────────────────── */}
            <div className="rounded-3xl border bg-white p-6 shadow-sm">
              <SectionHeader
                icon={<Shield className="h-5 w-5" />}
                title="Provident Fund (PF)"
                subtitle="Deducted on Basic Salary — statutory ceiling configurable"
                collapsible
                open={openSections.pf}
                onToggle={() => toggleSection("pf")}
              />
              {openSections.pf && (
                <>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
                    {(["pf_employee_pct", "PF_EMPLOYEE_PCT"] as const).filter((k) => cfg[k]).slice(0, 1).map((k) => (
                      <EditableRow key={k} configKey={k} label="Employee Contribution" value={v(k)} unit="%" note={note(k)} isSuperAdmin={isSuperAdmin} onSave={handleSaveConfig} showHistory={setHistoryKey} />
                    ))}
                    {!cfg["pf_employee_pct"] && !cfg["PF_EMPLOYEE_PCT"] && (
                      <EditableRow configKey="PF_EMPLOYEE_PCT" label="Employee Contribution" value={v("PF_EMPLOYEE_PCT")} unit="%" isSuperAdmin={isSuperAdmin} onSave={handleSaveConfig} showHistory={setHistoryKey} />
                    )}
                    {(["pf_employer_pct", "PF_EMPLOYER_PCT"] as const).filter((k) => cfg[k]).slice(0, 1).map((k) => (
                      <EditableRow key={k} configKey={k} label="Employer Contribution" value={v(k)} unit="%" note={note(k)} isSuperAdmin={isSuperAdmin} onSave={handleSaveConfig} showHistory={setHistoryKey} />
                    ))}
                    {!cfg["pf_employer_pct"] && !cfg["PF_EMPLOYER_PCT"] && (
                      <EditableRow configKey="PF_EMPLOYER_PCT" label="Employer Contribution" value={v("PF_EMPLOYER_PCT")} unit="%" isSuperAdmin={isSuperAdmin} onSave={handleSaveConfig} showHistory={setHistoryKey} />
                    )}
                    {(["pf_wage_ceiling", "PF_WAGE_LIMIT"] as const).filter((k) => cfg[k]).slice(0, 1).map((k) => (
                      <EditableRow key={k} configKey={k} label="PF Wage Ceiling" value={v(k)} unit="₹" note={note(k)} isSuperAdmin={isSuperAdmin} onSave={handleSaveConfig} showHistory={setHistoryKey} />
                    ))}
                    {!cfg["pf_wage_ceiling"] && !cfg["PF_WAGE_LIMIT"] && (
                      <EditableRow configKey="pf_wage_ceiling" label="PF Wage Ceiling" value="" unit="₹" isSuperAdmin={isSuperAdmin} onSave={handleSaveConfig} showHistory={setHistoryKey} />
                    )}
                  </div>
                  <p className="mt-4 text-xs text-slate-400 italic">
                    PF is computed on min(Basic, PF wage ceiling). Employer 12% splits into EPF 3.67% + EPS 8.33%.
                  </p>
                </>
              )}
            </div>

            {/* ── Section 2: ESIC ───────────────────────────────────────────── */}
            <div className="rounded-3xl border bg-white p-6 shadow-sm">
              <SectionHeader
                icon={<BadgePercent className="h-5 w-5" />}
                title="Employees' State Insurance (ESIC)"
                subtitle="Applicable only when Gross Salary is at or below the wage limit"
                collapsible
                open={openSections.esic}
                onToggle={() => toggleSection("esic")}
              />
              {openSections.esic && (
                <>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
                    {(["esic_employee_pct", "ESIC_EMPLOYEE_PCT"] as const).filter((k) => cfg[k]).slice(0, 1).map((k) => (
                      <EditableRow key={k} configKey={k} label="Employee Contribution" value={v(k)} unit="%" note={note(k)} isSuperAdmin={isSuperAdmin} onSave={handleSaveConfig} showHistory={setHistoryKey} />
                    ))}
                    {!cfg["esic_employee_pct"] && !cfg["ESIC_EMPLOYEE_PCT"] && (
                      <EditableRow configKey="ESIC_EMPLOYEE_PCT" label="Employee Contribution" value="0.75" unit="%" isSuperAdmin={isSuperAdmin} onSave={handleSaveConfig} showHistory={setHistoryKey} />
                    )}
                    {(["esic_employer_pct", "ESIC_EMPLOYER_PCT"] as const).filter((k) => cfg[k]).slice(0, 1).map((k) => (
                      <EditableRow key={k} configKey={k} label="Employer Contribution" value={v(k)} unit="%" note={note(k)} isSuperAdmin={isSuperAdmin} onSave={handleSaveConfig} showHistory={setHistoryKey} />
                    ))}
                    {!cfg["esic_employer_pct"] && !cfg["ESIC_EMPLOYER_PCT"] && (
                      <EditableRow configKey="ESIC_EMPLOYER_PCT" label="Employer Contribution" value="3.25" unit="%" isSuperAdmin={isSuperAdmin} onSave={handleSaveConfig} showHistory={setHistoryKey} />
                    )}
                    {(["esic_wage_limit", "ESIC_WAGE_LIMIT"] as const).filter((k) => cfg[k]).slice(0, 1).map((k) => (
                      <EditableRow key={k} configKey={k} label="Gross Wage Limit" value={v(k)} unit="₹" note="ESIC not applicable above this limit" isSuperAdmin={isSuperAdmin} onSave={handleSaveConfig} showHistory={setHistoryKey} />
                    ))}
                    {!cfg["esic_wage_limit"] && !cfg["ESIC_WAGE_LIMIT"] && (
                      <EditableRow configKey="ESIC_WAGE_LIMIT" label="Gross Wage Limit" value="21000" unit="₹" note="ESIC not applicable above this limit" isSuperAdmin={isSuperAdmin} onSave={handleSaveConfig} showHistory={setHistoryKey} />
                    )}
                  </div>
                  <p className="mt-4 text-xs text-slate-400 italic">
                    ESIC is calculated on full gross salary. Above the wage limit, no ESIC applies.
                  </p>
                </>
              )}
            </div>

            {/* ── Section 3: TDS Configuration ─────────────────────────────── */}
            <div className="rounded-3xl border bg-white p-6 shadow-sm">
              <SectionHeader
                icon={<BookOpen className="h-5 w-5" />}
                title="TDS Configuration"
                subtitle="Income tax deduction at source — slabs, standard deduction, rebates"
                collapsible
                open={openSections.tds}
                onToggle={() => toggleSection("tds")}
              />
              {openSections.tds && (
                <div className="space-y-5">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <EditableRow configKey="tds_standard_deduction" label="Standard Deduction (New Regime)" value={v("tds_standard_deduction")} unit="₹" note={note("tds_standard_deduction") || "FY 2025-26: ₹75,000"} isSuperAdmin={isSuperAdmin} onSave={handleSaveConfig} showHistory={setHistoryKey} />
                    <EditableRow configKey="tds_rebate_87a_limit" label="Rebate 87A — Income Limit" value={v("tds_rebate_87a_limit")} unit="₹" note={note("tds_rebate_87a_limit") || "Rebate available if net taxable ≤ this limit"} isSuperAdmin={isSuperAdmin} onSave={handleSaveConfig} showHistory={setHistoryKey} />
                  </div>

                  {/* New Regime Slabs */}
                  {tdsNewSlabs.length > 0 && (
                    <div>
                      <p className="text-sm font-semibold text-slate-700 mb-2">New Regime Slabs (FY 2025-26)</p>
                      <div className="overflow-hidden rounded-2xl border border-slate-200">
                        <table className="w-full text-sm">
                          <thead className="bg-slate-50">
                            <tr>
                              <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-slate-500">Income Band</th>
                              <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-slate-500">Rate</th>
                              {isSuperAdmin && <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase text-slate-500">Actions</th>}
                            </tr>
                          </thead>
                          <tbody>
                            {tdsNewSlabs.map((slab, idx) => (
                              <SlabEditRow
                                key={slab.config_key}
                                slab={slab}
                                idx={idx}
                                isSuperAdmin={isSuperAdmin}
                                onSave={handleSaveConfig}
                                showHistory={setHistoryKey}
                              />
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Old Regime Slabs */}
                  {tdsOldSlabs.length > 0 && (
                    <div>
                      <p className="text-sm font-semibold text-slate-700 mb-2">Old Regime Slabs</p>
                      <div className="overflow-hidden rounded-2xl border border-slate-200">
                        <table className="w-full text-sm">
                          <thead className="bg-slate-50">
                            <tr>
                              <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-slate-500">Income Band</th>
                              <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-slate-500">Rate</th>
                              {isSuperAdmin && <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase text-slate-500">Actions</th>}
                            </tr>
                          </thead>
                          <tbody>
                            {tdsOldSlabs.map((slab, idx) => (
                              <SlabEditRow
                                key={slab.config_key}
                                slab={slab}
                                idx={idx}
                                isSuperAdmin={isSuperAdmin}
                                onSave={handleSaveConfig}
                                showHistory={setHistoryKey}
                              />
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── Section 4: Gratuity ──────────────────────────────────────── */}
            <div className="rounded-3xl border bg-white p-6 shadow-sm">
              <SectionHeader
                icon={<TrendingUp className="h-5 w-5" />}
                title="Gratuity"
                subtitle="Employer cost — not deducted from employee salary"
                collapsible
                open={openSections.gratuity}
                onToggle={() => toggleSection("gratuity")}
              />
              {openSections.gratuity && (
                <>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
                    <EditableRow configKey="gratuity_multiplier" label="Multiplier (days)" value={v("gratuity_multiplier") || "15"} note="Standard = 15" isSuperAdmin={isSuperAdmin} onSave={handleSaveConfig} showHistory={setHistoryKey} />
                    <EditableRow configKey="gratuity_divisor" label="Divisor (working days)" value={v("gratuity_divisor") || "26"} note="Standard = 26" isSuperAdmin={isSuperAdmin} onSave={handleSaveConfig} showHistory={setHistoryKey} />
                    <EditableRow configKey="gratuity_min_service_months" label="Min Service (months)" value={v("gratuity_min_service_months") || "60"} note="Standard = 60 months (5 years)" isSuperAdmin={isSuperAdmin} onSave={handleSaveConfig} showHistory={setHistoryKey} />
                    <EditableRow configKey="gratuity_statutory_cap" label="Statutory Cap (₹)" value={v("gratuity_statutory_cap") || "2000000"} unit="₹" note="Tax-exempt cap under Income Tax Act" isSuperAdmin={isSuperAdmin} onSave={handleSaveConfig} showHistory={setHistoryKey} />
                  </div>
                  <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
                    <p className="text-xs font-semibold text-amber-800 mb-1.5">Formula</p>
                    <p className="text-sm text-amber-900 font-mono">
                      Gratuity = (Last Basic × Multiplier × Years of Service) / Divisor
                    </p>
                    <p className="text-xs text-amber-700 mt-1">Capped at statutory cap amount. Requires ≥ min service months.</p>
                  </div>
                </>
              )}
            </div>

            {/* ── Section 5: LWP ──────────────────────────────────────────── */}
            <div className="rounded-3xl border bg-white p-6 shadow-sm">
              <SectionHeader
                icon={<Calendar className="h-5 w-5" />}
                title="Leave Without Pay (LWP)"
                subtitle="Controls how unpaid leave days are factored into salary calculation"
                collapsible
                open={openSections.lwp}
                onToggle={() => toggleSection("lwp")}
              />
              {openSections.lwp && (
                <>
                  <div className="max-w-sm">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">LWP Deduction Basis</p>
                    {isSuperAdmin ? (
                      <LwpBasisSelector
                        value={v("lwp_deduction_basis") || v("lwp_basis") || "Calendar Days"}
                        configKey={v("lwp_deduction_basis") !== undefined ? "lwp_deduction_basis" : "lwp_basis"}
                        onSave={handleSaveConfig}
                      />
                    ) : (
                      <div className="rounded-2xl border border-blue-200 bg-blue-50/60 p-4">
                        <p className="text-2xl font-black text-blue-700">{v("lwp_deduction_basis") || v("lwp_basis") || "Calendar Days"}</p>
                      </div>
                    )}
                  </div>
                  <p className="mt-4 text-xs text-slate-400 italic">
                    Salary is scaled by (total_days − lwp_days) / total_days across all fixed CTC components.
                  </p>
                </>
              )}
            </div>

            {/* ── Section 6: Minimum Wages ─────────────────────────────────── */}
            <div className="rounded-3xl border bg-white p-6 shadow-sm">
              <SectionHeader
                icon={<Building2 className="h-5 w-5" />}
                title="Minimum Wages"
                subtitle="State-wise minimum wage rates by skill category"
                collapsible
                open={openSections.minwages}
                onToggle={() => toggleSection("minwages")}
              />
              {openSections.minwages && (
                <MinimumWagesSection isSuperAdmin={isSuperAdmin} onToast={showToast} />
              )}
            </div>

            {/* ── Section PT: Professional Tax Slabs ───────────────────────── */}
            <div className="rounded-3xl border bg-white shadow-sm overflow-hidden">
              <div className="border-b p-5 flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <div className="rounded-2xl bg-slate-100 p-2.5 text-slate-700"><BadgePercent className="h-5 w-5" /></div>
                  <div>
                    <h2 className="text-base font-black text-slate-950">Professional Tax Slabs</h2>
                    <p className="text-sm text-slate-500 mt-0.5">State-wise PT slab configuration used in payroll deduction</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    className="rounded-xl border border-slate-200 px-3 py-1.5 text-sm bg-white"
                    value={ptStateCode}
                    onChange={(e) => setPtStateCode(e.target.value)}
                  >
                    {["MH","KA","TN","AP","TS","WB","GJ","MP","UP","HR","RJ","DL","PB","BR","OR"].map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  {isSuperAdmin && (
                    <button
                      className="flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-700"
                      onClick={() => {
                        setPtEditId(null);
                        setPtForm((p) => ({ ...p, state_code: ptStateCode }));
                        setPtFormOpen(true);
                      }}
                    >
                      <Plus className="h-4 w-4" /> Add Slab
                    </button>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <tr>
                      {["State","Income From","Income To","PT Amount","Frequency","Effective From","Active","Actions"].map((h) => (
                        <th key={h} className="px-5 py-3.5 font-semibold">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ptLoading ? (
                      <tr><td colSpan={8} className="px-5 py-8 text-center text-slate-400">Loading slabs…</td></tr>
                    ) : ptSlabs.length === 0 ? (
                      <tr><td colSpan={8} className="px-5 py-8 text-center text-slate-400">No PT slabs configured for {ptStateCode}</td></tr>
                    ) : ptSlabs.map((slab) => (
                      <tr key={slab.id} className="border-t">
                        <td className="px-5 py-3 font-mono text-xs">{slab.state_code}</td>
                        <td className="px-5 py-3">₹{Number(slab.income_from).toLocaleString("en-IN")}</td>
                        <td className="px-5 py-3">{slab.income_to != null ? `₹${Number(slab.income_to).toLocaleString("en-IN")}` : "No limit"}</td>
                        <td className="px-5 py-3 font-semibold">₹{slab.pt_amount}</td>
                        <td className="px-5 py-3 capitalize">{slab.frequency}</td>
                        <td className="px-5 py-3">{slab.effective_from?.slice(0, 10)}</td>
                        <td className="px-5 py-3">
                          {isSuperAdmin ? (
                            <button
                              className={`text-xs px-2.5 py-0.5 rounded-full border font-medium ${slab.is_active ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100" : "bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100"}`}
                              onClick={async () => {
                                try {
                                  await apiPatch(`/api/payroll/pt-slabs/${slab.id}`, { is_active: slab.is_active ? 0 : 1 });
                                  void loadPtSlabs(ptStateCode);
                                } catch {
                                  showToast("Toggle failed", "error");
                                }
                              }}
                            >
                              {slab.is_active ? "Active" : "Inactive"}
                            </button>
                          ) : (
                            <span className={`text-xs px-2.5 py-0.5 rounded-full border font-medium ${slab.is_active ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-50 text-slate-500 border-slate-200"}`}>
                              {slab.is_active ? "Active" : "Inactive"}
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          {isSuperAdmin && (
                            <button
                              className="text-xs px-2.5 py-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 font-medium flex items-center gap-1"
                              onClick={() => {
                                setPtEditId(slab.id);
                                setPtForm({
                                  state_code: slab.state_code,
                                  state_name: slab.state_name ?? "",
                                  income_from: String(slab.income_from),
                                  income_to: slab.income_to != null ? String(slab.income_to) : "",
                                  pt_amount: String(slab.pt_amount),
                                  frequency: slab.frequency ?? "monthly",
                                  effective_from: slab.effective_from?.slice(0, 10) ?? "",
                                });
                                setPtFormOpen(true);
                              }}
                            >
                              <Edit2 className="h-3 w-3" /> Edit
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* PT Slab Add/Edit Dialog */}
            {ptFormOpen && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
                <div className="bg-white rounded-3xl border shadow-xl p-6 w-full max-w-md space-y-4 mx-4">
                  <div className="flex items-center justify-between">
                    <h4 className="font-black text-slate-950">{ptEditId ? "Edit PT Slab" : "Add PT Slab"}</h4>
                    <button className="text-slate-400 hover:text-slate-700" onClick={() => { setPtFormOpen(false); setPtEditId(null); }}><X className="h-5 w-5" /></button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {([
                      { label: "State Code", key: "state_code" as keyof PtSlabForm, placeholder: "MH" },
                      { label: "State Name", key: "state_name" as keyof PtSlabForm, placeholder: "Maharashtra" },
                      { label: "Income From (₹)", key: "income_from" as keyof PtSlabForm, placeholder: "0" },
                      { label: "Income To (₹, blank = no limit)", key: "income_to" as keyof PtSlabForm, placeholder: "Leave blank for highest slab" },
                      { label: "PT Amount (₹)", key: "pt_amount" as keyof PtSlabForm, placeholder: "200" },
                      { label: "Effective From", key: "effective_from" as keyof PtSlabForm, placeholder: "YYYY-MM-DD" },
                    ] as { label: string; key: keyof PtSlabForm; placeholder: string }[]).map(({ label, key, placeholder }) => (
                      <div key={key} className="space-y-1">
                        <label className="text-xs font-semibold text-slate-600">{label}</label>
                        <input
                          className="w-full rounded-xl border border-slate-200 px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-300"
                          value={ptForm[key]}
                          placeholder={placeholder}
                          onChange={(e) => setPtForm((p) => ({ ...p, [key]: e.target.value }))}
                        />
                      </div>
                    ))}
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-600">Frequency</label>
                      <select
                        className="w-full rounded-xl border border-slate-200 px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-300"
                        value={ptForm.frequency}
                        onChange={(e) => setPtForm((p) => ({ ...p, frequency: e.target.value }))}
                      >
                        <option value="monthly">Monthly</option>
                        <option value="semi-annual">Semi-Annual</option>
                        <option value="annual">Annual</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      className="px-4 py-2 rounded-xl border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 font-medium"
                      onClick={() => { setPtFormOpen(false); setPtEditId(null); }}
                    >
                      Cancel
                    </button>
                    <button
                      className="px-4 py-2 rounded-xl bg-slate-900 text-sm text-white font-semibold hover:bg-slate-700 flex items-center gap-1.5"
                      onClick={async () => {
                        try {
                          const payload = {
                            state_code: ptForm.state_code.trim(),
                            state_name: ptForm.state_name.trim() || undefined,
                            income_from: Number(ptForm.income_from),
                            income_to: ptForm.income_to ? Number(ptForm.income_to) : null,
                            pt_amount: Number(ptForm.pt_amount),
                            frequency: ptForm.frequency,
                            effective_from: ptForm.effective_from,
                          };
                          if (ptEditId) {
                            await apiPatch(`/api/payroll/pt-slabs/${ptEditId}`, payload);
                          } else {
                            await apiPost(`/api/payroll/pt-slabs`, payload);
                          }
                          showToast(ptEditId ? "Slab updated" : "Slab created", "success");
                          void loadPtSlabs(ptStateCode);
                          setPtFormOpen(false);
                          setPtEditId(null);
                          setPtForm({ state_code: ptStateCode, state_name: "", income_from: "", income_to: "", pt_amount: "", frequency: "monthly", effective_from: new Date().toISOString().slice(0, 10) });
                        } catch {
                          showToast("Save failed", "error");
                        }
                      }}
                    >
                      <Save className="h-4 w-4" />
                      Save
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── Section 7: Raw All-Keys Table ─────────────────────────────── */}
            <div className="rounded-3xl border bg-white shadow-sm overflow-hidden">
              <div className="border-b p-5 flex items-center justify-between">
                <div>
                  <h2 className="font-black text-slate-950">All Configuration Keys</h2>
                  <p className="text-sm text-slate-500 mt-0.5">{rows.length} key{rows.length !== 1 ? "s" : ""} — raw statutory_config view</p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-5 py-3.5 font-semibold">Config Key</th>
                      <th className="px-5 py-3.5 font-semibold">Value</th>
                      <th className="px-5 py-3.5 font-semibold hidden md:table-cell">Description</th>
                      <th className="px-5 py-3.5 font-semibold text-right hidden lg:table-cell">Last Updated</th>
                      {isSuperAdmin && <th className="px-5 py-3.5 font-semibold text-right">Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, idx) => (
                      <RawConfigRow
                        key={row.config_key}
                        row={row}
                        idx={idx}
                        isSuperAdmin={isSuperAdmin}
                        onSave={handleSaveConfig}
                        showHistory={setHistoryKey}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}

        {!loading && rows.length === 0 && !error && (
          <div className="rounded-3xl border bg-white p-16 text-center shadow-sm">
            <Shield className="mx-auto mb-3 h-10 w-10 text-slate-300" />
            <p className="font-semibold text-slate-500">No statutory configuration found.</p>
            <p className="mt-1 text-sm text-slate-400">
              Ensure the <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">statutory_config</code> table is seeded.
            </p>
          </div>
        )}

      </div>
    </DashboardLayout>
  );
}

// ─── Slab Edit Row ────────────────────────────────────────────────────────────

function SlabEditRow({
  slab,
  idx,
  isSuperAdmin,
  onSave,
  showHistory,
}: {
  slab: StatutoryConfigRow;
  idx: number;
  isSuperAdmin: boolean;
  onSave: (key: string, value: string, reason: string) => Promise<void>;
  showHistory: (key: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(slab.config_value);
  const [saving, setSaving] = useState(false);

  const label = slab.config_key
    .replace("tds_slab_", "")
    .replace("tds_old_slab_", "")
    .replace(/_/g, " – ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <tr className={`border-t ${idx % 2 === 0 ? "bg-white" : "bg-slate-50/60"}`}>
      <td className="px-4 py-3 font-medium text-slate-800">{label}</td>
      <td className="px-4 py-3">
        {editing ? (
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={val}
              onChange={(e) => setVal(e.target.value)}
              className="w-20 rounded-lg border border-blue-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              step="0.01"
              min="0"
              max="100"
            />
            <span className="text-sm text-slate-500">%</span>
          </div>
        ) : (
          <span className="inline-flex items-center rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">
            {parseFloat(slab.config_value)}%
          </span>
        )}
      </td>
      {isSuperAdmin && (
        <td className="px-4 py-3 text-right space-x-1">
          {editing ? (
            <>
              <button
                onClick={async () => {
                  setSaving(true);
                  try { await onSave(slab.config_key, val, ""); setEditing(false); }
                  finally { setSaving(false); }
                }}
                disabled={saving}
                className="text-xs bg-blue-600 text-white px-2.5 py-1 rounded cursor-pointer disabled:opacity-50"
              >
                {saving ? "…" : "Save"}
              </button>
              <button onClick={() => { setEditing(false); setVal(slab.config_value); }} className="text-xs border px-2.5 py-1 rounded cursor-pointer">Cancel</button>
            </>
          ) : (
            <>
              <button onClick={() => setEditing(true)} className="text-xs border px-2.5 py-1 rounded cursor-pointer hover:bg-slate-50">
                <Edit2 className="h-3 w-3 inline" />
              </button>
              <button onClick={() => showHistory(slab.config_key)} className="text-xs border px-2.5 py-1 rounded cursor-pointer hover:bg-slate-50 ml-1">
                <History className="h-3 w-3 inline" />
              </button>
            </>
          )}
        </td>
      )}
    </tr>
  );
}

// ─── LWP Basis Selector ───────────────────────────────────────────────────────

function LwpBasisSelector({
  value,
  configKey,
  onSave,
}: {
  value: string;
  configKey: string;
  onSave: (key: string, val: string, reason: string) => Promise<void>;
}) {
  const [selected, setSelected] = useState(value);
  const [saving, setSaving] = useState(false);

  const OPTIONS = ["Calendar Days", "Working Days", "Paid Days"];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {OPTIONS.map((opt) => (
          <button
            key={opt}
            onClick={() => setSelected(opt)}
            className={`rounded-xl border px-4 py-2 text-sm font-semibold transition-colors cursor-pointer ${
              selected === opt ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {opt}
          </button>
        ))}
      </div>
      {selected !== value && (
        <button
          onClick={async () => {
            setSaving(true);
            try { await onSave(configKey, selected, ""); }
            finally { setSaving(false); }
          }}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
        >
          {saving ? <Loader className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          Save Change
        </button>
      )}
    </div>
  );
}

// ─── Raw Config Row ───────────────────────────────────────────────────────────

function RawConfigRow({
  row,
  idx,
  isSuperAdmin,
  onSave,
  showHistory,
}: {
  row: StatutoryConfigRow;
  idx: number;
  isSuperAdmin: boolean;
  onSave: (key: string, val: string, reason: string) => Promise<void>;
  showHistory: (key: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(row.config_value);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const fmtDate = (raw: string) => {
    if (!raw) return "—";
    try { return new Date(raw).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }); }
    catch { return raw; }
  };

  return (
    <tr className={`border-t transition-colors hover:bg-slate-50/80 ${idx % 2 === 0 ? "bg-white" : "bg-slate-50/40"}`}>
      <td className="px-5 py-3.5">
        <code className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-mono text-slate-700">{row.config_key}</code>
      </td>
      <td className="px-5 py-3.5">
        {editing ? (
          <div className="space-y-1.5">
            <input
              type="text"
              value={val}
              onChange={(e) => setVal(e.target.value)}
              className="w-32 rounded border border-blue-300 px-2 py-1 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <input
              type="text"
              placeholder="Reason (optional)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-48 rounded border px-2 py-1 text-xs text-slate-700 focus:outline-none"
            />
            <div className="flex gap-1.5">
              <button
                onClick={async () => {
                  setSaving(true);
                  try { await onSave(row.config_key, val, reason); setEditing(false); setReason(""); }
                  finally { setSaving(false); }
                }}
                disabled={saving}
                className="text-xs bg-blue-600 text-white px-2.5 py-1 rounded cursor-pointer disabled:opacity-50"
              >
                {saving ? "…" : "Save"}
              </button>
              <button onClick={() => { setEditing(false); setVal(row.config_value); setReason(""); }} className="text-xs border px-2.5 py-1 rounded cursor-pointer">Cancel</button>
            </div>
          </div>
        ) : (
          <span className="font-bold text-slate-900">{row.config_value ?? "—"}</span>
        )}
      </td>
      <td className="px-5 py-3.5 text-slate-500 hidden md:table-cell">{row.description || "—"}</td>
      <td className="px-5 py-3.5 text-right font-mono text-xs text-slate-400 hidden lg:table-cell">{fmtDate(row.updated_at)}</td>
      {isSuperAdmin && (
        <td className="px-5 py-3.5 text-right space-x-1 whitespace-nowrap">
          {!editing && (
            <>
              <button onClick={() => setEditing(true)} className="text-xs border px-2.5 py-1 rounded cursor-pointer hover:bg-slate-50">
                <Edit2 className="h-3 w-3 inline" />
              </button>
              <button onClick={() => showHistory(row.config_key)} className="text-xs border px-2.5 py-1 rounded cursor-pointer hover:bg-slate-50">
                <History className="h-3 w-3 inline" />
              </button>
            </>
          )}
        </td>
      )}
    </tr>
  );
}
