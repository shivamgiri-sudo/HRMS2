import { useEffect, useState } from "react";
import { Plus, Trash2, Save, X, Loader, BarChart2, Settings2 } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

// ─── Types ────────────────────────────────────────────────────────────────────

type OrgUnitType = "department" | "designation" | "process" | "cost_centre";

interface KpiMetric {
  id: string;
  metric_code: string;
  metric_name: string;
  category: string;
  unit: string;
  direction: string;
  family: string;
}

interface OrgUnit {
  id: string;
  name: string;
}

interface MasterConfig {
  id: string;
  metric_id: string;
  metric_code: string;
  metric_name: string;
  category: string;
  unit: string;
  direction: string;
  family: string;
  org_unit_type: OrgUnitType;
  org_unit_id: string;
  org_unit_name: string;
  target_value: number;
  min_threshold: number | null;
  max_achievement: number;
  weightage: number;
  is_active: number;
}

interface FormState {
  metric_id: string;
  org_unit_type: OrgUnitType;
  org_unit_id: string;
  target_value: string;
  min_threshold: string;
  max_achievement: string;
  weightage: string;
}

const EMPTY_FORM: FormState = {
  metric_id: "",
  org_unit_type: "process",
  org_unit_id: "",
  target_value: "",
  min_threshold: "",
  max_achievement: "120",
  weightage: "100",
};

const ORG_UNIT_LABELS: Record<OrgUnitType, string> = {
  department: "Department",
  designation: "Designation",
  process: "Process",
  cost_centre: "Cost Centre",
};

const CATEGORY_COLORS: Record<string, string> = {
  operations: "bg-blue-100 text-blue-700",
  quality: "bg-green-100 text-green-700",
  hr: "bg-purple-100 text-purple-700",
  sales: "bg-orange-100 text-orange-700",
  custom: "bg-gray-100 text-gray-700",
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function KpiMasterConfig() {
  const [configs, setConfigs] = useState<MasterConfig[]>([]);
  const [metrics, setMetrics] = useState<KpiMetric[]>([]);
  const [orgUnits, setOrgUnits] = useState<OrgUnit[]>([]);
  const [filterType, setFilterType] = useState<OrgUnitType | "all">("all");
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function loadConfigs() {
    setLoading(true);
    try {
      const params = filterType !== "all" ? `?org_unit_type=${filterType}` : "";
      const res = await hrmsApi.get<{ success: boolean; data: MasterConfig[] }>(`/api/kpi-master${params}`);
      setConfigs(res.data ?? []);
    } catch {
      setError("Failed to load KPI configurations");
    } finally {
      setLoading(false);
    }
  }

  async function loadMetrics() {
    try {
      const res = await hrmsApi.get<{ success: boolean; data: KpiMetric[] }>("/api/kpi/metrics");
      setMetrics(res.data ?? []);
    } catch {}
  }

  async function loadOrgUnits(type: OrgUnitType) {
    try {
      const res = await hrmsApi.get<{ success: boolean; data: OrgUnit[] }>(`/api/kpi-master/org-units/${type}`);
      setOrgUnits(res.data ?? []);
    } catch {}
  }

  useEffect(() => {
    loadConfigs();
    loadMetrics();
  }, [filterType]);

  useEffect(() => {
    if (form.org_unit_type) loadOrgUnits(form.org_unit_type);
  }, [form.org_unit_type]);

  function openAddModal() {
    setForm(EMPTY_FORM);
    setError(null);
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setForm(EMPTY_FORM);
    setError(null);
  }

  async function handleSave() {
    if (!form.metric_id || !form.org_unit_id || !form.target_value) {
      setError("Metric, Org Unit and Target Value are required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await hrmsApi.post("/api/kpi-master", {
        metric_id: form.metric_id,
        org_unit_type: form.org_unit_type,
        org_unit_id: form.org_unit_id,
        target_value: parseFloat(form.target_value),
        min_threshold: form.min_threshold ? parseFloat(form.min_threshold) : null,
        max_achievement: parseFloat(form.max_achievement || "120"),
        weightage: parseFloat(form.weightage || "100"),
      });
      setSuccess("KPI definition saved");
      closeModal();
      loadConfigs();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(err?.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Remove this KPI definition?")) return;
    try {
      await hrmsApi.delete(`/api/kpi-master/${id}`);
      setSuccess("KPI definition removed");
      loadConfigs();
      setTimeout(() => setSuccess(null), 3000);
    } catch {
      setError("Failed to remove");
    }
  }

  const filtered = filterType === "all" ? configs : configs.filter(c => c.org_unit_type === filterType);

  const selectedMetric = metrics.find(m => m.id === form.metric_id);

  return (
    <DashboardLayout>
      <div className="p-6 max-w-7xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Settings2 className="text-indigo-600" size={28} />
            <div>
              <h1 className="text-2xl font-bold text-gray-900">KPI Master Configuration</h1>
              <p className="text-sm text-gray-500 mt-0.5">Define KPI targets at Department, Designation, Process, or Cost Centre level</p>
            </div>
          </div>
          <button
            onClick={openAddModal}
            className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium"
          >
            <Plus size={16} />
            Add KPI Definition
          </button>
        </div>

        {/* Feedback */}
        {success && (
          <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg text-sm">{success}</div>
        )}
        {error && !showModal && (
          <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg text-sm">{error}</div>
        )}

        {/* Filter Tabs */}
        <div className="flex gap-2 flex-wrap">
          {(["all", "department", "designation", "process", "cost_centre"] as const).map(type => (
            <button
              key={type}
              onClick={() => setFilterType(type)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                filterType === type
                  ? "bg-indigo-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {type === "all" ? "All" : ORG_UNIT_LABELS[type]}
            </button>
          ))}
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader className="animate-spin text-indigo-500" size={32} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <BarChart2 size={48} className="mx-auto mb-3 opacity-40" />
            <p className="text-lg font-medium">No KPI definitions yet</p>
            <p className="text-sm mt-1">Click "Add KPI Definition" to get started</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Metric</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Category</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Org Unit Type</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Org Unit</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600">Target</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600">Min</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600">Max %</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600">Weight</th>
                  <th className="text-center px-4 py-3 font-semibold text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map(cfg => (
                  <tr key={cfg.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{cfg.metric_name}</div>
                      <div className="text-xs text-gray-400">{cfg.metric_code} · {cfg.unit}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium capitalize ${CATEGORY_COLORS[cfg.category] ?? "bg-gray-100 text-gray-700"}`}>
                        {cfg.category}
                      </span>
                    </td>
                    <td className="px-4 py-3 capitalize text-gray-600">{ORG_UNIT_LABELS[cfg.org_unit_type]}</td>
                    <td className="px-4 py-3 text-gray-800 font-medium">{cfg.org_unit_name}</td>
                    <td className="px-4 py-3 text-right font-mono text-gray-900">{cfg.target_value}</td>
                    <td className="px-4 py-3 text-right font-mono text-gray-500">{cfg.min_threshold ?? "—"}</td>
                    <td className="px-4 py-3 text-right font-mono text-gray-500">{cfg.max_achievement}%</td>
                    <td className="px-4 py-3 text-right font-mono text-gray-500">{cfg.weightage}%</td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => handleDelete(cfg.id)}
                        className="text-red-400 hover:text-red-600 transition-colors"
                        title="Remove"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Add KPI Definition</h2>
              <button onClick={closeModal} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">{error}</div>
              )}

              {/* Metric */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Metric *</label>
                <select
                  value={form.metric_id}
                  onChange={e => setForm(f => ({ ...f, metric_id: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">Select metric…</option>
                  {metrics.map(m => (
                    <option key={m.id} value={m.id}>{m.metric_name} ({m.metric_code})</option>
                  ))}
                </select>
                {selectedMetric && (
                  <p className="text-xs text-gray-400 mt-1">Unit: {selectedMetric.unit} · {selectedMetric.direction}</p>
                )}
              </div>

              {/* Org Unit Type */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Org Unit Type *</label>
                <div className="flex gap-2 flex-wrap">
                  {(["process", "department", "designation", "cost_centre"] as OrgUnitType[]).map(t => (
                    <button
                      key={t}
                      onClick={() => setForm(f => ({ ...f, org_unit_type: t, org_unit_id: "" }))}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                        form.org_unit_type === t
                          ? "bg-indigo-600 text-white border-indigo-600"
                          : "bg-white text-gray-700 border-gray-300 hover:border-indigo-400"
                      }`}
                    >
                      {ORG_UNIT_LABELS[t]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Org Unit */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{ORG_UNIT_LABELS[form.org_unit_type]} *</label>
                <select
                  value={form.org_unit_id}
                  onChange={e => setForm(f => ({ ...f, org_unit_id: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">Select {ORG_UNIT_LABELS[form.org_unit_type].toLowerCase()}…</option>
                  {orgUnits.map(u => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </div>

              {/* Target & Thresholds */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Target Value *</label>
                  <input
                    type="number"
                    value={form.target_value}
                    onChange={e => setForm(f => ({ ...f, target_value: e.target.value }))}
                    placeholder="e.g. 240"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Min Threshold</label>
                  <input
                    type="number"
                    value={form.min_threshold}
                    onChange={e => setForm(f => ({ ...f, min_threshold: e.target.value }))}
                    placeholder="optional"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Max Achievement %</label>
                  <input
                    type="number"
                    value={form.max_achievement}
                    onChange={e => setForm(f => ({ ...f, max_achievement: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Weightage %</label>
                  <input
                    type="number"
                    value={form.weightage}
                    onChange={e => setForm(f => ({ ...f, weightage: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200">
              <button
                onClick={closeModal}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 bg-indigo-600 text-white px-5 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-60 text-sm font-medium transition-colors"
              >
                {saving ? <Loader size={14} className="animate-spin" /> : <Save size={14} />}
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
