import { useEffect, useState, useCallback } from "react";
import {
  AlertTriangle, Box, CheckCircle2, History, Loader, Pencil,
  Plus, RefreshCcw, Search, Tag, Wrench, X, AlertCircle, Settings,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { StatusBadge as SmartHRStatusBadge, normalizeStatus } from "@/components/ui/status-badge";

// ─── Types ────────────────────────────────────────────────────────────────────

type Asset = {
  id: string;
  asset_code: string;
  asset_name: string;
  asset_category: string;
  asset_type?: string;
  serial_number?: string;
  purchase_date?: string;
  purchase_cost?: number;
  vendor?: string;
  warranty_expiry?: string;
  branch_id?: string;
  branch_name?: string;
  status: "available" | "assigned" | "maintenance" | "repair" | "retired" | "lost";
  assigned_to?: string;
  assigned_employee_name?: string;
  assigned_employee_code?: string;
  assigned_date?: string;
  notes?: string;
  created_at: string;
};

type Branch = { id: string; branch_name: string; branch_code: string };
type EmployeeHit = { id: string; employee_code: string; first_name: string; last_name?: string };
type HistoryRow = {
  id: string;
  employee_name: string;
  employee_code: string;
  assigned_date: string;
  returned_date?: string;
  return_condition?: string;
  notes?: string;
  assigned_by?: string;
};

type AddAssetForm = {
  asset_code: string; asset_name: string; asset_category: string; asset_type: string;
  serial_number: string; purchase_date: string; purchase_cost: string; vendor: string;
  warranty_expiry: string; branch_id: string; notes: string;
};
type AssignForm    = { employee_id: string; notes: string };
type ReturnForm    = { condition: string };
type ServiceForm   = { service_type: string; service_date: string; cost: string; performed_by: string; service_notes: string };

const EMPTY_ADD: AddAssetForm = {
  asset_code: "", asset_name: "", asset_category: "", asset_type: "", serial_number: "",
  purchase_date: "", purchase_cost: "", vendor: "", warranty_expiry: "", branch_id: "", notes: "",
};
const EMPTY_SERVICE: ServiceForm = { service_type: "maintenance", service_date: "", cost: "", performed_by: "", service_notes: "" };

// ─── Status helpers ───────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, string> = {
  available:   "success",
  assigned:    "in_progress",
  maintenance: "warning",
  repair:      "warning",
  retired:     "cancelled",
  lost:        "cancelled",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <SmartHRStatusBadge
      status={normalizeStatus(STATUS_STYLE[status] ?? status)}
      label={status.replace(/_/g, " ")}
    />
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const inputCls = "w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-slate-700 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function StatCard({ title, value, icon, tone }: { title: string; value: number; icon: React.ReactNode; tone: string }) {
  return (
    <div className="glass-card stat-card rounded-3xl p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-slate-500">{title}</p>
          <p className="mt-2 text-3xl font-black tracking-tight text-slate-950">{value}</p>
        </div>
        <div className={`rounded-2xl p-3 ${tone}`}>{icon}</div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function NativeAssetsManager() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [empSearch, setEmpSearch] = useState("");
  const [empResults, setEmpResults] = useState<EmployeeHit[]>([]);
  const [empSearching, setEmpSearching] = useState(false);

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");

  // Modals
  const [showAdd, setShowAdd]       = useState(false);
  const [addForm, setAddForm]       = useState<AddAssetForm>(EMPTY_ADD);
  const [addBusy, setAddBusy]       = useState(false);

  const [editTarget, setEditTarget] = useState<Asset | null>(null);
  const [editForm, setEditForm]     = useState<Partial<AddAssetForm>>({});
  const [editBusy, setEditBusy]     = useState(false);

  const [assignTarget, setAssignTarget] = useState<Asset | null>(null);
  const [assignForm, setAssignForm]     = useState<AssignForm>({ employee_id: "", notes: "" });
  const [assignBusy, setAssignBusy]     = useState(false);

  const [returnTarget, setReturnTarget] = useState<Asset | null>(null);
  const [returnForm, setReturnForm]     = useState<ReturnForm>({ condition: "good" });
  const [returnBusy, setReturnBusy]     = useState(false);

  const [historyTarget, setHistoryTarget] = useState<Asset | null>(null);
  const [history, setHistory]             = useState<HistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [serviceTarget, setServiceTarget] = useState<Asset | null>(null);
  const [serviceForm, setServiceForm]     = useState<ServiceForm>(EMPTY_SERVICE);
  const [serviceBusy, setServiceBusy]     = useState(false);

  // ── Load branches once ──────────────────────────────────────────────────────
  useEffect(() => {
    hrmsApi.get<{ data: Branch[] }>("/api/access/branches")
      .then((r) => setBranches(r.data ?? []))
      .catch(() => { /* branch dropdown degrades gracefully */ });
  }, []);

  // ── Load assets ─────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (categoryFilter !== "all") params.set("category", categoryFilter);
      const res = await hrmsApi.get<{ success: boolean; data: Asset[] }>(
        `/api/assets-mgmt?${params.toString()}`
      );
      setAssets(res.data ?? []);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to load assets");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, categoryFilter]);

  useEffect(() => { void load(); }, [load]);

  // ── Employee search ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!empSearch.trim()) { setEmpResults([]); return; }
    const t = setTimeout(async () => {
      setEmpSearching(true);
      try {
        const res = await hrmsApi.get<{ data: EmployeeHit[] }>(
          `/api/employees/hr-hub?search=${encodeURIComponent(empSearch)}&limit=20`
        );
        setEmpResults(res.data ?? []);
      } catch { setEmpResults([]); }
      finally { setEmpSearching(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [empSearch]);

  // ── Add ──────────────────────────────────────────────────────────────────────
  const submitAdd = async () => {
    if (!addForm.asset_code.trim() || !addForm.asset_name.trim()) {
      return setMessage("Asset code and name are required.");
    }
    setAddBusy(true);
    try {
      await hrmsApi.post("/api/assets-mgmt", {
        ...addForm,
        purchase_cost: addForm.purchase_cost ? parseFloat(addForm.purchase_cost) : undefined,
      });
      setShowAdd(false);
      setAddForm(EMPTY_ADD);
      setMessage("Asset created successfully.");
      await load();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to create asset.");
    } finally { setAddBusy(false); }
  };

  // ── Edit ─────────────────────────────────────────────────────────────────────
  const openEdit = (a: Asset) => {
    setEditTarget(a);
    setEditForm({
      asset_name: a.asset_name, asset_category: a.asset_category,
      asset_type: a.asset_type ?? "", serial_number: a.serial_number ?? "",
      vendor: a.vendor ?? "", purchase_date: a.purchase_date ?? "",
      purchase_cost: a.purchase_cost != null ? String(a.purchase_cost) : "",
      warranty_expiry: a.warranty_expiry ?? "", branch_id: a.branch_id ?? "",
      notes: a.notes ?? "",
    });
  };
  const submitEdit = async () => {
    if (!editTarget) return;
    setEditBusy(true);
    try {
      await hrmsApi.put(`/api/assets-mgmt/${editTarget.id}`, {
        ...editForm,
        purchase_cost: editForm.purchase_cost ? parseFloat(editForm.purchase_cost) : undefined,
      });
      setEditTarget(null);
      setMessage("Asset updated.");
      await load();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to update asset.");
    } finally { setEditBusy(false); }
  };

  // ── Assign ───────────────────────────────────────────────────────────────────
  const submitAssign = async () => {
    if (!assignTarget || !assignForm.employee_id.trim()) {
      return setMessage("Please select an employee.");
    }
    setAssignBusy(true);
    try {
      await hrmsApi.post(`/api/assets-mgmt/${assignTarget.id}/assign`, assignForm);
      setAssignTarget(null);
      setAssignForm({ employee_id: "", notes: "" });
      setEmpSearch(""); setEmpResults([]);
      setMessage("Asset assigned.");
      await load();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to assign asset.");
    } finally { setAssignBusy(false); }
  };

  // ── Return ───────────────────────────────────────────────────────────────────
  const submitReturn = async () => {
    if (!returnTarget) return;
    setReturnBusy(true);
    try {
      await hrmsApi.post(`/api/assets-mgmt/${returnTarget.id}/return`, returnForm);
      setReturnTarget(null);
      setReturnForm({ condition: "good" });
      setMessage("Asset returned.");
      await load();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to return asset.");
    } finally { setReturnBusy(false); }
  };

  // ── History ──────────────────────────────────────────────────────────────────
  const openHistory = async (a: Asset) => {
    setHistoryTarget(a);
    setHistoryLoading(true);
    try {
      const res = await hrmsApi.get<{ data: HistoryRow[] }>(`/api/assets-mgmt/${a.id}/history`);
      setHistory(res.data ?? []);
    } catch { setHistory([]); }
    finally { setHistoryLoading(false); }
  };

  // ── Service ──────────────────────────────────────────────────────────────────
  const submitService = async () => {
    if (!serviceTarget || !serviceForm.service_date) {
      return setMessage("Service date is required.");
    }
    setServiceBusy(true);
    try {
      await hrmsApi.post(`/api/assets-mgmt/${serviceTarget.id}/service`, {
        ...serviceForm,
        cost: serviceForm.cost ? parseFloat(serviceForm.cost) : undefined,
      });
      setServiceTarget(null);
      setServiceForm(EMPTY_SERVICE);
      setMessage("Service log added.");
      await load();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to add service log.");
    } finally { setServiceBusy(false); }
  };

  // ── Derived stats ─────────────────────────────────────────────────────────────
  const stats = {
    total:      assets.length,
    available:  assets.filter((a) => a.status === "available").length,
    assigned:   assets.filter((a) => a.status === "assigned").length,
    in_service: assets.filter((a) => a.status === "maintenance" || a.status === "repair").length,
    retired:    assets.filter((a) => a.status === "retired" || a.status === "lost").length,
  };

  const categories = ["all", ...Array.from(new Set(assets.map((a) => a.asset_category).filter(Boolean)))];
  const STATUSES   = ["all", "available", "assigned", "maintenance", "repair", "retired", "lost"];

  const filtered = assets.filter((a) => {
    const q = search.trim().toLowerCase();
    const text = [a.asset_code, a.asset_name, a.asset_category, a.serial_number, a.assigned_employee_name, a.assigned_employee_code].join(" ").toLowerCase();
    return !q || text.includes(q);
  });

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <DashboardLayout>
      <div className="space-y-6">

        {/* Header */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">Asset Management</p>
            <h1 className="mt-2 text-3xl font-black text-slate-950">Assets Manager</h1>
            <p className="mt-2 max-w-4xl text-slate-600">
              Track, assign, and manage company assets across branches and employees.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </button>
            <button
              onClick={() => setShowAdd(true)}
              className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              Add Asset
            </button>
          </div>
        </div>

        {/* Message */}
        {message && (
          <div className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            {message}
          </div>
        )}

        {/* Stats */}
        <div className="grid gap-4 md:grid-cols-5">
          <StatCard title="Total Assets"    value={stats.total}      icon={<Box className="h-5 w-5" />}          tone="bg-slate-100 text-slate-700" />
          <StatCard title="Available"       value={stats.available}  icon={<CheckCircle2 className="h-5 w-5" />} tone="bg-emerald-50 text-emerald-700" />
          <StatCard title="Assigned"        value={stats.assigned}   icon={<Tag className="h-5 w-5" />}          tone="bg-amber-50 text-amber-700" />
          <StatCard title="In Service"      value={stats.in_service} icon={<Wrench className="h-5 w-5" />}       tone="bg-orange-50 text-orange-700" />
          <StatCard title="Retired / Lost"  value={stats.retired}    icon={<AlertCircle className="h-5 w-5" />}  tone="bg-red-50 text-red-600" />
        </div>

        {/* Filters */}
        <div className="rounded-3xl border bg-white p-4 shadow-sm space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search code, name, serial, employee…"
              className="h-11 w-full rounded-2xl border bg-slate-50 pl-10 pr-4 text-sm outline-none focus:border-blue-400 transition-colors"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="text-xs font-black uppercase text-slate-400 self-center mr-1">Status:</span>
            {STATUSES.map((s) => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`rounded-xl px-3 py-1.5 text-xs font-semibold capitalize cursor-pointer transition-colors ${statusFilter === s ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
              >
                {s.replace(/_/g, " ")}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="text-xs font-black uppercase text-slate-400 self-center mr-1">Category:</span>
            {categories.map((c) => (
              <button key={c} onClick={() => setCategoryFilter(c)}
                className={`rounded-xl px-3 py-1.5 text-xs font-semibold capitalize cursor-pointer transition-colors ${categoryFilter === c ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
          <div className="border-b p-5">
            <h2 className="font-black text-slate-950">Asset Inventory</h2>
            <p className="text-sm text-slate-500">{filtered.length} records</p>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader className="h-8 w-8 animate-spin text-slate-400" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-slate-400">
              <Box className="mx-auto mb-3 h-10 w-10 opacity-30" />
              <p className="font-semibold">No assets found.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    {["Asset Code", "Name", "Category", "Serial", "Branch", "Status", "Assigned To", "Actions"].map((h) => (
                      <th key={h} className="p-4 font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((a) => (
                    <tr key={a.id} className="border-t hover:bg-slate-50/80 transition-colors">
                      <td className="p-4 font-mono font-bold text-slate-950">{a.asset_code}</td>
                      <td className="p-4">
                        <div className="font-semibold text-slate-900">{a.asset_name}</div>
                        {a.asset_type && <div className="text-xs text-slate-400">{a.asset_type}</div>}
                      </td>
                      <td className="p-4 text-slate-600">{a.asset_category}</td>
                      <td className="p-4 font-mono text-xs text-slate-500">{a.serial_number ?? "–"}</td>
                      <td className="p-4 text-slate-500">{a.branch_name ?? "–"}</td>
                      <td className="p-4"><StatusBadge status={a.status} /></td>
                      <td className="p-4 text-slate-600">
                        {a.assigned_employee_name?.trim() ? (
                          <div>
                            <div className="font-semibold">{a.assigned_employee_name.trim()}</div>
                            {a.assigned_employee_code && <div className="text-xs text-slate-400">{a.assigned_employee_code}</div>}
                          </div>
                        ) : "–"}
                      </td>
                      <td className="p-4">
                        <div className="flex flex-wrap gap-1">
                          <button
                            onClick={() => { openEdit(a); setMessage(""); }}
                            className="cursor-pointer rounded-lg bg-blue-100 px-2.5 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-200 transition-colors inline-flex items-center gap-1"
                          >
                            <Pencil className="h-3 w-3" /> Edit
                          </button>
                          <button
                            onClick={() => { void openHistory(a); setMessage(""); }}
                            className="cursor-pointer rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-200 transition-colors inline-flex items-center gap-1"
                          >
                            <History className="h-3 w-3" /> History
                          </button>
                          {a.status === "available" && (
                            <button
                              onClick={() => { setAssignTarget(a); setEmpSearch(""); setEmpResults([]); setAssignForm({ employee_id: "", notes: "" }); setMessage(""); }}
                              className="cursor-pointer rounded-lg bg-amber-500 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-amber-600 transition-colors"
                            >
                              Assign
                            </button>
                          )}
                          {a.status === "assigned" && (
                            <button
                              onClick={() => { setReturnTarget(a); setMessage(""); }}
                              className="cursor-pointer rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-slate-900 transition-colors"
                            >
                              Return
                            </button>
                          )}
                          {(a.status === "maintenance" || a.status === "repair" || a.status === "available") && (
                            <button
                              onClick={() => { setServiceTarget(a); setServiceForm(EMPTY_SERVICE); setMessage(""); }}
                              className="cursor-pointer rounded-lg bg-orange-100 px-2.5 py-1.5 text-xs font-bold text-orange-700 hover:bg-orange-200 transition-colors inline-flex items-center gap-1"
                            >
                              <Settings className="h-3 w-3" /> Service
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Add Asset Modal ───────────────────────────────────────────────────── */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl rounded-3xl bg-white shadow-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b p-6">
              <h2 className="text-lg font-black text-slate-950">Add New Asset</h2>
              <button onClick={() => setShowAdd(false)} className="cursor-pointer text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
            </div>
            <div className="overflow-y-auto p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Asset Code *">
                  <input value={addForm.asset_code} onChange={(e) => setAddForm({ ...addForm, asset_code: e.target.value })} placeholder="e.g. LT-001" className={inputCls} />
                </Field>
                <Field label="Asset Name *">
                  <input value={addForm.asset_name} onChange={(e) => setAddForm({ ...addForm, asset_name: e.target.value })} placeholder="e.g. Dell Laptop" className={inputCls} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Category">
                  <select value={addForm.asset_category} onChange={(e) => setAddForm({ ...addForm, asset_category: e.target.value })} className={inputCls}>
                    <option value="">Select…</option>
                    {["Electronics", "Furniture", "Vehicle", "IT Equipment", "Office Supply", "Other"].map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
                <Field label="Asset Type">
                  <input value={addForm.asset_type} onChange={(e) => setAddForm({ ...addForm, asset_type: e.target.value })} placeholder="e.g. Laptop" className={inputCls} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Serial Number">
                  <input value={addForm.serial_number} onChange={(e) => setAddForm({ ...addForm, serial_number: e.target.value })} placeholder="Serial / IMEI" className={inputCls} />
                </Field>
                <Field label="Vendor">
                  <input value={addForm.vendor} onChange={(e) => setAddForm({ ...addForm, vendor: e.target.value })} placeholder="Vendor name" className={inputCls} />
                </Field>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Purchase Date">
                  <input type="date" value={addForm.purchase_date} onChange={(e) => setAddForm({ ...addForm, purchase_date: e.target.value })} className={inputCls} />
                </Field>
                <Field label="Purchase Cost">
                  <input type="number" value={addForm.purchase_cost} onChange={(e) => setAddForm({ ...addForm, purchase_cost: e.target.value })} placeholder="0.00" className={inputCls} />
                </Field>
                <Field label="Warranty Expiry">
                  <input type="date" value={addForm.warranty_expiry} onChange={(e) => setAddForm({ ...addForm, warranty_expiry: e.target.value })} className={inputCls} />
                </Field>
              </div>
              <Field label="Branch">
                {branches.length > 0 ? (
                  <select value={addForm.branch_id} onChange={(e) => setAddForm({ ...addForm, branch_id: e.target.value })} className={inputCls}>
                    <option value="">Select branch…</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.branch_name} ({b.branch_code})</option>)}
                  </select>
                ) : (
                  <input value={addForm.branch_id} onChange={(e) => setAddForm({ ...addForm, branch_id: e.target.value })} placeholder="Branch ID" className={inputCls} />
                )}
              </Field>
              <Field label="Notes">
                <textarea value={addForm.notes} onChange={(e) => setAddForm({ ...addForm, notes: e.target.value })} rows={2} placeholder="Additional notes…" className={`${inputCls} resize-none`} />
              </Field>
            </div>
            <div className="flex gap-3 border-t p-6">
              <button onClick={() => setShowAdd(false)} className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button onClick={() => void submitAdd()} disabled={addBusy} className="flex-1 cursor-pointer rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50">{addBusy ? "Saving…" : "Create Asset"}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Asset Modal ──────────────────────────────────────────────────── */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl rounded-3xl bg-white shadow-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b p-6">
              <div>
                <h2 className="text-lg font-black text-slate-950">Edit Asset</h2>
                <p className="text-xs font-mono text-slate-400">{editTarget.asset_code}</p>
              </div>
              <button onClick={() => setEditTarget(null)} className="cursor-pointer text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
            </div>
            <div className="overflow-y-auto p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Asset Name">
                  <input value={editForm.asset_name ?? ""} onChange={(e) => setEditForm({ ...editForm, asset_name: e.target.value })} className={inputCls} />
                </Field>
                <Field label="Category">
                  <select value={editForm.asset_category ?? ""} onChange={(e) => setEditForm({ ...editForm, asset_category: e.target.value })} className={inputCls}>
                    <option value="">Select…</option>
                    {["Electronics", "Furniture", "Vehicle", "IT Equipment", "Office Supply", "Other"].map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Serial Number">
                  <input value={editForm.serial_number ?? ""} onChange={(e) => setEditForm({ ...editForm, serial_number: e.target.value })} className={inputCls} />
                </Field>
                <Field label="Vendor">
                  <input value={editForm.vendor ?? ""} onChange={(e) => setEditForm({ ...editForm, vendor: e.target.value })} className={inputCls} />
                </Field>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Purchase Date">
                  <input type="date" value={editForm.purchase_date ?? ""} onChange={(e) => setEditForm({ ...editForm, purchase_date: e.target.value })} className={inputCls} />
                </Field>
                <Field label="Purchase Cost">
                  <input type="number" value={editForm.purchase_cost ?? ""} onChange={(e) => setEditForm({ ...editForm, purchase_cost: e.target.value })} className={inputCls} />
                </Field>
                <Field label="Warranty Expiry">
                  <input type="date" value={editForm.warranty_expiry ?? ""} onChange={(e) => setEditForm({ ...editForm, warranty_expiry: e.target.value })} className={inputCls} />
                </Field>
              </div>
              <Field label="Branch">
                {branches.length > 0 ? (
                  <select value={editForm.branch_id ?? ""} onChange={(e) => setEditForm({ ...editForm, branch_id: e.target.value })} className={inputCls}>
                    <option value="">Select branch…</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.branch_name} ({b.branch_code})</option>)}
                  </select>
                ) : (
                  <input value={editForm.branch_id ?? ""} onChange={(e) => setEditForm({ ...editForm, branch_id: e.target.value })} placeholder="Branch ID" className={inputCls} />
                )}
              </Field>
              <Field label="Notes">
                <textarea value={editForm.notes ?? ""} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} rows={2} className={`${inputCls} resize-none`} />
              </Field>
            </div>
            <div className="flex gap-3 border-t p-6">
              <button onClick={() => setEditTarget(null)} className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button onClick={() => void submitEdit()} disabled={editBusy} className="flex-1 cursor-pointer rounded-2xl bg-blue-600 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50">{editBusy ? "Saving…" : "Save Changes"}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Assign Modal ──────────────────────────────────────────────────────── */}
      {assignTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b p-6">
              <h2 className="text-lg font-black text-slate-950">Assign Asset</h2>
              <button onClick={() => setAssignTarget(null)} className="cursor-pointer text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="rounded-2xl bg-slate-50 p-4 text-sm">
                <p className="font-bold text-slate-800">{assignTarget.asset_name}</p>
                <p className="font-mono text-slate-500 text-xs">{assignTarget.asset_code}</p>
              </div>
              <Field label="Search Employee *">
                <div className="relative">
                  <input
                    value={empSearch}
                    onChange={(e) => setEmpSearch(e.target.value)}
                    placeholder="Type name or employee code…"
                    className={inputCls}
                  />
                  {empSearching && <Loader className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-slate-400" />}
                </div>
                {empResults.length > 0 && (
                  <div className="mt-1 rounded-2xl border bg-white shadow-lg max-h-40 overflow-y-auto">
                    {empResults.map((emp) => (
                      <button
                        key={emp.id}
                        onClick={() => {
                          setAssignForm({ ...assignForm, employee_id: emp.id });
                          setEmpSearch(`${emp.first_name} ${emp.last_name ?? ""} (${emp.employee_code})`);
                          setEmpResults([]);
                        }}
                        className="w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 transition-colors cursor-pointer border-b last:border-0"
                      >
                        <span className="font-semibold">{emp.first_name} {emp.last_name}</span>
                        <span className="text-slate-400 ml-2 text-xs">{emp.employee_code}</span>
                      </button>
                    ))}
                  </div>
                )}
                {assignForm.employee_id && (
                  <p className="text-xs text-emerald-600 mt-1 font-semibold">Employee selected</p>
                )}
              </Field>
              <Field label="Notes">
                <textarea value={assignForm.notes} onChange={(e) => setAssignForm({ ...assignForm, notes: e.target.value })} rows={2} placeholder="Assignment notes…" className={`${inputCls} resize-none`} />
              </Field>
            </div>
            <div className="flex gap-3 border-t p-6">
              <button onClick={() => setAssignTarget(null)} className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button onClick={() => void submitAssign()} disabled={assignBusy || !assignForm.employee_id} className="flex-1 cursor-pointer rounded-2xl bg-amber-500 py-3 text-sm font-bold text-white hover:bg-amber-600 disabled:opacity-50">{assignBusy ? "Assigning…" : "Assign Asset"}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Return Modal ──────────────────────────────────────────────────────── */}
      {returnTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b p-6">
              <h2 className="text-lg font-black text-slate-950">Return Asset</h2>
              <button onClick={() => setReturnTarget(null)} className="cursor-pointer text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="rounded-2xl bg-slate-50 p-4 text-sm">
                <p className="font-bold text-slate-800">{returnTarget.asset_name}</p>
                <p className="font-mono text-slate-500 text-xs">{returnTarget.asset_code}</p>
                {returnTarget.assigned_employee_name && (
                  <p className="text-slate-500 text-xs mt-1">Assigned to: {returnTarget.assigned_employee_name}</p>
                )}
              </div>
              <Field label="Condition on Return">
                <select value={returnForm.condition} onChange={(e) => setReturnForm({ condition: e.target.value })} className={inputCls}>
                  <option value="good">Good — returned to available</option>
                  <option value="fair">Fair — returned to available</option>
                  <option value="damaged">Damaged — sent to repair</option>
                  <option value="lost">Lost — marked lost</option>
                </select>
              </Field>
              {(returnForm.condition === "damaged" || returnForm.condition === "lost") && (
                <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-700 font-semibold">
                  {returnForm.condition === "damaged"
                    ? "Asset status will be set to Repair."
                    : "Asset status will be set to Lost."}
                </div>
              )}
            </div>
            <div className="flex gap-3 border-t p-6">
              <button onClick={() => setReturnTarget(null)} className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button onClick={() => void submitReturn()} disabled={returnBusy} className="flex-1 cursor-pointer rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50">{returnBusy ? "Processing…" : "Confirm Return"}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── History Modal ─────────────────────────────────────────────────────── */}
      {historyTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl rounded-3xl bg-white shadow-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b p-6">
              <div>
                <h2 className="text-lg font-black text-slate-950">Assignment History</h2>
                <p className="text-xs font-mono text-slate-400">{historyTarget.asset_name} · {historyTarget.asset_code}</p>
              </div>
              <button onClick={() => setHistoryTarget(null)} className="cursor-pointer text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
            </div>
            <div className="overflow-y-auto p-6">
              {historyLoading ? (
                <div className="flex justify-center py-10"><Loader className="h-8 w-8 animate-spin text-slate-400" /></div>
              ) : history.length === 0 ? (
                <p className="text-center text-slate-400 py-10">No assignment history.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase text-slate-400 border-b">
                    <tr>
                      {["Employee", "Assigned", "Returned", "Condition", "Notes"].map((h) => (
                        <th key={h} className="pb-3 text-left font-semibold">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((row) => (
                      <tr key={row.id} className="border-b last:border-0">
                        <td className="py-3 pr-4">
                          <div className="font-semibold text-slate-800">{row.employee_name}</div>
                          <div className="text-xs text-slate-400">{row.employee_code}</div>
                        </td>
                        <td className="py-3 pr-4 text-slate-600 text-xs">{row.assigned_date}</td>
                        <td className="py-3 pr-4 text-slate-500 text-xs">{row.returned_date ?? <span className="text-amber-600 font-semibold">Active</span>}</td>
                        <td className="py-3 pr-4 text-slate-500 text-xs capitalize">{row.return_condition ?? "–"}</td>
                        <td className="py-3 text-slate-500 text-xs">{row.notes ?? "–"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="border-t p-6">
              <button onClick={() => setHistoryTarget(null)} className="w-full cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Service Log Modal ─────────────────────────────────────────────────── */}
      {serviceTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b p-6">
              <div>
                <h2 className="text-lg font-black text-slate-950">Add Service Log</h2>
                <p className="text-xs font-mono text-slate-400">{serviceTarget.asset_name} · {serviceTarget.asset_code}</p>
              </div>
              <button onClick={() => setServiceTarget(null)} className="cursor-pointer text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Service Type">
                  <select value={serviceForm.service_type} onChange={(e) => setServiceForm({ ...serviceForm, service_type: e.target.value })} className={inputCls}>
                    <option value="maintenance">Maintenance</option>
                    <option value="repair">Repair</option>
                    <option value="inspection">Inspection</option>
                  </select>
                </Field>
                <Field label="Service Date *">
                  <input type="date" value={serviceForm.service_date} onChange={(e) => setServiceForm({ ...serviceForm, service_date: e.target.value })} className={inputCls} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Cost">
                  <input type="number" value={serviceForm.cost} onChange={(e) => setServiceForm({ ...serviceForm, cost: e.target.value })} placeholder="0.00" className={inputCls} />
                </Field>
                <Field label="Performed By">
                  <input value={serviceForm.performed_by} onChange={(e) => setServiceForm({ ...serviceForm, performed_by: e.target.value })} placeholder="Vendor / technician" className={inputCls} />
                </Field>
              </div>
              <Field label="Notes">
                <textarea value={serviceForm.service_notes} onChange={(e) => setServiceForm({ ...serviceForm, service_notes: e.target.value })} rows={2} placeholder="Service details…" className={`${inputCls} resize-none`} />
              </Field>
            </div>
            <div className="flex gap-3 border-t p-6">
              <button onClick={() => setServiceTarget(null)} className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button onClick={() => void submitService()} disabled={serviceBusy} className="flex-1 cursor-pointer rounded-2xl bg-orange-500 py-3 text-sm font-bold text-white hover:bg-orange-600 disabled:opacity-50">{serviceBusy ? "Saving…" : "Save Log"}</button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
