import { useEffect, useState } from "react";
import { CheckCircle2, Loader, RefreshCcw, Save, Settings, Trash2, X, Target, TrendingUp, Zap } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Process {
  id: string;
  process_name: string;
}

interface KpiMetric {
  id: string;
  metric_code: string;
  metric_name: string;
  category: string;
  unit: string;
  direction: "higher_is_better" | "lower_is_better";
}

interface ProcessConfig {
  id: string;
  process_id: string;
  metric_id: string;
  metric_name: string;
  metric_code: string;
  metric_type: string;
  unit: string;
  target_value: number;
  min_threshold: number | null;
  max_achievement: number;
  weightage: number;
  template_default: number | null;
}

interface RatingConfig {
  id: string;
  process_id: string | null;
  rating_label: string;
  min_score_pct: number;
  max_score_pct: number;
  color_code: string | null;
}

interface MetricRow {
  metric: KpiMetric;
  override: ProcessConfig | null;
  editTarget: string;
  editMinThreshold: string;
  editMaxAchievement: string;
  editWeightage: string;
  saving: boolean;
}

interface RatingRow {
  id: string | null;
  process_id: string | null;
  rating_label: string;
  min_score_pct: string;
  max_score_pct: string;
  color_code: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_RATING_LABELS = ["S", "A", "B", "C", "D"];

const DEFAULT_COLORS: Record<string, string> = {
  S: "#16a34a",
  A: "#2563eb",
  B: "#d97706",
  C: "#ea580c",
  D: "#dc2626",
};

// ─── Small components ─────────────────────────────────────────────────────────

function Badge({ label, variant }: { label: string; variant: "override" | "default" }) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-bold ${
        variant === "override"
          ? "bg-blue-100 text-blue-700 border border-blue-200"
          : "bg-slate-100 text-slate-500"
      }`}
    >
      {label === "override" ? "Override" : "Default"}
    </span>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`cursor-pointer rounded-2xl px-6 py-3 text-sm font-bold transition-all ${
        active
          ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-200/50"
          : "bg-white text-slate-600 hover:bg-slate-50 border border-slate-200"
      }`}
    >
      {children}
    </button>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function NativeKPIConfiguration() {
  const [activeTab, setActiveTab] = useState<"targets" | "ratings">("targets");

  // Shared
  const [processes, setProcesses] = useState<Process[]>([]);
  const [selectedProcessId, setSelectedProcessId] = useState<string>("");
  const [loadingProcesses, setLoadingProcesses] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  // KPI Targets tab
  const [allMetrics, setAllMetrics] = useState<KpiMetric[]>([]);
  const [processConfigs, setProcessConfigs] = useState<ProcessConfig[]>([]);
  const [metricRows, setMetricRows] = useState<MetricRow[]>([]);
  const [loadingTargets, setLoadingTargets] = useState(false);

  // Rating Config tab
  const [globalRatings, setGlobalRatings] = useState<RatingConfig[]>([]);
  const [ratingRows, setRatingRows] = useState<RatingRow[]>([]);
  const [editingRatings, setEditingRatings] = useState(false);
  const [savingRatings, setSavingRatings] = useState(false);
  const [loadingRatings, setLoadingRatings] = useState(false);

  // ─── Load processes on mount ──────────────────────────────────────────────

  useEffect(() => {
    const load = async () => {
      setLoadingProcesses(true);
      try {
        const res = await hrmsApi.get<{ success: boolean; data: Process[] }>("/api/processes");
        const list = res.data ?? [];
        setProcesses(list);
        if (list.length > 0) setSelectedProcessId(list[0].id);
      } catch {
        setMessage({ text: "Failed to load processes.", ok: false });
      } finally {
        setLoadingProcesses(false);
      }
    };
    void load();
  }, []);

  // ─── Load metrics + process configs when process/tab changes ─────────────

  useEffect(() => {
    if (!selectedProcessId) return;
    if (activeTab === "targets") void loadTargets();
    if (activeTab === "ratings") void loadRatings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProcessId, activeTab]);

  const loadTargets = async () => {
    setLoadingTargets(true);
    setMessage(null);
    try {
      const [metricsRes, configRes] = await Promise.all([
        hrmsApi.get<{ data: KpiMetric[] }>("/api/kpi/metrics"),
        hrmsApi.get<{ success: boolean; data: ProcessConfig[] }>(
          `/api/kpi/process-config/${selectedProcessId}`
        ),
      ]);
      const metrics = metricsRes.data ?? [];
      const configs = configRes.data ?? [];
      setAllMetrics(metrics);
      setProcessConfigs(configs);

      const configMap = new Map(configs.map((c) => [c.metric_id, c]));
      const rows: MetricRow[] = metrics.map((m) => {
        const ov = configMap.get(m.id) ?? null;
        return {
          metric: m,
          override: ov,
          editTarget: ov ? String(ov.target_value) : "",
          editMinThreshold: ov?.min_threshold != null ? String(ov.min_threshold) : "",
          editMaxAchievement: ov ? String(ov.max_achievement) : "120",
          editWeightage: ov ? String(ov.weightage) : "100",
          saving: false,
        };
      });
      setMetricRows(rows);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load KPI targets.";
      setMessage({ text: msg, ok: false });
    } finally {
      setLoadingTargets(false);
    }
  };

  const loadRatings = async () => {
    setLoadingRatings(true);
    setMessage(null);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: RatingConfig[] }>(
        `/api/kpi/rating-config?process_id=${selectedProcessId}`
      );
      const all = res.data ?? [];

      const globals = all.filter((r) => r.process_id === null);
      const processSpecific = all.filter((r) => r.process_id === selectedProcessId);

      setGlobalRatings(globals);

      const source = processSpecific.length > 0 ? processSpecific : globals;
      setRatingRows(
        source.map((r) => ({
          id: processSpecific.length > 0 ? r.id : null,
          process_id: r.process_id,
          rating_label: r.rating_label,
          min_score_pct: String(r.min_score_pct),
          max_score_pct: String(r.max_score_pct),
          color_code: r.color_code ?? DEFAULT_COLORS[r.rating_label] ?? "#6b7280",
        }))
      );
      setEditingRatings(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load rating config.";
      setMessage({ text: msg, ok: false });
    } finally {
      setLoadingRatings(false);
    }
  };

  // ─── KPI Targets: per-row save ────────────────────────────────────────────

  const saveRow = async (idx: number) => {
    const row = metricRows[idx];
    const targetVal = parseFloat(row.editTarget);
    if (isNaN(targetVal)) {
      setMessage({ text: "Target value must be a number.", ok: false });
      return;
    }
    setMetricRows((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, saving: true } : r))
    );
    try {
      await hrmsApi.post(`/api/kpi/process-config/${selectedProcessId}`, {
        metric_id: row.metric.id,
        target_value: targetVal,
        min_threshold: row.editMinThreshold !== "" ? parseFloat(row.editMinThreshold) : null,
        max_achievement: row.editMaxAchievement !== "" ? parseFloat(row.editMaxAchievement) : 120,
        weightage: row.editWeightage !== "" ? parseFloat(row.editWeightage) : 100,
      });
      setMessage({ text: `Saved override for ${row.metric.metric_name}.`, ok: true });
      await loadTargets();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Save failed.";
      setMessage({ text: msg, ok: false });
      setMetricRows((prev) =>
        prev.map((r, i) => (i === idx ? { ...r, saving: false } : r))
      );
    }
  };

  const clearRow = async (idx: number) => {
    const row = metricRows[idx];
    if (!row.override) return;
    try {
      await hrmsApi.delete(
        `/api/kpi/process-config/${selectedProcessId}/${row.metric.id}`
      );
      setMessage({ text: `Cleared override for ${row.metric.metric_name}.`, ok: true });
      await loadTargets();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Clear failed.";
      setMessage({ text: msg, ok: false });
    }
  };

  const updateRow = (
    idx: number,
    field: "editTarget" | "editMinThreshold" | "editMaxAchievement" | "editWeightage",
    value: string
  ) => {
    setMetricRows((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r))
    );
  };

  // ─── Rating Config: save ──────────────────────────────────────────────────

  const saveRatings = async () => {
    setSavingRatings(true);
    setMessage(null);
    try {
      const ratings = ratingRows.map((r) => ({
        rating_label: r.rating_label,
        min_score_pct: parseFloat(r.min_score_pct),
        max_score_pct: parseFloat(r.max_score_pct),
        color_code: r.color_code || null,
      }));
      await hrmsApi.put(`/api/kpi/rating-config/${selectedProcessId}`, { ratings });
      setMessage({ text: "Rating config saved.", ok: true });
      setEditingRatings(false);
      await loadRatings();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Save failed.";
      setMessage({ text: msg, ok: false });
    } finally {
      setSavingRatings(false);
    }
  };

  const updateRatingRow = (
    idx: number,
    field: "min_score_pct" | "max_score_pct" | "color_code",
    value: string
  ) => {
    setRatingRows((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r))
    );
  };

  const seedDefaultRatings = () => {
    setRatingRows(
      DEFAULT_RATING_LABELS.map((label) => {
        const g = globalRatings.find((r) => r.rating_label === label);
        return {
          id: null,
          process_id: null,
          rating_label: label,
          min_score_pct: g ? String(g.min_score_pct) : "0",
          max_score_pct: g ? String(g.max_score_pct) : "100",
          color_code: g?.color_code ?? DEFAULT_COLORS[label] ?? "#6b7280",
        };
      })
    );
    setEditingRatings(true);
  };

  const processName =
    processes.find((p) => p.id === selectedProcessId)?.process_name ?? "—";

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <DashboardLayout>
      <main className="space-y-8 p-6 lg:p-8">
        {/* Hero Header */}
        <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-indigo-600 via-blue-600 to-cyan-600 p-8 text-white shadow-2xl shadow-blue-200/40">
          <div className="absolute -right-10 -top-10 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
          <div className="absolute -bottom-10 -left-10 h-48 w-48 rounded-full bg-cyan-400/20 blur-2xl" />
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-white/20 px-3 py-1 text-xs font-semibold backdrop-blur-sm">
                <Settings className="h-3.5 w-3.5" /> KPI Administration
              </div>
              <h1 className="text-4xl font-black tracking-tight">KPI Configuration</h1>
              <p className="mt-2 max-w-2xl text-blue-100">
                Set per-process metric targets and customize rating bands.
              </p>
            </div>
            <button
              onClick={() => (activeTab === "targets" ? loadTargets() : loadRatings())}
              disabled={loadingTargets || loadingRatings}
              className="inline-flex items-center gap-2 rounded-2xl bg-white/20 px-4 py-2.5 text-sm font-bold text-white backdrop-blur-sm hover:bg-white/30 transition-all disabled:opacity-50"
            >
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </button>
          </div>
        </div>

        {/* Message banner */}
        {message && (
          <div
            className={`flex items-center justify-between gap-3 rounded-2xl border p-4 text-sm font-bold ${
              message.ok
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-rose-200 bg-rose-50 text-rose-800"
            }`}
          >
            <div className="flex items-center gap-2">
              {message.ok ? (
                <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
              ) : (
                <X className="h-4 w-4 flex-shrink-0" />
              )}
              {message.text}
            </div>
            <button
              onClick={() => setMessage(null)}
              className="cursor-pointer text-current opacity-60 hover:opacity-100 rounded-full hover:bg-black/5 p-1 transition-all"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Process selector */}
        <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-lg shadow-slate-200/40">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-100 text-blue-600">
              <Target className="h-5 w-5" />
            </div>
            <label className="text-sm font-bold text-slate-700">Process</label>
            {loadingProcesses ? (
              <Loader className="h-4 w-4 animate-spin text-slate-400" />
            ) : (
              <select
                value={selectedProcessId}
                onChange={(e) => {
                  setSelectedProcessId(e.target.value);
                  setMessage(null);
                }}
                className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 outline-none focus:border-blue-400 transition-colors min-w-[220px] bg-white"
              >
                {processes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.process_name}
                  </option>
                ))}
              </select>
            )}
            <span className="rounded-2xl bg-slate-100 px-4 py-2 text-xs font-bold text-slate-600">
              {processName}
            </span>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-3">
          <TabButton active={activeTab === "targets"} onClick={() => setActiveTab("targets")}>
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4" /> KPI Targets
            </div>
          </TabButton>
          <TabButton active={activeTab === "ratings"} onClick={() => setActiveTab("ratings")}>
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" /> Rating Config
            </div>
          </TabButton>
        </div>

        {/* ── Tab: KPI Targets ── */}
        {activeTab === "targets" && (
          <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-lg shadow-slate-200/40">
            <div className="border-b border-slate-100 p-6">
              <h2 className="text-xl font-black text-slate-950 flex items-center gap-2">
                <Zap className="h-5 w-5 text-amber-500" /> Metric Targets
              </h2>
              <p className="text-sm text-slate-500 mt-1">
                Set process-level overrides. Rows without a saved override fall back to the template default.
              </p>
            </div>

            {loadingTargets ? (
              <div className="flex items-center justify-center py-16">
                <Loader className="h-8 w-8 animate-spin text-slate-400" />
              </div>
            ) : allMetrics.length === 0 ? (
              <div className="py-16 text-center text-slate-400">
                <p className="font-semibold">No metrics found.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <tr>
                      {[
                        "Metric",
                        "Unit",
                        "Direction",
                        "Template Default",
                        "Target Override",
                        "Min Threshold",
                        "Max Achievement %",
                        "Weightage %",
                        "Status",
                        "Actions",
                      ].map((h) => (
                        <th key={h} className="p-4 font-bold whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {metricRows.map((row, idx) => (
                      <tr
                        key={row.metric.id}
                        className="border-t border-slate-100 hover:bg-slate-50/80 transition-colors"
                      >
                        <td className="p-4">
                          <div className="font-bold text-slate-950">{row.metric.metric_name}</div>
                          <div className="font-mono text-xs text-slate-400">
                            {row.metric.metric_code}
                          </div>
                        </td>
                        <td className="p-4 text-slate-600 font-medium">{row.metric.unit}</td>
                        <td className="p-4">
                          <span
                            className={`rounded-xl px-2.5 py-1 text-xs font-bold ${
                              row.metric.direction === "higher_is_better"
                                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                : "bg-amber-50 text-amber-700 border border-amber-200"
                            }`}
                          >
                            {row.metric.direction === "higher_is_better" ? "Higher ↑" : "Lower ↓"}
                          </span>
                        </td>
                        <td className="p-4 font-mono text-slate-500">
                          {row.override?.template_default != null
                            ? row.override.template_default
                            : "—"}
                        </td>
                        <td className="p-4">
                          <input
                            type="number"
                            value={row.editTarget}
                            onChange={(e) => updateRow(idx, "editTarget", e.target.value)}
                            placeholder="e.g. 95"
                            className="w-24 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 transition-colors"
                          />
                        </td>
                        <td className="p-4">
                          <input
                            type="number"
                            value={row.editMinThreshold}
                            onChange={(e) => updateRow(idx, "editMinThreshold", e.target.value)}
                            placeholder="optional"
                            className="w-24 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 transition-colors"
                          />
                        </td>
                        <td className="p-4">
                          <input
                            type="number"
                            value={row.editMaxAchievement}
                            onChange={(e) =>
                              updateRow(idx, "editMaxAchievement", e.target.value)
                            }
                            placeholder="120"
                            className="w-20 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 transition-colors"
                          />
                        </td>
                        <td className="p-4">
                          <input
                            type="number"
                            value={row.editWeightage}
                            onChange={(e) => updateRow(idx, "editWeightage", e.target.value)}
                            placeholder="100"
                            className="w-20 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 transition-colors"
                          />
                        </td>
                        <td className="p-4">
                          <Badge
                            label={row.override ? "override" : "default"}
                            variant={row.override ? "override" : "default"}
                          />
                        </td>
                        <td className="p-4">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => saveRow(idx)}
                              disabled={row.saving || !row.editTarget}
                              className="inline-flex items-center gap-1.5 cursor-pointer rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-3 py-2 text-xs font-bold text-white hover:shadow-lg transition-all disabled:opacity-40"
                            >
                              {row.saving ? (
                                <Loader className="h-3 w-3 animate-spin" />
                              ) : (
                                <Save className="h-3 w-3" />
                              )}
                              Save
                            </button>
                            {row.override && (
                              <button
                                onClick={() => clearRow(idx)}
                                className="inline-flex items-center gap-1.5 cursor-pointer rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-600 hover:bg-rose-100 transition-colors"
                              >
                                <Trash2 className="h-3 w-3" />
                                Clear
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
        )}

        {/* ── Tab: Rating Config ── */}
        {activeTab === "ratings" && (
          <div className="space-y-4">
            {/* Global defaults reference */}
            {globalRatings.length > 0 && (
              <div className="rounded-[2rem] border border-slate-200 bg-slate-50 p-6">
                <p className="mb-3 text-xs font-black uppercase tracking-widest text-slate-400">
                  Global Defaults (read-only reference)
                </p>
                <div className="flex flex-wrap gap-3">
                  {globalRatings
                    .slice()
                    .sort((a, b) => b.min_score_pct - a.min_score_pct)
                    .map((r) => (
                      <div
                        key={r.id}
                        className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm"
                      >
                        <span
                          className="h-3 w-3 rounded-full flex-shrink-0"
                          style={{ backgroundColor: r.color_code ?? "#6b7280" }}
                        />
                        <span className="font-black text-slate-950">{r.rating_label}</span>
                        <span className="text-xs text-slate-500 font-medium">
                          {r.min_score_pct}% – {r.max_score_pct}%
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* Process-specific rating editor */}
            <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-lg shadow-slate-200/40">
              <div className="flex items-center justify-between border-b border-slate-100 p-6">
                <div>
                  <h2 className="text-xl font-black text-slate-950 flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-blue-600" /> Rating Bands — {processName}
                  </h2>
                  <p className="text-sm text-slate-500 mt-1">
                    Process-specific overrides. Leave as global if not customised.
                  </p>
                </div>
                <div className="flex gap-2">
                  {!editingRatings ? (
                    <button
                      onClick={() => {
                        if (ratingRows.length === 0) {
                          seedDefaultRatings();
                        } else {
                          setEditingRatings(true);
                        }
                      }}
                      className="cursor-pointer rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:shadow-lg transition-all"
                    >
                      Edit
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          setEditingRatings(false);
                          void loadRatings();
                        }}
                        className="cursor-pointer rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={saveRatings}
                        disabled={savingRatings}
                        className="inline-flex items-center gap-2 cursor-pointer rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 px-4 py-2.5 text-sm font-bold text-white hover:shadow-lg transition-all disabled:opacity-50"
                      >
                        {savingRatings ? (
                          <Loader className="h-4 w-4 animate-spin" />
                        ) : (
                          <Save className="h-4 w-4" />
                        )}
                        Save Rating Config
                      </button>
                    </>
                  )}
                </div>
              </div>

              {loadingRatings ? (
                <div className="flex items-center justify-center py-16">
                  <Loader className="h-8 w-8 animate-spin text-slate-400" />
                </div>
              ) : ratingRows.length === 0 ? (
                <div className="py-16 text-center text-slate-400">
                  <p className="font-semibold">No process-specific ratings configured.</p>
                  <p className="mt-1 text-xs">Click Edit to create overrides for this process.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[600px] text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                      <tr>
                        {["Rating", "Min Score %", "Max Score %", "Color", "Source"].map(
                          (h) => (
                            <th key={h} className="p-4 font-bold">
                              {h}
                            </th>
                          )
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {ratingRows
                        .slice()
                        .sort(
                          (a, b) =>
                            parseFloat(b.min_score_pct) - parseFloat(a.min_score_pct)
                        )
                        .map((row, idx) => (
                          <tr
                            key={row.rating_label}
                            className="border-t border-slate-100 hover:bg-slate-50/80 transition-colors"
                          >
                            <td className="p-4">
                              <span className="rounded-2xl bg-slate-100 px-4 py-2 font-black text-slate-950">
                                {row.rating_label}
                              </span>
                            </td>
                            <td className="p-4">
                              {editingRatings ? (
                                <input
                                  type="number"
                                  value={row.min_score_pct}
                                  onChange={(e) =>
                                    updateRatingRow(idx, "min_score_pct", e.target.value)
                                  }
                                  className="w-24 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 transition-colors"
                                />
                              ) : (
                                <span className="font-mono text-slate-700 font-medium">
                                  {row.min_score_pct}%
                                </span>
                              )}
                            </td>
                            <td className="p-4">
                              {editingRatings ? (
                                <input
                                  type="number"
                                  value={row.max_score_pct}
                                  onChange={(e) =>
                                    updateRatingRow(idx, "max_score_pct", e.target.value)
                                  }
                                  className="w-24 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 transition-colors"
                                />
                              ) : (
                                <span className="font-mono text-slate-700 font-medium">
                                  {row.max_score_pct}%
                                </span>
                              )}
                            </td>
                            <td className="p-4">
                              <div className="flex items-center gap-2">
                                <span
                                  className="h-6 w-6 rounded-full flex-shrink-0 border-2 border-white shadow-md"
                                  style={{ backgroundColor: row.color_code }}
                                />
                                {editingRatings ? (
                                  <input
                                    type="color"
                                    value={row.color_code}
                                    onChange={(e) =>
                                      updateRatingRow(idx, "color_code", e.target.value)
                                    }
                                    className="h-8 w-14 cursor-pointer rounded-lg border border-slate-200 p-0.5"
                                  />
                                ) : (
                                  <span className="font-mono text-xs text-slate-500 font-medium">
                                    {row.color_code}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="p-4">
                              <span
                                className={`rounded-full px-3 py-1 text-xs font-bold ${
                                  row.process_id !== null
                                    ? "bg-blue-100 text-blue-700 border border-blue-200"
                                    : "bg-slate-100 text-slate-500"
                                }`}
                              >
                                {row.process_id !== null ? "Override" : "Global"}
                              </span>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </DashboardLayout>
  );
}
