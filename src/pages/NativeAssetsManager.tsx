import { useEffect, useState } from "react";
import {
  AlertTriangle, Box, CheckCircle2, Loader, Plus,
  RefreshCcw, Search, Tag, Wrench, X,
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
  status: "available" | "assigned" | "in_service" | "retired";
  assigned_to?: string;
  assigned_employee_name?: string;
  notes?: string;
  created_at: string;
};

type AddAssetForm = {
  asset_code: string;
  asset_name: string;
  asset_category: string;
  asset_type: string;
  serial_number: string;
  purchase_date: string;
  purchase_cost: string;
  vendor: string;
  warranty_expiry: string;
  branch_id: string;
  notes: string;
};

type AssignForm = { employee_id: string; notes: string };
type ReturnForm = { condition: string };

const EMPTY_ADD: AddAssetForm = {
  asset_code: "", asset_name: "", asset_category: "", asset_type: "",
  serial_number: "", purchase_date: "", purchase_cost: "", vendor: "",
  warranty_expiry: "", branch_id: "", notes: "",
};

// ─── Status helpers ───────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  available:  "bg-emerald-50 text-emerald-700",
  assigned:   "bg-amber-50 text-amber-700",
  in_service: "bg-orange-50 text-orange-700",
  retired:    "bg-slate-100 text-slate-500",
};

function StatusBadge({ status }: { status: string }) {
  const statusMap: Record<string, string> = {
    available: "success",
    assigned: "in_progress",
    under_maintenance: "warning",
    retired: "cancelled",
  };

  return (
    <SmartHRStatusBadge
      status={normalizeStatus(statusMap[status] || status)}
      label={status.replace(/_/g, " ")}
    />
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ title, value, icon, tone }: {
  title: string; value: number; icon: React.ReactNode; tone: string;
}) {
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

// ─── Field ────────────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-slate-700 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

const inputCls = "w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors";

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function NativeAssetsManager() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");

  // Modals
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState<AddAssetForm>(EMPTY_ADD);
  const [addBusy, setAddBusy] = useState(false);

  const [assignTarget, setAssignTarget] = useState<Asset | null>(null);
  const [assignForm, setAssignForm] = useState<AssignForm>({ employee_id: "", notes: "" });
  const [assignBusy, setAssignBusy] = useState(false);

  const [returnTarget, setReturnTarget] = useState<Asset | null>(null);
  const [returnForm, setReturnForm] = useState<ReturnForm>({ condition: "good" });
  const [returnBusy, setReturnBusy] = useState(false);

  // ── Load ────────────────────────────────────────────────────────────────────

  const load = async () => {
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
  };

  useEffect(() => { void load(); }, [statusFilter, categoryFilter]);

  // ── Add ─────────────────────────────────────────────────────────────────────

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
    } finally {
      setAddBusy(false);
    }
  };

  // ── Assign ──────────────────────────────────────────────────────────────────

  const submitAssign = async () => {
    if (!assignTarget || !assignForm.employee_id.trim()) {
      return setMessage("Employee ID is required.");
    }
    setAssignBusy(true);
    try {
      await hrmsApi.post(`/api/assets-mgmt/${assignTarget.id}/assign`, assignForm);
      setAssignTarget(null);
      setAssignForm({ employee_id: "", notes: "" });
      setMessage("Asset assigned.");
      await load();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to assign asset.");
    } finally {
      setAssignBusy(false);
    }
  };

  // ── Return ──────────────────────────────────────────────────────────────────

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
    } finally {
      setReturnBusy(false);
    }
  };

  // ── Derived stats ───────────────────────────────────────────────────────────

  const stats = {
    total:      assets.length,
    available:  assets.filter((a) => a.status === "available").length,
    assigned:   assets.filter((a) => a.status === "assigned").length,
    in_service: assets.filter((a) => a.status === "in_service").length,
  };

  const categories = ["all", ...Array.from(new Set(assets.map((a) => a.asset_category).filter(Boolean)))];
  const STATUSES   = ["all", "available", "assigned", "in_service", "retired"];

  const filtered = assets.filter((a) => {
    const q = search.trim().toLowerCase();
    const text = [a.asset_code, a.asset_name, a.asset_category, a.serial_number, a.assigned_employee_name].join(" ").toLowerCase();
    return !q || text.includes(q);
  });

  // ── Render ──────────────────────────────────────────────────────────────────

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
        <div className="grid gap-4 md:grid-cols-4">
          <StatCard title="Total Assets"     value={stats.total}      icon={<Box className="h-5 w-5" />}          tone="bg-slate-100 text-slate-700" />
          <StatCard title="Available"        value={stats.available}  icon={<CheckCircle2 className="h-5 w-5" />} tone="bg-emerald-50 text-emerald-700" />
          <StatCard title="Assigned"         value={stats.assigned}   icon={<Tag className="h-5 w-5" />}          tone="bg-amber-50 text-amber-700" />
          <StatCard title="In Service"       value={stats.in_service} icon={<Wrench className="h-5 w-5" />}       tone="bg-orange-50 text-orange-700" />
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
              <table className="w-full min-w-[900px] text-sm">
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
                      <td className="p-4 text-slate-500">{a.branch_name ?? a.branch_id ?? "–"}</td>
                      <td className="p-4"><StatusBadge status={a.status} /></td>
                      <td className="p-4 text-slate-600">{a.assigned_employee_name ?? "–"}</td>
                      <td className="p-4">
                        <div className="flex flex-wrap gap-1">
                          {a.status === "available" && (
                            <button
                              onClick={() => { setAssignTarget(a); setMessage(""); }}
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
              <button onClick={() => setShowAdd(false)} className="cursor-pointer text-slate-400 hover:text-slate-700 transition-colors">
                <X className="h-5 w-5" />
              </button>
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
                    {["Electronics", "Furniture", "Vehicle", "IT Equipment", "Office Supply", "Other"].map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
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
              <Field label="Branch ID">
                <input value={addForm.branch_id} onChange={(e) => setAddForm({ ...addForm, branch_id: e.target.value })} placeholder="Branch UUID" className={inputCls} />
              </Field>
              <Field label="Notes">
                <textarea value={addForm.notes} onChange={(e) => setAddForm({ ...addForm, notes: e.target.value })} rows={2} placeholder="Additional notes…" className={`${inputCls} resize-none`} />
              </Field>
            </div>
            <div className="flex gap-3 border-t p-6">
              <button onClick={() => setShowAdd(false)} className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
                Cancel
              </button>
              <button onClick={() => void submitAdd()} disabled={addBusy} className="flex-1 cursor-pointer rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800 transition-colors disabled:opacity-50">
                {addBusy ? "Saving…" : "Create Asset"}
              </button>
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
              <button onClick={() => setAssignTarget(null)} className="cursor-pointer text-slate-400 hover:text-slate-700 transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="rounded-2xl bg-slate-50 p-4 text-sm">
                <p className="font-bold text-slate-800">{assignTarget.asset_name}</p>
                <p className="font-mono text-slate-500 text-xs">{assignTarget.asset_code}</p>
              </div>
              <Field label="Employee ID *">
                <input value={assignForm.employee_id} onChange={(e) => setAssignForm({ ...assignForm, employee_id: e.target.value })} placeholder="Employee UUID" className={inputCls} />
              </Field>
              <Field label="Notes">
                <textarea value={assignForm.notes} onChange={(e) => setAssignForm({ ...assignForm, notes: e.target.value })} rows={2} placeholder="Assignment notes…" className={`${inputCls} resize-none`} />
              </Field>
            </div>
            <div className="flex gap-3 border-t p-6">
              <button onClick={() => setAssignTarget(null)} className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
                Cancel
              </button>
              <button onClick={() => void submitAssign()} disabled={assignBusy} className="flex-1 cursor-pointer rounded-2xl bg-amber-500 py-3 text-sm font-bold text-white hover:bg-amber-600 transition-colors disabled:opacity-50">
                {assignBusy ? "Assigning…" : "Assign Asset"}
              </button>
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
              <button onClick={() => setReturnTarget(null)} className="cursor-pointer text-slate-400 hover:text-slate-700 transition-colors">
                <X className="h-5 w-5" />
              </button>
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
                  <option value="good">Good</option>
                  <option value="fair">Fair</option>
                  <option value="damaged">Damaged</option>
                  <option value="lost">Lost</option>
                </select>
              </Field>
            </div>
            <div className="flex gap-3 border-t p-6">
              <button onClick={() => setReturnTarget(null)} className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
                Cancel
              </button>
              <button onClick={() => void submitReturn()} disabled={returnBusy} className="flex-1 cursor-pointer rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800 transition-colors disabled:opacity-50">
                {returnBusy ? "Processing…" : "Confirm Return"}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
