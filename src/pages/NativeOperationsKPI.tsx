import { useEffect, useState, useCallback } from "react";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Clock,
  Loader,
  Plus,
  RefreshCcw,
  Trophy,
  Users,
  X,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

// ─── Types ────────────────────────────────────────────────────────────────────

type KpiFamily = "operations" | "quality" | "performance" | "custom";

interface KpiMetric {
  id: string;
  metric_code: string;
  metric_name: string;
  family: KpiFamily;
  unit: string;
  direction: "higher_is_better" | "lower_is_better";
}

interface ProcessConfig {
  metric_id: string;
  metric_name: string;
  metric_code: string;
  target_value: number;
  min_threshold: number | null;
  unit: string;
}

interface LeaderboardEntry {
  employee_id: string;
  employee_code: string;
  full_name: string;
  weighted_score_pct: number;
  rating: string;
}

interface EmployeeScore {
  employee_id: string;
  employee_code: string;
  full_name: string;
  scores: Record<string, number | null>;
  overall: number;
}

interface Process {
  id: string;
  process_name: string;
}

interface TniCreated {
  id: string;
  employee_id: string;
  need_type: string;
  status: string;
}

type ScoreRow = LeaderboardEntry & {
  metric_scores?: Record<string, number>;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function secondsToHms(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatMetricValue(value: number | null, unit: string, metricCode: string): string {
  if (value === null) return "—";
  if (unit === "seconds" || metricCode === "AHT" || metricCode === "ACW" || metricCode === "HOLD_TIME" || metricCode === "TALK_TIME") {
    return secondsToHms(value);
  }
  if (unit === "percent") return `${value.toFixed(1)}%`;
  return String(value);
}

function scoreColor(pct: number): string {
  if (pct >= 90) return "text-emerald-600 font-bold";
  if (pct >= 75) return "text-amber-600 font-bold";
  return "text-red-600 font-bold";
}

function scoreBadge(pct: number): string {
  if (pct >= 90) return "bg-emerald-50 text-emerald-700 border border-emerald-200";
  if (pct >= 75) return "bg-amber-50 text-amber-700 border border-amber-200";
  return "bg-red-50 text-red-700 border border-red-200";
}

function vsTargetBadge(actual: number | null, target: number, direction: string): string {
  if (actual === null) return "bg-slate-100 text-slate-500";
  const achievement = direction === "lower_is_better"
    ? (target / actual) * 100
    : (actual / target) * 100;
  if (achievement >= 90) return "bg-emerald-50 text-emerald-700";
  if (achievement >= 75) return "bg-amber-50 text-amber-700";
  return "bg-red-50 text-red-700";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  title,
  value,
  sub,
  icon,
  tone,
}: {
  title: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  tone: string;
}) {
  return (
    <div className="rounded-3xl border bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-slate-500">{title}</p>
          <p className="mt-2 text-3xl font-black tracking-tight text-slate-950">{value}</p>
          {sub && <p className="mt-1 text-xs font-semibold text-slate-400">{sub}</p>}
        </div>
        <div className={`rounded-2xl p-3 ${tone}`}>{icon}</div>
      </div>
    </div>
  );
}

// ─── TNI Modal ────────────────────────────────────────────────────────────────

interface TniModalProps {
  employeeId: string;
  employeeName: string;
  metrics: KpiMetric[];
  onClose: () => void;
  onCreated: (tni: TniCreated) => void;
}

function TniModal({ employeeId, employeeName, metrics, onClose, onCreated }: TniModalProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    need_type: "soft_skills",
    description: "",
    priority: "medium",
    metric_id: "",
  });

  const submit = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await hrmsApi.post<{ data: TniCreated }>("/api/management/tni", {
        employee_id: employeeId,
        need_type: form.need_type,
        description: form.description.trim() || undefined,
        priority: form.priority,
        metric_id: form.metric_id || undefined,
      });
      onCreated(res.data);
      onClose();
    } catch (err: unknown) {
      setError((err as Error).message ?? "Failed to create TNI");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b p-6">
          <div>
            <h2 className="text-lg font-black text-slate-950">Create TNI</h2>
            <p className="text-sm text-slate-500">{employeeName}</p>
          </div>
          <button onClick={onClose} className="cursor-pointer text-slate-400 hover:text-slate-700 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-4 p-6">
          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              {error}
            </div>
          )}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Need Type</label>
            <select
              value={form.need_type}
              onChange={(e) => setForm({ ...form, need_type: e.target.value })}
              className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400"
            >
              <option value="product_knowledge">Product Knowledge</option>
              <option value="soft_skills">Soft Skills</option>
              <option value="compliance">Compliance</option>
              <option value="technical">Technical</option>
              <option value="process">Process</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Linked KPI Metric</label>
            <select
              value={form.metric_id}
              onChange={(e) => setForm({ ...form, metric_id: e.target.value })}
              className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400"
            >
              <option value="">None</option>
              {metrics.map((m) => (
                <option key={m.id} value={m.id}>{m.metric_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Priority</label>
            <select
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value })}
              className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3}
              placeholder="Describe the training need…"
              className="w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:border-blue-400 resize-none transition-colors"
            />
          </div>
        </div>
        <div className="flex gap-3 border-t p-6">
          <button
            onClick={onClose}
            className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="flex-1 cursor-pointer rounded-2xl bg-amber-600 py-3 text-sm font-bold text-white hover:bg-amber-700 transition-colors disabled:opacity-50"
          >
            {saving ? "Creating…" : "Create TNI"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const OPS_DISPLAY_CODES = ["AHT", "ADHERENCE", "SHRINKAGE", "FCR", "OCCUPANCY"];

const TNI_THRESHOLD = 75;

export default function NativeOperationsKPI() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const [processes, setProcesses] = useState<Process[]>([]);
  const [selectedProcess, setSelectedProcess] = useState("");
  const [period, setPeriod] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });

  const [metrics, setMetrics] = useState<KpiMetric[]>([]);
  const [processConfig, setProcessConfig] = useState<ProcessConfig[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);

  const [tniTarget, setTniTarget] = useState<{ employee_id: string; full_name: string } | null>(null);
  const [createdTnis, setCreatedTnis] = useState<Set<string>>(new Set());

  // ─── Loaders ───────────────────────────────────────────────────────────────

  const loadProcesses = useCallback(async () => {
    try {
      const res = await hrmsApi.get<{ success: boolean; data: Process[] }>("/api/org/processes");
      setProcesses(res.data ?? []);
      if ((res.data ?? []).length > 0 && !selectedProcess) {
        setSelectedProcess((res.data ?? [])[0].id);
      }
    } catch {
      // Processes are optional — continue without them
    }
  }, [selectedProcess]);

  const loadData = useCallback(async () => {
    if (!period) return;
    setLoading(true);
    setMessage("");
    try {
      const metricsRes = await hrmsApi.get<{ data: KpiMetric[] }>(
        "/api/kpi/metrics?family=operations"
      );
      setMetrics(metricsRes.data ?? []);

      const leaderboardParams = new URLSearchParams({ period, family: "operations" });
      if (selectedProcess) leaderboardParams.set("process_id", selectedProcess);

      const lbRes = await hrmsApi.get<{ data: LeaderboardEntry[] }>(
        `/api/kpi/leaderboard?${leaderboardParams.toString()}`
      );
      setLeaderboard(lbRes.data ?? []);

      if (selectedProcess) {
        const cfgRes = await hrmsApi.get<{ success: boolean; data: ProcessConfig[] }>(
          `/api/kpi/process-config/${selectedProcess}`
        );
        const opsConfigs = (cfgRes.data ?? []).filter((c) => {
          const found = (metricsRes.data ?? []).find((m) => m.id === c.metric_id);
          return found?.family === "operations";
        });
        setProcessConfig(opsConfigs);
      } else {
        setProcessConfig([]);
      }
    } catch (err: unknown) {
      setMessage((err as Error).message ?? "Failed to load Operations KPI data");
    } finally {
      setLoading(false);
    }
  }, [period, selectedProcess]);

  useEffect(() => { void loadProcesses(); }, []);
  useEffect(() => { void loadData(); }, [loadData]);

  // ─── Derived ───────────────────────────────────────────────────────────────

  const displayMetrics = metrics.filter((m) => OPS_DISPLAY_CODES.includes(m.metric_code));

  const configMap = new Map<string, ProcessConfig>(
    processConfig.map((c) => [c.metric_code, c])
  );

  const flagged = leaderboard.filter((e) => e.weighted_score_pct < TNI_THRESHOLD);

  const avgScore =
    leaderboard.length > 0
      ? Math.round(leaderboard.reduce((s, e) => s + e.weighted_score_pct, 0) / leaderboard.length)
      : 0;

  const topPerformer = leaderboard[0] ?? null;

  const handleTniCreated = (tni: TniCreated) => {
    setCreatedTnis((prev) => new Set(prev).add(tni.employee_id));
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">KPI</p>
          <h1 className="mt-2 text-3xl font-black text-slate-950">Operations KPI Dashboard</h1>
          <p className="mt-2 max-w-4xl text-slate-600">
            AHT, Adherence, Shrinkage, FCR and other operations metrics — scored by process managers and WFM.
          </p>
        </div>

        {message && (
          <div className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            {message}
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          {processes.length > 0 && (
            <div className="flex items-center gap-2">
              <label className="text-sm font-semibold text-slate-600">Process:</label>
              <select
                value={selectedProcess}
                onChange={(e) => setSelectedProcess(e.target.value)}
                className="rounded-xl border px-3 py-2 text-sm outline-none focus:border-blue-400 bg-white"
              >
                <option value="">All Processes</option>
                {processes.map((p) => (
                  <option key={p.id} value={p.id}>{p.process_name}</option>
                ))}
              </select>
            </div>
          )}
          <div className="flex items-center gap-2">
            <label className="text-sm font-semibold text-slate-600">Period:</label>
            <input
              type="month"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="rounded-xl border px-3 py-2 text-sm outline-none focus:border-blue-400"
            />
          </div>
          <div className="flex-1" />
          <button
            onClick={() => void loadData()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {/* Summary stat cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Employees Scored"
            value={leaderboard.length}
            sub={`Period: ${period}`}
            icon={<Users className="h-5 w-5" />}
            tone="bg-blue-50 text-blue-700"
          />
          <StatCard
            title="Avg Ops Score"
            value={`${avgScore}%`}
            sub="Weighted across metrics"
            icon={<Trophy className="h-5 w-5" />}
            tone="bg-amber-50 text-amber-700"
          />
          <StatCard
            title="Top Performer"
            value={topPerformer ? topPerformer.full_name.split(" ")[0] : "—"}
            sub={topPerformer ? `${topPerformer.weighted_score_pct}%` : undefined}
            icon={<CheckCircle2 className="h-5 w-5" />}
            tone="bg-emerald-50 text-emerald-700"
          />
          <StatCard
            title="Flagged for TNI"
            value={flagged.length}
            sub={`Below ${TNI_THRESHOLD}% threshold`}
            icon={<AlertTriangle className="h-5 w-5" />}
            tone="bg-red-50 text-red-700"
          />
        </div>

        {/* Process summary bar — per-metric averages vs targets */}
        {processConfig.length > 0 && (
          <div className="rounded-3xl border bg-white p-6 shadow-sm">
            <h2 className="mb-4 font-black text-slate-950">Process Metric Targets</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {processConfig.map((cfg) => {
                const metric = metrics.find((m) => m.id === cfg.metric_id);
                return (
                  <div key={cfg.metric_id} className="rounded-2xl border bg-slate-50 p-4">
                    <p className="text-xs font-black uppercase tracking-wider text-slate-400 mb-1">
                      {cfg.metric_code}
                    </p>
                    <p className="font-bold text-slate-800">{cfg.metric_name}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-xs text-slate-500">Target:</span>
                      <span className="text-sm font-bold text-blue-700">
                        {formatMetricValue(cfg.target_value, cfg.unit, cfg.metric_code)}
                      </span>
                    </div>
                    {cfg.min_threshold !== null && (
                      <div className="mt-1 flex items-center gap-2">
                        <span className="text-xs text-slate-500">Min threshold:</span>
                        <span className="text-sm font-semibold text-slate-600">
                          {formatMetricValue(cfg.min_threshold, cfg.unit, cfg.metric_code)}
                        </span>
                      </div>
                    )}
                    {metric && (
                      <p className="mt-1 text-xs text-slate-400 capitalize">
                        {metric.direction.replace(/_/g, " ")}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Key Metrics Display — AHT / Adherence / Shrinkage / FCR / Occupancy */}
        {displayMetrics.length > 0 && (
          <div className="rounded-3xl border bg-white p-6 shadow-sm">
            <h2 className="mb-4 font-black text-slate-950">Key Operations Metrics</h2>
            <div className="flex flex-wrap gap-3">
              {displayMetrics.map((m) => {
                const cfg = configMap.get(m.metric_code);
                return (
                  <div
                    key={m.id}
                    className="flex items-center gap-3 rounded-2xl border bg-slate-50 px-5 py-3"
                  >
                    <Clock className="h-4 w-4 text-blue-500 flex-shrink-0" />
                    <div>
                      <p className="text-xs font-black uppercase tracking-wider text-slate-400">{m.metric_code}</p>
                      <p className="text-sm font-bold text-slate-800">{m.metric_name}</p>
                      {cfg && (
                        <p className="text-xs text-slate-500">
                          Target: {formatMetricValue(cfg.target_value, cfg.unit, m.metric_code)}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Team Leaderboard Table */}
        <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
          <div className="border-b p-5">
            <h2 className="font-black text-slate-950">Team Operations Leaderboard</h2>
            <p className="text-sm text-slate-500">
              {leaderboard.length} employee(s) scored — {period}
            </p>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader className="h-8 w-8 animate-spin text-slate-400" />
            </div>
          ) : leaderboard.length === 0 ? (
            <div className="py-16 text-center text-slate-400">
              <Trophy className="mx-auto mb-3 h-10 w-10 opacity-30" />
              <p className="font-semibold">No operations KPI scores found for this period.</p>
              <p className="mt-1 text-sm">
                Select a different period or record scores via the KPI scoring module.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="p-4 font-semibold">Rank</th>
                    <th className="p-4 font-semibold">Employee</th>
                    <th className="p-4 font-semibold">Ops Score</th>
                    <th className="p-4 font-semibold">Rating</th>
                    <th className="p-4 font-semibold">vs Target</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map((entry, idx) => (
                    <tr key={entry.employee_id} className="border-t hover:bg-slate-50/80 transition-colors">
                      <td className="p-4">
                        <span className="text-sm font-black text-slate-400">#{idx + 1}</span>
                      </td>
                      <td className="p-4">
                        <div className="font-bold text-slate-950">{entry.full_name}</div>
                        <div className="text-xs font-mono text-slate-500">{entry.employee_code}</div>
                      </td>
                      <td className="p-4">
                        <span className={scoreColor(entry.weighted_score_pct)}>
                          {entry.weighted_score_pct.toFixed(1)}%
                        </span>
                      </td>
                      <td className="p-4">
                        <span className={`rounded-full px-3 py-1 text-xs font-bold ${scoreBadge(entry.weighted_score_pct)}`}>
                          {entry.rating}
                        </span>
                      </td>
                      <td className="p-4">
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          entry.weighted_score_pct >= 90
                            ? "bg-emerald-50 text-emerald-700"
                            : entry.weighted_score_pct >= 75
                            ? "bg-amber-50 text-amber-700"
                            : "bg-red-50 text-red-700"
                        }`}>
                          {entry.weighted_score_pct >= 90
                            ? "On Target"
                            : entry.weighted_score_pct >= 75
                            ? "Near Target"
                            : "Below Target"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* TNI Section — employees below threshold */}
        <div className="overflow-hidden rounded-3xl border bg-white shadow-sm">
          <div className="border-b p-5">
            <div className="flex items-center gap-3">
              <BookOpen className="h-5 w-5 text-amber-600" />
              <div>
                <h2 className="font-black text-slate-950">Training Needs (TNI)</h2>
                <p className="text-sm text-slate-500">
                  Employees with Operations KPI below {TNI_THRESHOLD}% — {flagged.length} flagged
                </p>
              </div>
            </div>
          </div>

          {flagged.length === 0 ? (
            <div className="py-10 text-center text-slate-400">
              <CheckCircle2 className="mx-auto mb-3 h-9 w-9 text-emerald-400 opacity-80" />
              <p className="font-semibold text-emerald-700">
                All employees are above the {TNI_THRESHOLD}% threshold.
              </p>
            </div>
          ) : (
            <div className="divide-y">
              {flagged.map((entry) => {
                const alreadyCreated = createdTnis.has(entry.employee_id);
                return (
                  <div
                    key={entry.employee_id}
                    className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-950">{entry.full_name}</span>
                        <span className="font-mono text-xs text-slate-400">{entry.employee_code}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <span className={`text-sm font-bold ${scoreColor(entry.weighted_score_pct)}`}>
                          {entry.weighted_score_pct.toFixed(1)}%
                        </span>
                        <span className="text-xs text-slate-500">
                          ({(TNI_THRESHOLD - entry.weighted_score_pct).toFixed(1)}% below threshold)
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 self-start sm:self-auto">
                      {alreadyCreated ? (
                        <span className="inline-flex items-center gap-1.5 rounded-2xl bg-emerald-50 px-4 py-2 text-xs font-bold text-emerald-700">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          TNI Created
                        </span>
                      ) : (
                        <button
                          onClick={() =>
                            setTniTarget({ employee_id: entry.employee_id, full_name: entry.full_name })
                          }
                          className="inline-flex cursor-pointer items-center gap-2 rounded-2xl bg-amber-600 px-4 py-2 text-xs font-bold text-white hover:bg-amber-700 transition-colors"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Create TNI
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* TNI Modal */}
      {tniTarget && (
        <TniModal
          employeeId={tniTarget.employee_id}
          employeeName={tniTarget.full_name}
          metrics={metrics}
          onClose={() => setTniTarget(null)}
          onCreated={handleTniCreated}
        />
      )}
    </DashboardLayout>
  );
}
