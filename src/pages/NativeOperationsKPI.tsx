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
  TrendingUp,
  Activity,
  Target,
  Zap,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

// ─── Types ───────────────────────────────────────────────────────────────────

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

// ─── TNI Modal ──────────────────────────────────────────────────────────────

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
      <div className="w-full max-w-md rounded-[2rem] bg-white shadow-2xl shadow-slate-900/20">
        <div className="flex items-center justify-between border-b border-slate-100 p-6">
          <div>
            <h2 className="text-lg font-black text-slate-950">Create TNI</h2>
            <p className="text-sm text-slate-500">{employeeName}</p>
          </div>
          <button onClick={onClose} className="cursor-pointer text-slate-400 hover:text-slate-700 transition-colors rounded-full hover:bg-slate-100 p-1">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-4 p-6">
          {error && (
            <div className="flex items-center gap-2 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              {error}
            </div>
          )}
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1.5">Need Type</label>
            <select
              value={form.need_type}
              onChange={(e) => setForm({ ...form, need_type: e.target.value })}
              className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors bg-white"
            >
              <option value="product_knowledge">Product Knowledge</option>
              <option value="soft_skills">Soft Skills</option>
              <option value="compliance">Compliance</option>
              <option value="technical">Technical</option>
              <option value="process">Process</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1.5">Linked KPI Metric</label>
            <select
              value={form.metric_id}
              onChange={(e) => setForm({ ...form, metric_id: e.target.value })}
              className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors bg-white"
            >
              <option value="">None</option>
              {metrics.map((m) => (
                <option key={m.id} value={m.id}>{m.metric_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1.5">Priority</label>
            <select
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value })}
              className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-400 transition-colors bg-white"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1.5">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3}
              placeholder="Describe the training need…"
              className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-400 resize-none transition-colors"
            />
          </div>
        </div>
        <div className="flex gap-3 border-t border-slate-100 p-6">
          <button
            onClick={onClose}
            className="flex-1 cursor-pointer rounded-2xl border border-slate-200 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="flex-1 cursor-pointer rounded-2xl bg-gradient-to-r from-amber-500 to-orange-600 py-3 text-sm font-bold text-white hover:shadow-lg transition-all disabled:opacity-50"
          >
            {saving ? "Creating…" : "Create TNI"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

const OPS_DISPLAY_CODES = [
  "TALK_TIME",      // Talk Time - Average talk duration per call
  "NET_LOGIN",      // Net Login - Total logged-in time
  "DIALS",          // HD (Handling/Dials) - Total calls handled
  "TOTAL_CALLS",    // Total Calls - Total calls (inbound + outbound)
  "QUALITY_SCORE",  // Overall Quality Score - Call quality assessment
  "AHT",            // Average Handle Time
  "ADHERENCE",      // Schedule Adherence
  "SHRINKAGE",      // Workforce Shrinkage
  "FCR",            // First Call Resolution
  "OCCUPANCY"       // Agent Occupancy
];

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

  const loadProcesses = useCallback(async () => {
    try {
      const res = await hrmsApi.get<{ success: boolean; data: Process[] }>("/api/processes");
      setProcesses(res.data ?? []);
      if ((res.data ?? []).length > 0 && !selectedProcess) {
        setSelectedProcess((res.data ?? [])[0].id);
      }
    } catch {
      // Processes are optional
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

  return (
    <DashboardLayout>
      <main className="space-y-8 p-6 lg:p-8">
        {/* Hero */}
        <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-700 p-8 text-white shadow-2xl shadow-indigo-200/40">
          <div className="absolute -right-10 -top-10 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
          <div className="absolute -bottom-10 -left-10 h-48 w-48 rounded-full bg-pink-400/20 blur-2xl" />
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-white/20 px-3 py-1 text-xs font-semibold backdrop-blur-sm">
                <Target className="h-3.5 w-3.5" /> Operations
              </div>
              <h1 className="text-4xl font-black tracking-tight">Operations KPI Dashboard</h1>
              <p className="mt-2 max-w-2xl text-blue-100">
                AHT, Adherence, Shrinkage, FCR and other operations metrics — scored by process managers and WFM.
              </p>
            </div>
            <button
              onClick={() => void loadData()}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-2xl bg-white/20 px-4 py-2.5 text-sm font-bold text-white backdrop-blur-sm hover:bg-white/30 transition-all disabled:opacity-50"
            >
              <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </div>

        {message && (
          <div className="flex items-center gap-3 rounded-2xl bg-red-50 border border-red-100 p-4 text-sm font-bold text-red-800">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" /> {message}
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-4 rounded-2xl bg-white border border-slate-200 p-4 shadow-sm">
          {processes.length > 0 && (
            <div className="flex items-center gap-2">
              <label className="text-sm font-bold text-slate-700">Process:</label>
              <select
                value={selectedProcess}
                onChange={(e) => setSelectedProcess(e.target.value)}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 bg-white transition-colors"
              >
                <option value="">All Processes</option>
                {processes.map((p) => (
                  <option key={p.id} value={p.id}>{p.process_name}</option>
                ))}
              </select>
            </div>
          )}
          <div className="flex items-center gap-2">
            <label className="text-sm font-bold text-slate-700">Period:</label>
            <input
              type="month"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 transition-colors"
            />
          </div>
        </div>

        {/* Stat Cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Employees Scored"
            value={leaderboard.length}
            sub={`Period: ${period}`}
            icon={<Users className="h-5 w-5" />}
            color="from-blue-400 to-indigo-500"
          />
          <StatCard
            title="Avg Ops Score"
            value={`${avgScore}%`}
            sub="Weighted across metrics"
            icon={<Trophy className="h-5 w-5" />}
            color="from-amber-400 to-orange-500"
          />
          <StatCard
            title="Top Performer"
            value={topPerformer ? topPerformer.full_name.split(" ")[0] : "—"}
            sub={topPerformer ? `${topPerformer.weighted_score_pct}%` : undefined}
            icon={<CheckCircle2 className="h-5 w-5" />}
            color="from-emerald-400 to-teal-500"
          />
          <StatCard
            title="Flagged for TNI"
            value={flagged.length}
            sub={`Below ${TNI_THRESHOLD}% threshold`}
            icon={<AlertTriangle className="h-5 w-5" />}
            color="from-rose-400 to-pink-500"
          />
        </div>

        {/* Process Metric Targets */}
        {processConfig.length > 0 && (
          <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-lg shadow-slate-200/40">
            <h2 className="text-xl font-black text-slate-950 mb-4 flex items-center gap-2">
              <Target className="h-5 w-5 text-blue-600" /> Process Metric Targets
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {processConfig.map((cfg) => {
                const metric = metrics.find((m) => m.id === cfg.metric_id);
                return (
                  <div key={cfg.metric_id} className="rounded-2xl border border-slate-100 bg-slate-50 p-5 hover:shadow-md transition-all hover:-translate-y-0.5">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="h-2 w-2 rounded-full bg-blue-500" />
                      <p className="text-xs font-black uppercase tracking-wider text-slate-400">{cfg.metric_code}</p>
                    </div>
                    <p className="font-bold text-slate-900 text-lg">{cfg.metric_name}</p>
                    <div className="mt-3 flex items-center gap-2">
                      <span className="text-xs text-slate-500 font-medium">Target:</span>
                      <span className="text-sm font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-lg">
                        {formatMetricValue(cfg.target_value, cfg.unit, cfg.metric_code)}
                      </span>
                    </div>
                    {cfg.min_threshold !== null && (
                      <div className="mt-1 flex items-center gap-2">
                        <span className="text-xs text-slate-500 font-medium">Min threshold:</span>
                        <span className="text-sm font-semibold text-slate-600">
                          {formatMetricValue(cfg.min_threshold, cfg.unit, cfg.metric_code)}
                        </span>
                      </div>
                    )}
                    {metric && (
                      <p className="mt-2 text-xs text-slate-400 capitalize font-medium">
                        {metric.direction.replace(/_/g, " ")}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Key Operations Metrics */}
        {displayMetrics.length > 0 && (
          <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-lg shadow-slate-200/40">
            <h2 className="text-xl font-black text-slate-950 mb-4 flex items-center gap-2">
              <Activity className="h-5 w-5 text-violet-600" /> Key Operations Metrics
            </h2>
            <div className="flex flex-wrap gap-3">
              {displayMetrics.map((m) => {
                const cfg = configMap.get(m.metric_code);
                return (
                  <div
                    key={m.id}
                    className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50 px-5 py-3 hover:bg-blue-50 transition-colors"
                  >
                    <Clock className="h-4 w-4 text-blue-500 flex-shrink-0" />
                    <div>
                      <p className="text-xs font-black uppercase tracking-wider text-slate-400">{m.metric_code}</p>
                      <p className="text-sm font-bold text-slate-900">{m.metric_name}</p>
                      {cfg && (
                        <p className="text-xs text-slate-500 mt-0.5">
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

        {/* Leaderboard */}
        <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-lg shadow-slate-200/40">
          <div className="border-b border-slate-100 p-6">
            <h2 className="text-xl font-black text-slate-950 flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-blue-600" /> Team Operations Leaderboard
            </h2>
            <p className="text-sm text-slate-500 mt-1">
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
                    <th className="p-4 font-bold">Rank</th>
                    <th className="p-4 font-bold">Employee</th>
                    <th className="p-4 font-bold">Ops Score</th>
                    <th className="p-4 font-bold">Rating</th>
                    <th className="p-4 font-bold">vs Target</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map((entry, idx) => (
                    <tr key={entry.employee_id} className="border-t border-slate-100 hover:bg-slate-50/80 transition-colors">
                      <td className="p-4">
                        <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg text-xs font-black ${
                          idx === 0 ? "bg-amber-100 text-amber-700" :
                          idx === 1 ? "bg-slate-200 text-slate-700" :
                          idx === 2 ? "bg-orange-100 text-orange-700" :
                          "bg-slate-100 text-slate-500"
                        }`}>
                          #{idx + 1}
                        </span>
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
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : entry.weighted_score_pct >= 75
                            ? "bg-amber-50 text-amber-700 border border-amber-200"
                            : "bg-red-50 text-red-700 border border-red-200"
                        }`}>
                          {entry.weighted_score_pct >= 90 ? "On Target" : entry.weighted_score_pct >= 75 ? "Near Target" : "Below Target"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* TNI Section */}
        <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-lg shadow-slate-200/40">
          <div className="border-b border-slate-100 p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-100 text-amber-600">
                <BookOpen className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-xl font-black text-slate-950">Training Needs (TNI)</h2>
                <p className="text-sm text-slate-500">
                  Employees with Operations KPI below {TNI_THRESHOLD}% — {flagged.length} flagged
                </p>
              </div>
            </div>
          </div>

          {flagged.length === 0 ? (
            <div className="py-10 text-center text-slate-400">
              <CheckCircle2 className="mx-auto mb-3 h-9 w-9 text-emerald-400" />
              <p className="font-bold text-emerald-700">
                All employees are above the {TNI_THRESHOLD}% threshold.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {flagged.map((entry) => {
                const alreadyCreated = createdTnis.has(entry.employee_id);
                return (
                  <div
                    key={entry.employee_id}
                    className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center hover:bg-slate-50/50 transition-colors"
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
                        <span className="inline-flex items-center gap-1.5 rounded-2xl bg-emerald-50 px-4 py-2 text-xs font-bold text-emerald-700 border border-emerald-200">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          TNI Created
                        </span>
                      ) : (
                        <button
                          onClick={() =>
                            setTniTarget({ employee_id: entry.employee_id, full_name: entry.full_name })
                          }
                          className="inline-flex cursor-pointer items-center gap-2 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-600 px-4 py-2 text-xs font-bold text-white hover:shadow-lg transition-all"
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
      </main>

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

// ─── Stat Card ───────────────────────────────────────────────────────────────

function StatCard({
  title,
  value,
  sub,
  icon,
  color,
}: {
  title: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <div className="group relative overflow-hidden rounded-[2rem] border-0 bg-white p-5 shadow-lg shadow-slate-200/30 hover:shadow-xl hover:shadow-slate-300/40 transition-all duration-300 hover:-translate-y-1">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-bold text-slate-500">{title}</p>
          <p className="mt-2 text-3xl font-black tracking-tight text-slate-950">{value}</p>
          {sub && <p className="mt-1 text-xs font-semibold text-slate-400">{sub}</p>}
        </div>
        <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${color} text-white shadow-lg shadow-current/30 transition-transform duration-300 group-hover:scale-110`}>
          {icon}
        </div>
      </div>
    </div>
  );
}
