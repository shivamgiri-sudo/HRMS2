import { useEffect, useState } from "react";
import {
  AlertTriangle, CheckCircle2, ChevronDown, Copy,
  Download, Loader, Plus, RefreshCcw, Search, Shield, X,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

// ─── Types ────────────────────────────────────────────────────────────────────

type UanRecord = {
  id: string;
  employee_id: string;
  uan: string;
  member_id: string | null;
  epf_join_date: string | null;
  eps_eligible: number;
  is_active: number;
};

type EmployeeUanRow = {
  employee_id: string;
  employee_code: string;
  first_name: string;
  last_name: string | null;
  uan: string | null;
};

type PtSlab = {
  id: string;
  state_code: string;
  state_name: string;
  income_from: number;
  income_to: number | null;
  pt_amount: number;
  frequency: string;
  effective_from: string;
};

type PayrollRun = {
  id: string;
  run_month: string;
  status: string;
};

type EcrLine = {
  uan: string | null;
  member_id: string | null;
  member_name: string;
  wages: number;
  epf_contribution: number;
  eps_contribution: number;
};

type EcrResponse = {
  success: boolean;
  run_id: string;
  data: EcrLine[];
};

type EsicLine = {
  employee_code: string;
  employee_name: string;
  wages: number;
  employee_contribution: number;
  employer_contribution: number;
};

type EsicResponse = {
  success: boolean;
  run_id: string;
  period: string;
  employee_count: number;
  total_wages: number;
  employee_total: number;
  employer_total: number;
  data: EsicLine[];
};

type MinWage = {
  id: string;
  state_code: string;
  category: string;
  daily_rate: number;
  monthly_rate: number;
  effective_from: string;
};

// ─── Constants ───────────────────────────────────────────────────────────────

const PT_STATES = [
  { code: "AP", name: "Andhra Pradesh" },
  { code: "AS", name: "Assam" },
  { code: "BR", name: "Bihar" },
  { code: "CG", name: "Chhattisgarh" },
  { code: "DL", name: "Delhi" },
  { code: "GA", name: "Goa" },
  { code: "GJ", name: "Gujarat" },
  { code: "JH", name: "Jharkhand" },
  { code: "KA", name: "Karnataka" },
  { code: "KL", name: "Kerala" },
  { code: "MH", name: "Maharashtra" },
  { code: "MP", name: "Madhya Pradesh" },
  { code: "MN", name: "Manipur" },
  { code: "ML", name: "Meghalaya" },
  { code: "MZ", name: "Mizoram" },
  { code: "OR", name: "Odisha" },
  { code: "PB", name: "Punjab" },
  { code: "RJ", name: "Rajasthan" },
  { code: "SK", name: "Sikkim" },
  { code: "TN", name: "Tamil Nadu" },
  { code: "TS", name: "Telangana" },
  { code: "TR", name: "Tripura" },
  { code: "UP", name: "Uttar Pradesh" },
  { code: "WB", name: "West Bengal" },
];

const TABS = ["PF / UAN", "PT Slabs", "ECR / ESIC", "Min Wages"] as const;
type Tab = typeof TABS[number];

// ─── Shared helpers ──────────────────────────────────────────────────────────

function fmt(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n);
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN");
}

function copyText(text: string) {
  navigator.clipboard.writeText(text).catch(() => {});
}

// ─── UAN Tab ─────────────────────────────────────────────────────────────────

function UanTab() {
  const [employees, setEmployees] = useState<EmployeeUanRow[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [selectedEmpId, setSelectedEmpId] = useState("");
  const [uanRecord, setUanRecord] = useState<UanRecord | null>(null);
  const [form, setForm] = useState({ uan: "", member_id: "", epf_join_date: "" });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setMessage("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: EmployeeUanRow[] }>(
        "/api/employees?limit=200&fields=id,employee_code,first_name,last_name"
      );
      setEmployees(res.data ?? []);
    } catch (err: any) {
      setMessage(err?.message || "Failed to load employees");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const openModal = async (empId: string) => {
    setSelectedEmpId(empId);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: UanRecord | null }>(
        `/api/payroll/uan/${empId}`
      );
      const rec = res.data;
      setUanRecord(rec);
      setForm({
        uan: rec?.uan ?? "",
        member_id: rec?.member_id ?? "",
        epf_join_date: rec?.epf_join_date ?? "",
      });
    } catch {
      setUanRecord(null);
      setForm({ uan: "", member_id: "", epf_join_date: "" });
    }
    setShowModal(true);
  };

  const saveUan = async () => {
    if (!form.uan.trim()) return setMessage("UAN is required");
    setSaving(true);
    setMessage("");
    try {
      await hrmsApi.post(`/api/payroll/uan/${selectedEmpId}`, {
        uan: form.uan.trim(),
        member_id: form.member_id || null,
        epf_join_date: form.epf_join_date || null,
      });
      setMessage("UAN updated successfully.");
      setShowModal(false);
      await load();
    } catch (err: any) {
      setMessage(err?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const filtered = employees.filter((e) => {
    const q = search.toLowerCase();
    return (
      e.employee_code?.toLowerCase().includes(q) ||
      e.first_name?.toLowerCase().includes(q) ||
      (e.last_name ?? "").toLowerCase().includes(q) ||
      (e.uan ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-4">
      {message && (
        <div className="rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-700">{message}</div>
      )}

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            className="w-full rounded-xl border border-slate-200 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Search employees…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button
          onClick={load}
          className="rounded-xl border border-slate-200 p-2 hover:bg-slate-50"
        >
          <RefreshCcw className="h-4 w-4 text-slate-500" />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500">
          <Loader className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                {["Code", "Name", "UAN", "Member ID", "EPF Join", "Action"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((emp) => (
                <tr key={emp.employee_id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">{emp.employee_code}</td>
                  <td className="px-4 py-3 font-medium text-slate-800">
                    {emp.first_name} {emp.last_name ?? ""}
                  </td>
                  <td className="px-4 py-3">
                    {emp.uan ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                        <CheckCircle2 className="h-3 w-3" /> {emp.uan}
                      </span>
                    ) : (
                      <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-600">
                        Not linked
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{emp.uan ? "—" : "—"}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">—</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => openModal(emp.employee_id)}
                      className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                    >
                      {emp.uan ? "Update" : "Link UAN"}
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400 text-sm">
                    No employees found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* UAN Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-800">
                {uanRecord ? "Update UAN" : "Link UAN"}
              </h3>
              <button onClick={() => setShowModal(false)}>
                <X className="h-5 w-5 text-slate-400 hover:text-slate-600" />
              </button>
            </div>

            {uanRecord && (
              <div className="mb-4 rounded-xl bg-slate-50 p-3 text-xs text-slate-600 space-y-1">
                <div><span className="font-semibold">Current UAN:</span> {uanRecord.uan}</div>
                <div><span className="font-semibold">EPF Join:</span> {fmtDate(uanRecord.epf_join_date)}</div>
                <div><span className="font-semibold">EPS Eligible:</span> {uanRecord.eps_eligible ? "Yes" : "No"}</div>
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">UAN *</label>
                <input
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="12-digit UAN"
                  value={form.uan}
                  onChange={(e) => setForm((f) => ({ ...f, uan: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Member ID</label>
                <input
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Employer PF member ID"
                  value={form.member_id}
                  onChange={(e) => setForm((f) => ({ ...f, member_id: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">EPF Join Date</label>
                <input
                  type="date"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={form.epf_join_date}
                  onChange={(e) => setForm((f) => ({ ...f, epf_join_date: e.target.value }))}
                />
              </div>
            </div>

            <div className="mt-5 flex gap-3 justify-end">
              <button
                onClick={() => setShowModal(false)}
                className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                onClick={saveUan}
                disabled={saving}
                className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── PT Slabs Tab ─────────────────────────────────────────────────────────────

type PtSlabsByState = Record<string, PtSlab[]>;

interface AddSlabForm {
  state_code: string;
  state_name: string;
  income_from: string;
  income_to: string;
  pt_amount: string;
  frequency: string;
  effective_from: string;
}

const EMPTY_SLAB_FORM: AddSlabForm = {
  state_code: "MH",
  state_name: "Maharashtra",
  income_from: "0",
  income_to: "",
  pt_amount: "0",
  frequency: "monthly",
  effective_from: new Date().toISOString().slice(0, 10),
};

function PtSlabsTab() {
  const [allSlabs, setAllSlabs] = useState<PtSlab[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  // Add slab modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState<AddSlabForm>(EMPTY_SLAB_FORM);
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState("");

  // Edit slab (inline patch)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPtAmount, setEditPtAmount] = useState("");
  const [patchSaving, setPatchSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: PtSlab[] }>("/api/payroll/pt-slabs");
      setAllSlabs(res.data ?? []);
    } catch (err: unknown) {
      setMessage({ text: err instanceof Error ? err.message : "Failed to load PT slabs", ok: false });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  // Group by state_code
  const grouped: PtSlabsByState = allSlabs.reduce<PtSlabsByState>((acc, slab) => {
    (acc[slab.state_code] = acc[slab.state_code] ?? []).push(slab);
    return acc;
  }, {});
  const stateKeys = Object.keys(grouped).sort();

  const handleAddSave = async () => {
    if (!addForm.state_code || !addForm.state_name || !addForm.effective_from) {
      setAddError("state_code, state_name, and effective_from are required.");
      return;
    }
    setAddSaving(true);
    setAddError("");
    try {
      await hrmsApi.post("/api/payroll/pt-slabs", {
        state_code:    addForm.state_code.toUpperCase(),
        state_name:    addForm.state_name,
        income_from:   Number(addForm.income_from),
        income_to:     addForm.income_to !== "" ? Number(addForm.income_to) : null,
        pt_amount:     Number(addForm.pt_amount),
        frequency:     addForm.frequency,
        effective_from: addForm.effective_from,
      });
      setMessage({ text: "PT slab added.", ok: true });
      setShowAddModal(false);
      setAddForm(EMPTY_SLAB_FORM);
      await load();
    } catch (err: unknown) {
      setAddError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setAddSaving(false);
    }
  };

  const startEdit = (slab: PtSlab) => {
    setEditingId(slab.id);
    setEditPtAmount(String(slab.pt_amount));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditPtAmount("");
  };

  const handlePatch = async (slab: PtSlab) => {
    setPatchSaving(true);
    try {
      await hrmsApi.patch(`/api/payroll/pt-slabs/${slab.id}`, {
        pt_amount: Number(editPtAmount),
      });
      setMessage({ text: "Slab updated.", ok: true });
      setEditingId(null);
      await load();
    } catch (err: unknown) {
      setMessage({ text: err instanceof Error ? err.message : "Update failed", ok: false });
    } finally {
      setPatchSaving(false);
    }
  };

  const toggleActive = async (slab: PtSlab) => {
    try {
      await hrmsApi.patch(`/api/payroll/pt-slabs/${slab.id}`, {
        is_active: slab.income_from !== undefined ? 0 : 1,
      });
      setMessage({ text: "Slab status updated.", ok: true });
      await load();
    } catch (err: unknown) {
      setMessage({ text: err instanceof Error ? err.message : "Update failed", ok: false });
    }
  };

  const setAddField = <K extends keyof AddSlabForm>(k: K, v: AddSlabForm[K]) =>
    setAddForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-500">
            {allSlabs.length} slabs across {stateKeys.length} state{stateKeys.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="rounded-xl border border-slate-200 p-2 hover:bg-slate-50"
          >
            <RefreshCcw className="h-4 w-4 text-slate-500" />
          </button>
          <button
            onClick={() => { setAddForm(EMPTY_SLAB_FORM); setAddError(""); setShowAddModal(true); }}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add Slab
          </button>
        </div>
      </div>

      {message && (
        <div className={`rounded-xl px-4 py-3 text-sm ${message.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
          {message.text}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500">
          <Loader className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : stateKeys.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 px-4 py-8 text-center text-slate-400 text-sm">
          No PT slabs found. Add the first slab above.
        </div>
      ) : (
        <div className="space-y-5">
          {stateKeys.map((stateCode) => (
            <div key={stateCode}>
              <h4 className="mb-2 text-xs font-black uppercase tracking-wider text-slate-500">
                {stateCode} — {grouped[stateCode][0]?.state_name}
              </h4>
              <div className="overflow-x-auto rounded-2xl border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      {["Income From", "Income To", "PT Amount", "Frequency", "Effective From", "Actions"].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {grouped[stateCode].map((slab) => (
                      <tr key={slab.id} className="hover:bg-slate-50/60">
                        <td className="px-4 py-3 text-slate-700">₹{fmt(slab.income_from)}</td>
                        <td className="px-4 py-3 text-slate-700">
                          {slab.income_to != null ? `₹${fmt(slab.income_to)}` : "No limit"}
                        </td>
                        <td className="px-4 py-3 font-semibold text-slate-800">
                          {editingId === slab.id ? (
                            <input
                              type="number"
                              value={editPtAmount}
                              onChange={(e) => setEditPtAmount(e.target.value)}
                              className="w-24 rounded-lg border border-blue-400 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          ) : slab.pt_amount === 0 ? (
                            <span className="text-emerald-600">Nil</span>
                          ) : (
                            `₹${fmt(slab.pt_amount)}`
                          )}
                        </td>
                        <td className="px-4 py-3 capitalize text-slate-600">{slab.frequency.replace("_", " ")}</td>
                        <td className="px-4 py-3 text-slate-500">{fmtDate(slab.effective_from)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {editingId === slab.id ? (
                              <>
                                <button
                                  onClick={() => handlePatch(slab)}
                                  disabled={patchSaving}
                                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                                >
                                  {patchSaving ? "…" : "Save"}
                                </button>
                                <button
                                  onClick={cancelEdit}
                                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  onClick={() => startEdit(slab)}
                                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                                >
                                  Edit
                                </button>
                                <button
                                  onClick={() => toggleActive(slab)}
                                  className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-500 hover:bg-red-50"
                                >
                                  Deactivate
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Slab Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-800">Add PT Slab</h3>
              <button onClick={() => setShowAddModal(false)}>
                <X className="h-5 w-5 text-slate-400 hover:text-slate-600" />
              </button>
            </div>

            {addError && (
              <div className="mb-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{addError}</div>
            )}

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">State Code *</label>
                  <div className="relative">
                    <select
                      value={addForm.state_code}
                      onChange={(e) => {
                        const found = PT_STATES.find((s) => s.code === e.target.value);
                        setAddField("state_code", e.target.value);
                        if (found) setAddField("state_name", found.name);
                      }}
                      className="w-full appearance-none rounded-xl border border-slate-200 pl-3 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {PT_STATES.map((s) => (
                        <option key={s.code} value={s.code}>{s.code}</option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">State Name *</label>
                  <input
                    value={addForm.state_name}
                    onChange={(e) => setAddField("state_name", e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Income From *</label>
                  <input
                    type="number"
                    min={0}
                    value={addForm.income_from}
                    onChange={(e) => setAddField("income_from", e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Income To <span className="font-normal text-slate-400">(blank = no limit)</span>
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={addForm.income_to}
                    onChange={(e) => setAddField("income_to", e.target.value)}
                    placeholder="Leave blank for no limit"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">PT Amount (₹) *</label>
                  <input
                    type="number"
                    min={0}
                    value={addForm.pt_amount}
                    onChange={(e) => setAddField("pt_amount", e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Frequency *</label>
                  <div className="relative">
                    <select
                      value={addForm.frequency}
                      onChange={(e) => setAddField("frequency", e.target.value)}
                      className="w-full appearance-none rounded-xl border border-slate-200 pl-3 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="monthly">Monthly</option>
                      <option value="half_yearly">Half-yearly</option>
                      <option value="annually">Annually</option>
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Effective From *</label>
                <input
                  type="date"
                  value={addForm.effective_from}
                  onChange={(e) => setAddField("effective_from", e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="mt-5 flex gap-3 justify-end">
              <button
                onClick={() => setShowAddModal(false)}
                className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                onClick={handleAddSave}
                disabled={addSaving}
                className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {addSaving ? "Adding…" : "Add Slab"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ECR / ESIC Tab ───────────────────────────────────────────────────────────

function EcrEsicTab() {
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [selectedRun, setSelectedRun] = useState("");
  const [ecrData, setEcrData] = useState<EcrResponse | null>(null);
  const [esicData, setEsicData] = useState<EsicResponse | null>(null);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [loadingEcr, setLoadingEcr] = useState(false);
  const [loadingEsic, setLoadingEsic] = useState(false);
  const [message, setMessage] = useState("");
  const [view, setView] = useState<"none" | "ecr" | "esic">("none");

  useEffect(() => {
    setLoadingRuns(true);
    hrmsApi
      .get<{ success: boolean; data: PayrollRun[] }>("/api/payroll/runs?limit=50")
      .then((r) => setRuns(r.data ?? []))
      .catch(() => {})
      .finally(() => setLoadingRuns(false));
  }, []);

  const generateEcr = async () => {
    if (!selectedRun) return setMessage("Select a run first");
    setLoadingEcr(true);
    setMessage("");
    setView("none");
    try {
      const res = await hrmsApi.get<EcrResponse>(`/api/payroll/runs/${selectedRun}/ecr`);
      setEcrData(res);
      setView("ecr");
    } catch (err: any) {
      setMessage(err?.message || "ECR generation failed");
    } finally {
      setLoadingEcr(false);
    }
  };

  const generateEsic = async () => {
    if (!selectedRun) return setMessage("Select a run first");
    setLoadingEsic(true);
    setMessage("");
    setView("none");
    try {
      const res = await hrmsApi.get<EsicResponse>(`/api/payroll/runs/${selectedRun}/esic-challan`);
      setEsicData(res);
      setView("esic");
    } catch (err: any) {
      setMessage(err?.message || "ESIC challan failed");
    } finally {
      setLoadingEsic(false);
    }
  };

  const copyEcrCsv = () => {
    if (!ecrData) return;
    const header = "UAN,Member Name,Wages,EPF Contribution,EPS Contribution";
    const lines = ecrData.data.map((r) =>
      `${r.uan ?? ""},${r.member_name},${r.wages},${r.epf_contribution},${r.eps_contribution}`
    );
    copyText([header, ...lines].join("\n"));
  };

  const copyEsicCsv = () => {
    if (!esicData) return;
    const header = "Employee Code,Employee Name,Wages,Employee Contribution,Employer Contribution";
    const lines = esicData.data.map((r) =>
      `${r.employee_code},${r.employee_name},${r.wages},${r.employee_contribution},${r.employer_contribution}`
    );
    copyText([header, ...lines].join("\n"));
  };

  return (
    <div className="space-y-4">
      {message && (
        <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{message}</div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <select
            value={selectedRun}
            onChange={(e) => { setSelectedRun(e.target.value); setView("none"); }}
            disabled={loadingRuns}
            className="appearance-none rounded-xl border border-slate-200 pl-3 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[200px]"
          >
            <option value="">Select payroll run…</option>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.run_month} — {r.status}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        </div>

        <button
          onClick={generateEcr}
          disabled={!selectedRun || loadingEcr}
          className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
        >
          {loadingEcr && <Loader className="h-3.5 w-3.5 animate-spin" />}
          Generate ECR
        </button>

        <button
          onClick={generateEsic}
          disabled={!selectedRun || loadingEsic}
          className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50 flex items-center gap-2"
        >
          {loadingEsic && <Loader className="h-3.5 w-3.5 animate-spin" />}
          ESIC Challan
        </button>
      </div>

      {/* ECR Table */}
      {view === "ecr" && ecrData && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-bold text-slate-700">ECR — {ecrData.data.length} employees</h4>
            <button
              onClick={copyEcrCsv}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              <Copy className="h-3.5 w-3.5" /> Copy CSV
            </button>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  {["UAN", "Member Name", "Wages", "EPF Contribution", "EPS Contribution"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ecrData.data.map((row, i) => (
                  <tr key={i} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3 font-mono text-xs">
                      {row.uan ?? <span className="text-amber-500">No UAN</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-800">{row.member_name}</td>
                    <td className="px-4 py-3 text-right">₹{fmt(row.wages)}</td>
                    <td className="px-4 py-3 text-right text-blue-700">₹{fmt(row.epf_contribution)}</td>
                    <td className="px-4 py-3 text-right text-violet-700">₹{fmt(row.eps_contribution)}</td>
                  </tr>
                ))}
                {ecrData.data.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-400 text-sm">
                      No data. Run must be calculated first.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ESIC Table */}
      {view === "esic" && esicData && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-bold text-slate-700">ESIC Challan — {esicData.period}</h4>
            <button
              onClick={copyEsicCsv}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              <Copy className="h-3.5 w-3.5" /> Copy CSV
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Employees", value: esicData.employee_count },
              { label: "Total Wages", value: `₹${fmt(esicData.total_wages)}` },
              { label: "Employee Contribution", value: `₹${fmt(esicData.employee_total)}` },
              { label: "Employer Contribution", value: `₹${fmt(esicData.employer_total)}` },
            ].map((card) => (
              <div key={card.label} className="rounded-2xl bg-slate-50 border border-slate-200 p-4">
                <p className="text-xs font-semibold text-slate-500">{card.label}</p>
                <p className="mt-1 text-lg font-black text-slate-800">{card.value}</p>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  {["Code", "Employee Name", "Wages", "Emp. Contribution", "Employer Contribution"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {esicData.data.map((row, i) => (
                  <tr key={i} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">{row.employee_code}</td>
                    <td className="px-4 py-3 text-slate-800">{row.employee_name}</td>
                    <td className="px-4 py-3 text-right">₹{fmt(row.wages)}</td>
                    <td className="px-4 py-3 text-right text-blue-700">₹{fmt(row.employee_contribution)}</td>
                    <td className="px-4 py-3 text-right text-violet-700">₹{fmt(row.employer_contribution)}</td>
                  </tr>
                ))}
                {esicData.data.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-400 text-sm">
                      No ESIC data for this run.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Min Wages Tab ────────────────────────────────────────────────────────────

function MinWagesTab() {
  const [wages, setWages] = useState<MinWage[]>([]);
  const [selectedState, setSelectedState] = useState("MH");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const load = async (state: string) => {
    setLoading(true);
    setMessage("");
    try {
      const res = await hrmsApi.get<{ success: boolean; data: MinWage[] }>(
        `/api/payroll/minimum-wages?state_code=${state}`
      );
      setWages(res.data ?? []);
    } catch (err: any) {
      setMessage(err?.message || "Failed to load minimum wages");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(selectedState); }, [selectedState]);

  const CATEGORY_LABELS: Record<string, string> = {
    unskilled: "Unskilled",
    semi_skilled: "Semi-Skilled",
    skilled: "Skilled",
    highly_skilled: "Highly Skilled",
  };

  return (
    <div className="space-y-4">
      {message && (
        <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{message}</div>
      )}

      <div className="flex items-center gap-3">
        <label className="text-sm font-semibold text-slate-600">State:</label>
        <div className="relative">
          <select
            value={selectedState}
            onChange={(e) => setSelectedState(e.target.value)}
            className="appearance-none rounded-xl border border-slate-200 pl-3 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {PT_STATES.map((s) => (
              <option key={s.code} value={s.code}>{s.name}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        </div>
      </div>

      {wages.length === 0 && !loading && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-amber-700">
            No minimum wage data for this state yet. Seed data can be added via{" "}
            <code className="font-mono text-xs">minimum_wage_master</code>.
          </p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500">
          <Loader className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : wages.length > 0 ? (
        <div className="overflow-x-auto rounded-2xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                {["Category", "Daily Rate", "Monthly Rate", "Effective From"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {wages.map((w) => (
                <tr key={w.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3 font-semibold text-slate-700">
                    {CATEGORY_LABELS[w.category] ?? w.category}
                  </td>
                  <td className="px-4 py-3 text-slate-700">₹{fmt(w.daily_rate)}</td>
                  <td className="px-4 py-3 text-slate-700">₹{fmt(w.monthly_rate)}</td>
                  <td className="px-4 py-3 text-slate-500">{fmtDate(w.effective_from)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <p className="text-xs text-slate-400">
        To check compliance, compare employee CTC / 26 against the daily rate for their skill category.
        Employees below minimum wage should be flagged in HR review.
      </p>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function NativeStatutoryCompliance() {
  const [activeTab, setActiveTab] = useState<Tab>("PF / UAN");

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100/50 p-6">
        {/* Header */}
        <div className="mb-6 flex items-start gap-4">
          <div className="rounded-2xl bg-blue-600 p-3">
            <Shield className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight text-slate-900">
              Statutory Compliance
            </h1>
            <p className="mt-0.5 text-sm text-slate-500">
              PF / UAN management, Professional Tax slabs, ECR generation, ESIC challans, and minimum wages.
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="mb-6 flex gap-1 rounded-2xl bg-white p-1 shadow-sm border border-slate-200 w-fit">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition-all ${
                activeTab === tab
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="glass-card rounded-3xl bg-white border border-slate-200 p-6 shadow-sm">
          {activeTab === "PF / UAN"  && <UanTab />}
          {activeTab === "PT Slabs"  && <PtSlabsTab />}
          {activeTab === "ECR / ESIC" && <EcrEsicTab />}
          {activeTab === "Min Wages" && <MinWagesTab />}
        </div>
      </div>
    </DashboardLayout>
  );
}
