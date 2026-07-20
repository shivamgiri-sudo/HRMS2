import { useEffect, useRef, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart2,
  CalendarDays,
  ChevronDown,
  Loader,
  Phone,
  PhoneIncoming,
  RefreshCcw,
  Target,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { AIInsightPanel } from "@/components/ai";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { InterventionPanel } from "@/components/dashboard/InterventionPanel";
import type { InterventionFlag } from "@/components/dashboard/InterventionPanel";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ManagementDashboard {
  headcount: number;
  attrition_rate: number;
  avg_kpi_score: number;
  open_tickets: number;
  pending_leaves: number;
  attendance_rate: number;
}

interface LiveEmployee {
  employee_id: string;
  employee_name: string;
  status: string;
  process?: string;
  team?: string;
}

interface LiveAttendance {
  total: number;
  logged_in: number;
  logged_out: number;
  absent: number;
  adherence_pct: number;
  employees: LiveEmployee[];
}

interface LiveTrackerApiResponse {
  success: boolean;
  data: {
    date: string;
    sessions: LiveEmployee[];
    summary: {
      total: number;
      logged_in: number;
      logged_out: number;
      absent: number;
      overall_adherence_pct: number;
    };
  };
}

interface Process {
  id: string | number;
  name: string;
  process_name?: string;
}

interface CoverageData {
  required_hc: number;
  available_hc: number;
  coverage_pct: number;
  process_name?: string;
}

interface KpiEntry {
  rank: number;
  employee_id: string;
  employee_name: string;
  score: number;
  trend?: "up" | "down" | "flat";
}

interface KpiLeaderboard {
  data: KpiEntry[];
}

interface AttritionSummary {
  total_exits: number;
  voluntary: number;
  involuntary: number;
  rate_pct: number;
  by_reason?: Array<{ reason: string; count: number }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const today = () => new Date().toISOString().slice(0, 10);

const currentMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function safeNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeCoverageData(value: unknown): CoverageData {
  const outer = asRecord(value);
  const source = asRecord(outer.data ?? outer);
  return {
    required_hc: safeNumber(source.required_hc ?? source.required_headcount),
    available_hc: safeNumber(source.available_hc ?? source.available_headcount),
    coverage_pct: safeNumber(source.coverage_pct),
    process_name: typeof source.process_name === "string" ? source.process_name : undefined,
  };
}

function normalizeKpiEntries(value: unknown): KpiEntry[] {
  const outer = asRecord(value);
  const rows = Array.isArray(value) ? value : Array.isArray(outer.data) ? outer.data : [];
  return rows.map((item, index) => {
    const row = asRecord(item);
    return {
      rank: safeNumber(row.rank) || index + 1,
      employee_id: String(row.employee_id ?? row.employee_code ?? index),
      employee_name: String(row.employee_name ?? row.full_name ?? row.employee_code ?? "Employee"),
      score: safeNumber(row.score ?? row.weighted_score_pct),
      trend: row.trend === "up" || row.trend === "down" || row.trend === "flat"
        ? row.trend
        : undefined,
    };
  });
}

function normalizeAttritionSummary(value: unknown): AttritionSummary {
  const source = asRecord(value);
  return {
    total_exits: safeNumber(source.total_exits),
    voluntary: safeNumber(source.voluntary),
    involuntary: safeNumber(source.involuntary),
    rate_pct: safeNumber(source.rate_pct ?? source.attrition_rate),
    by_reason: Array.isArray(source.by_reason)
      ? source.by_reason.map((item) => {
          const row = asRecord(item);
          return {
            reason: String(row.reason ?? "Unspecified"),
            count: safeNumber(row.count),
          };
        })
      : [],
  };
}

function adherenceColor(pct: number): string {
  if (pct >= 90) return "bg-emerald-500";
  if (pct >= 70) return "bg-amber-400";
  return "bg-rose-500";
}

function adherenceTextColor(pct: number): string {
  if (pct >= 90) return "text-emerald-700";
  if (pct >= 70) return "text-amber-700";
  return "text-rose-700";
}

function coverageColor(pct: number): string {
  if (pct >= 90) return "bg-emerald-500";
  if (pct >= 70) return "bg-amber-400";
  return "bg-rose-500";
}

// ---------------------------------------------------------------------------
// Shared UI Components
// ---------------------------------------------------------------------------

interface StatCardProps {
  title: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  tone: string;
}

function StatCard({ title, value, sub, icon, tone }: StatCardProps) {
  return (
    <div className="rounded-3xl border bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-slate-500">{title}</p>
          <p className="mt-2 text-3xl font-black tracking-tight text-slate-950">{value}</p>
          {sub && <p className="mt-1 text-xs font-semibold text-slate-500">{sub}</p>}
        </div>
        <div className={`rounded-2xl p-3 ${tone}`}>{icon}</div>
      </div>
    </div>
  );
}

function SectionHeader({ label, title }: { label: string; title: string }) {
  return (
    <div>
      <p className="text-xs font-black uppercase tracking-[0.2em] text-blue-600">{label}</p>
      <h2 className="mt-1 text-xl font-black text-slate-950">{title}</h2>
    </div>
  );
}

function LoadingRow() {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader className="h-7 w-7 animate-spin text-slate-400" />
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-800">
      <AlertTriangle className="h-4 w-4 flex-shrink-0" />
      {message}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section 1 — Live Workforce Status
// ---------------------------------------------------------------------------

function LiveWorkforceSection() {
  const [data, setData] = useState<LiveAttendance | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await hrmsApi.get<LiveTrackerApiResponse>("/api/wfm/live");
      const summary = res?.data?.summary;
      if (summary) {
        setData({
          total: summary.total ?? 0,
          logged_in: summary.logged_in ?? 0,
          logged_out: summary.logged_out ?? 0,
          absent: summary.absent ?? 0,
          adherence_pct: summary.overall_adherence_pct ?? 0,
          employees: res.data.sessions ?? [],
        });
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to load live attendance");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    timerRef.current = setInterval(() => { void load(); }, 60_000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const adherence = data?.adherence_pct ?? 0;

  return (
    <div className="rounded-3xl border bg-white p-6 shadow-sm space-y-5">
      <div className="flex items-center justify-between gap-4">
        <SectionHeader label="Workforce Management" title="Live Workforce Status" />
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">Auto-refreshes every 60s</span>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors disabled:opacity-50 cursor-pointer"
          >
            <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      {loading && !data ? (
        <LoadingRow />
      ) : data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              title="Total Rostered"
              value={data.total}
              icon={<Users className="h-5 w-5" />}
              tone="bg-slate-100 text-slate-700"
            />
            <StatCard
              title="Logged In"
              value={data.logged_in}
              icon={<Activity className="h-5 w-5" />}
              tone="bg-emerald-50 text-emerald-700"
            />
            <StatCard
              title="Logged Out"
              value={data.logged_out}
              icon={<TrendingDown className="h-5 w-5" />}
              tone="bg-amber-50 text-amber-700"
            />
            <StatCard
              title="Absent"
              value={data.absent}
              icon={<AlertTriangle className="h-5 w-5" />}
              tone="bg-rose-50 text-rose-700"
            />
          </div>

          {/* Adherence bar */}
          <div className="rounded-2xl border bg-slate-50 p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-600">Schedule Adherence</span>
              <span className={`text-lg font-black ${adherenceTextColor(adherence)}`}>
                {adherence.toFixed(1)}%
              </span>
            </div>
            <div className="h-3 w-full rounded-full bg-slate-200">
              <div
                className={`h-3 rounded-full transition-all duration-500 ${adherenceColor(adherence)}`}
                style={{ width: `${Math.min(adherence, 100)}%` }}
              />
            </div>
            <div className="mt-2 flex gap-4 text-xs text-slate-500">
              <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-emerald-500" /> ≥90% Good</span>
              <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-amber-400" /> 70–89% Fair</span>
              <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-rose-500" /> &lt;70% At Risk</span>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section 2 — Process Coverage
// ---------------------------------------------------------------------------

function ProcessCoverageSection() {
  const [processes, setProcesses] = useState<Process[]>([]);
  const [selectedProcessId, setSelectedProcessId] = useState<string>("");
  const [coverageDate, setCoverageDate] = useState(today());
  const [coverage, setCoverage] = useState<CoverageData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    hrmsApi
      .get<Process[] | { data: Process[] }>("/api/processes")
      .then((res) => {
        const list = Array.isArray(res) ? res : (res as { data: Process[] }).data ?? [];
        setProcesses(list);
        if (list.length > 0) setSelectedProcessId(String(list[0].id));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedProcessId) return;
    setLoading(true);
    setError("");
    hrmsApi
      .get<CoverageData>(`/api/wfm-ext/coverage?date=${coverageDate}&process_id=${selectedProcessId}`)
      .then((res) => setCoverage(normalizeCoverageData(res)))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Unable to load coverage");
      })
      .finally(() => setLoading(false));
  }, [selectedProcessId, coverageDate]);

  const covPct = coverage?.coverage_pct ?? 0;

  return (
    <div className="rounded-3xl border bg-white p-6 shadow-sm space-y-5">
      <SectionHeader label="Workforce Planning" title="Process Coverage" />

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <select
            value={selectedProcessId}
            onChange={(e) => setSelectedProcessId(e.target.value)}
            className="h-11 rounded-2xl border bg-slate-50 pl-4 pr-10 text-sm font-semibold outline-none appearance-none min-w-[200px] cursor-pointer focus:border-blue-400 transition-colors"
          >
            {processes.map((p) => (
              <option key={p.id} value={String(p.id)}>
                {p.process_name ?? p.name}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        </div>
        <input
          type="date"
          value={coverageDate}
          onChange={(e) => setCoverageDate(e.target.value)}
          className="h-11 rounded-2xl border bg-slate-50 px-4 text-sm outline-none focus:border-blue-400 transition-colors"
        />
      </div>

      {error && <ErrorBanner message={error} />}

      {loading ? (
        <LoadingRow />
      ) : coverage ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border bg-slate-50 p-4 text-center">
            <p className="text-xs font-semibold text-slate-500 mb-1">Required HC</p>
            <p className="text-3xl font-black text-slate-950">{coverage.required_hc}</p>
          </div>
          <div className="rounded-2xl border bg-slate-50 p-4 text-center">
            <p className="text-xs font-semibold text-slate-500 mb-1">Available HC</p>
            <p className="text-3xl font-black text-slate-950">{coverage.available_hc}</p>
          </div>
          <div className="rounded-2xl border bg-slate-50 p-4 text-center">
            <p className="text-xs font-semibold text-slate-500 mb-1">Coverage</p>
            <p className={`text-3xl font-black ${covPct >= 90 ? "text-emerald-700" : covPct >= 70 ? "text-amber-700" : "text-rose-700"}`}>
              {covPct.toFixed(1)}%
            </p>
          </div>

          {/* Coverage bar spanning all 3 */}
          <div className="sm:col-span-3 rounded-2xl border bg-slate-50 p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-600">Coverage Progress</span>
              <span className="text-sm font-bold text-slate-700">
                {coverage.available_hc} / {coverage.required_hc} headcount
              </span>
            </div>
            <div className="h-3 w-full rounded-full bg-slate-200">
              <div
                className={`h-3 rounded-full transition-all duration-500 ${coverageColor(covPct)}`}
                style={{ width: `${Math.min(covPct, 100)}%` }}
              />
            </div>
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-500 text-center py-6">Select a process to view coverage.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section 3 — KPI Performance Leaderboard
// ---------------------------------------------------------------------------

function KpiLeaderboardSection() {
  const [period, setPeriod] = useState(currentMonth());
  const [entries, setEntries] = useState<KpiEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    const query = new URLSearchParams({ period, limit: "5" }).toString();
    hrmsApi
      .get<KpiLeaderboard | KpiEntry[]>(`/api/kpi/leaderboard?${query}`)
      .then((res) => {
        setEntries(normalizeKpiEntries(res).slice(0, 5));
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Unable to load leaderboard");
      })
      .finally(() => setLoading(false));
  }, [period]);

  return (
    <div className="rounded-3xl border bg-white p-6 shadow-sm space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <SectionHeader label="Performance" title="Top Performers" />
        <label className="flex items-center gap-2 text-xs font-bold text-slate-500">
          Score month
          <input
            type="month"
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
            className="h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700 outline-none focus:border-blue-400"
          />
        </label>
      </div>

      {error && <ErrorBanner message={error} />}

      {loading ? (
        <LoadingRow />
      ) : entries.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">No leaderboard data available.</p>
      ) : (
        <div className="space-y-2">
          {entries.map((e, i) => (
            <div key={e.employee_id ?? i} className="flex items-center gap-3 rounded-xl border bg-slate-50/60 px-4 py-2.5">
              <span className={`inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-black
                ${i === 0 ? "bg-amber-400 text-amber-900" : i === 1 ? "bg-slate-300 text-slate-800" : i === 2 ? "bg-orange-300 text-orange-900" : "bg-slate-100 text-slate-600"}`}>
                {e.rank ?? i + 1}
              </span>
              <span className="flex-1 text-sm font-semibold text-slate-900 truncate">{e.employee_name}</span>
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-16 rounded-full bg-slate-200">
                  <div className="h-1.5 rounded-full bg-blue-600" style={{ width: `${Math.min(e.score, 100)}%` }} />
                </div>
                <span className="text-sm font-black text-slate-900 w-10 text-right">{e.score.toFixed(1)}</span>
                {e.trend === "up" && <TrendingUp className="h-3.5 w-3.5 text-emerald-600 flex-shrink-0" />}
                {e.trend === "down" && <TrendingDown className="h-3.5 w-3.5 text-rose-600 flex-shrink-0" />}
              </div>
            </div>
          ))}
        </div>
      )}

      <Link
        to="/operations-kpi"
        className="flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:underline pt-1"
      >
        View full KPI leaderboard with process filters &amp; TNI <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section 4 — Attrition Trend
// ---------------------------------------------------------------------------

function AttritionSection() {
  const [month, setMonth] = useState(currentMonth());
  const [data, setData] = useState<AttritionSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    hrmsApi
      .get<AttritionSummary>(`/api/wfm-ext/attrition/summary?month=${month}`)
      .then((res) => setData(normalizeAttritionSummary(res)))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Unable to load attrition data");
      })
      .finally(() => setLoading(false));
  }, [month]);

  return (
    <div className="rounded-3xl border bg-white p-6 shadow-sm space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <SectionHeader label="People Analytics" title="Attrition Trend" />
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="h-11 rounded-2xl border bg-slate-50 px-4 text-sm outline-none focus:border-blue-400 transition-colors"
        />
      </div>

      {error && <ErrorBanner message={error} />}

      {loading ? (
        <LoadingRow />
      ) : data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              title="Total Exits"
              value={data.total_exits}
              icon={<Users className="h-5 w-5" />}
              tone="bg-slate-100 text-slate-700"
            />
            <StatCard
              title="Voluntary"
              value={data.voluntary}
              icon={<TrendingUp className="h-5 w-5" />}
              tone="bg-blue-50 text-blue-700"
            />
            <StatCard
              title="Involuntary"
              value={data.involuntary}
              icon={<TrendingDown className="h-5 w-5" />}
              tone="bg-rose-50 text-rose-700"
            />
            <StatCard
              title="Attrition Rate"
              value={`${data.rate_pct.toFixed(2)}%`}
              icon={<BarChart2 className="h-5 w-5" />}
              tone={data.rate_pct > 10 ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}
            />
          </div>

          {data.by_reason && data.by_reason.length > 0 && (
            <div className="rounded-2xl border overflow-hidden">
              <div className="bg-slate-50 px-5 py-3 text-xs font-black uppercase tracking-wider text-slate-500">
                Breakdown by Reason
              </div>
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-slate-500 border-t">
                  <tr>
                    <th className="p-4 font-semibold">Reason</th>
                    <th className="p-4 font-semibold">Count</th>
                    <th className="p-4 font-semibold">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {data.by_reason.map((r, i) => {
                    const share = data.total_exits
                      ? Math.round((r.count / data.total_exits) * 100)
                      : 0;
                    return (
                      <tr key={i} className="border-t hover:bg-slate-50/80 transition-colors">
                        <td className="p-4 font-semibold text-slate-800">{r.reason}</td>
                        <td className="p-4 font-black text-slate-950">{r.count}</td>
                        <td className="p-4">
                          <div className="flex items-center gap-3">
                            <div className="h-2 w-24 rounded-full bg-slate-100">
                              <div
                                className="h-2 rounded-full bg-slate-700"
                                style={{ width: `${share}%` }}
                              />
                            </div>
                            <span className="text-xs font-bold text-slate-600">{share}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <p className="py-8 text-center text-sm text-slate-500">No attrition data for this period.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section 5 — Inbound Project Performance (CEO/BH/PM only)
// ---------------------------------------------------------------------------

interface InboundProject {
  key: string;
  name: string;
  icon: string;
  color: string;
  offered: number;
  answered: number;
  abandoned: number;
  al: number;
  sl: number;
  acht: number;
  repeat_pct: number;
  login_count: number;
  fcr_pct: number | null;
  deficit: number;
  mandate: number;
  required: number;
}

function metricBadge(value: number, target: number, higher_is_better = true): string {
  const ok = higher_is_better ? value >= target : value <= target;
  const near = higher_is_better ? value >= target * 0.9 : value <= target * 1.1;
  if (ok) return "bg-emerald-100 text-emerald-800";
  if (near) return "bg-amber-100 text-amber-800";
  return "bg-rose-100 text-rose-800";
}

function InboundOpsSection() {
  const [projects, setProjects] = useState<InboundProject[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [countdown, setCountdown] = useState(120);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const todayStr = new Date().toISOString().slice(0, 10);
      const res = await hrmsApi.get<{ success: boolean; data: InboundProject[] }>(
        `/api/quality-dashboard/inbound-ops/summary?from=${todayStr}&to=${todayStr}`
      );
      const data = Array.isArray(res) ? res : (res as any)?.data ?? [];
      setProjects(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to load inbound ops data");
    } finally {
      setLoading(false);
      setCountdown(120);
    }
  };

  useEffect(() => {
    void load();
    intervalRef.current = setInterval(() => { void load(); }, 120_000);
    countdownRef.current = setInterval(() => { setCountdown(c => Math.max(0, c - 1)); }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  const totals = useMemo(() => {
    const t = { offered: 0, answered: 0, abandoned: 0 };
    for (const p of projects) {
      t.offered += p.offered;
      t.answered += p.answered;
      t.abandoned += p.abandoned;
    }
    return t;
  }, [projects]);

  const avgAL = totals.offered > 0 ? Math.round(totals.answered * 10000 / totals.offered) / 100 : 0;
  const avgSL = projects.length > 0
    ? Math.round(projects.reduce((s, p) => s + p.sl, 0) * 100 / projects.length) / 100
    : 0;

  return (
    <div className="rounded-3xl border bg-white p-6 shadow-sm space-y-5">
      <div className="flex items-center justify-between gap-4">
        <SectionHeader label="Call Operations" title="Inbound Project Performance" />
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" /> Live
          </span>
          <span className="text-xs text-slate-400">Refresh in {countdown}s</span>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors disabled:opacity-50 cursor-pointer"
          >
            <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      {loading && projects.length === 0 ? (
        <LoadingRow />
      ) : projects.length > 0 ? (
        <>
          {/* KPI Summary Cards */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              title="Total Offered"
              value={totals.offered.toLocaleString()}
              sub="All projects today"
              icon={<Phone className="h-5 w-5" />}
              tone="bg-blue-50 text-blue-700"
            />
            <StatCard
              title="Total Answered"
              value={totals.answered.toLocaleString()}
              sub={`${totals.abandoned} abandoned`}
              icon={<PhoneIncoming className="h-5 w-5" />}
              tone="bg-emerald-50 text-emerald-700"
            />
            <StatCard
              title="Avg AL%"
              value={`${avgAL}%`}
              sub="Target: 95%"
              icon={<TrendingUp className="h-5 w-5" />}
              tone={avgAL >= 95 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}
            />
            <StatCard
              title="Avg SL%"
              value={`${avgSL}%`}
              sub="Target: 80%"
              icon={<Target className="h-5 w-5" />}
              tone={avgSL >= 80 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}
            />
          </div>

          {/* Project Performance Table */}
          <div className="overflow-x-auto rounded-2xl border">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="p-3 font-semibold">Project</th>
                  <th className="p-3 font-semibold text-right">Offered</th>
                  <th className="p-3 font-semibold text-right">Answered</th>
                  <th className="p-3 font-semibold text-right">AL%</th>
                  <th className="p-3 font-semibold text-right">SL%</th>
                  <th className="p-3 font-semibold text-right">ACHT</th>
                  <th className="p-3 font-semibold text-right">Repeat%</th>
                  <th className="p-3 font-semibold text-right">Login</th>
                  <th className="p-3 font-semibold text-right">Req'd</th>
                  <th className="p-3 font-semibold text-right">Deficit</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.key} className="border-t hover:bg-slate-50/80 transition-colors">
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block w-1 h-8 rounded-full"
                          style={{ backgroundColor: p.color }}
                        />
                        <span className="text-lg">{p.icon}</span>
                        <span className="font-semibold text-slate-800">{p.name}</span>
                      </div>
                    </td>
                    <td className="p-3 text-right font-bold text-slate-900">{p.offered}</td>
                    <td className="p-3 text-right font-bold text-slate-900">{p.answered}</td>
                    <td className="p-3 text-right">
                      <span className={`inline-block rounded-lg px-2 py-0.5 text-xs font-bold ${metricBadge(p.al, 95)}`}>
                        {p.al}%
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      <span className={`inline-block rounded-lg px-2 py-0.5 text-xs font-bold ${metricBadge(p.sl, 80)}`}>
                        {p.sl}%
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      <span className={`inline-block rounded-lg px-2 py-0.5 text-xs font-bold ${metricBadge(p.acht, 300, false)}`}>
                        {p.acht}s
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      <span className={`inline-block rounded-lg px-2 py-0.5 text-xs font-bold ${metricBadge(p.repeat_pct, 20, false)}`}>
                        {p.repeat_pct}%
                      </span>
                    </td>
                    <td className="p-3 text-right font-semibold text-slate-700">{p.login_count}</td>
                    <td className="p-3 text-right text-slate-600">{p.required}</td>
                    <td className="p-3 text-right">
                      <span className={`font-bold ${p.deficit > 0 ? "text-rose-600" : p.deficit < 0 ? "text-emerald-600" : "text-slate-500"}`}>
                        {p.deficit > 0 ? `−${p.deficit}` : p.deficit < 0 ? `+${Math.abs(p.deficit)}` : "0"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Agent Login vs Mandate Mini Cards */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
            {projects.map((p) => {
              const fillPct = p.required > 0 ? Math.min((p.login_count / p.required) * 100, 100) : 0;
              const fillColor = fillPct >= 90 ? "bg-emerald-500" : fillPct >= 70 ? "bg-amber-400" : "bg-rose-500";
              return (
                <div key={p.key} className="rounded-xl border p-3 space-y-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm">{p.icon}</span>
                    <span className="text-xs font-bold text-slate-700 truncate">{p.name}</span>
                  </div>
                  <div className="text-center">
                    <span className="text-lg font-black text-slate-900">{p.login_count}</span>
                    <span className="text-xs text-slate-400"> / {p.required}</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-slate-100">
                    <div className={`h-1.5 rounded-full transition-all ${fillColor}`} style={{ width: `${fillPct}%` }} />
                  </div>
                  <p className={`text-center text-xs font-bold ${p.deficit > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                    {p.deficit > 0 ? `${p.deficit} deficit` : p.deficit < 0 ? `${Math.abs(p.deficit)} surplus` : "On target"}
                  </p>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <p className="py-8 text-center text-sm text-slate-500">No inbound operations data available. Check dialer connection.</p>
      )}

      <Link
        to="/call-master/inbound"
        className="flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:underline pt-1"
      >
        Full inbound analytics — hourly trends &amp; per-project drill-down <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

function InboundOpsGated() {
  const { hasAnyRole } = useWorkforceAccess();
  const canView = hasAnyRole("super_admin", "ceo", "coo", "branch_head", "process_manager", "manager", "operations_manager");
  if (!canView) return null;
  return <InboundOpsSection />;
}

export default function NativeOperationsDashboard() {
  const [mgmt, setMgmt] = useState<ManagementDashboard | null>(null);
  const [mgmtLoading, setMgmtLoading] = useState(false);
  const [mgmtError, setMgmtError] = useState("");
  const [opsFlags, setOpsFlags] = useState<InterventionFlag[]>([]);
  const [slaAdherence, setSlaAdherence] = useState<number | null>(null);

  const loadMgmt = async () => {
    setMgmtLoading(true);
    setMgmtError("");
    try {
      const res = await hrmsApi.get<ManagementDashboard | { data: ManagementDashboard }>(
        "/api/management/dashboard"
      );
      if (!res) throw new Error("No response from server");
      const payload =
        res && "headcount" in res
          ? (res as ManagementDashboard)
          : (res as { data: ManagementDashboard }).data;
      setMgmt(payload);
    } catch (err: unknown) {
      setMgmtError(err instanceof Error ? err.message : "Unable to load management stats");
    } finally {
      setMgmtLoading(false);
    }
  };

  useEffect(() => {
    void loadMgmt();
    hrmsApi.get<{ success: boolean; data: { intervention_flags?: InterventionFlag[]; login_adherence_pct?: number } }>("/api/bi/daily-operations-pulse")
      .then((res) => {
        const d = (res as any)?.data;
        setOpsFlags(d?.intervention_flags ?? []);
        if (d?.login_adherence_pct != null) setSlaAdherence(Number(d.login_adherence_pct));
      })
      .catch(() => setOpsFlags([]));
  }, []);

  return (
    <DashboardLayout>
      <div className="space-y-8">
        {/* Page Header */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">
              Operations Command Center
            </p>
            <h1 className="mt-2 text-3xl font-black text-slate-950">Operations Dashboard</h1>
            <p className="mt-2 max-w-3xl text-slate-600">
              Real-time workforce visibility — live attendance, process coverage, KPI rankings, and attrition
              analytics in one place.
            </p>
          </div>
          <button
            onClick={() => void loadMgmt()}
            disabled={mgmtLoading}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors disabled:opacity-50 cursor-pointer"
          >
            <RefreshCcw className={`h-4 w-4 ${mgmtLoading ? "animate-spin" : ""}`} />
            Refresh Stats
          </button>
        </div>

        {mgmtError && <ErrorBanner message={mgmtError} />}

        {/* Header Stats Bar */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-7">
          <StatCard
            title="Headcount"
            value={mgmt?.headcount ?? "—"}
            icon={<Users className="h-5 w-5" />}
            tone="bg-slate-100 text-slate-700"
          />
          <StatCard
            title="Attendance Rate"
            value={mgmt ? `${mgmt.attendance_rate.toFixed(1)}%` : "—"}
            icon={<Activity className="h-5 w-5" />}
            tone="bg-emerald-50 text-emerald-700"
          />
          <StatCard
            title="Avg KPI Score"
            value={mgmt ? mgmt.avg_kpi_score.toFixed(1) : "—"}
            icon={<Target className="h-5 w-5" />}
            tone="bg-blue-50 text-blue-700"
          />
          <StatCard
            title="Open Tickets"
            value={mgmt?.open_tickets ?? "—"}
            icon={<AlertTriangle className="h-5 w-5" />}
            tone="bg-amber-50 text-amber-700"
          />
          <StatCard
            title="Pending Leaves"
            value={mgmt?.pending_leaves ?? "—"}
            icon={<CalendarDays className="h-5 w-5" />}
            tone="bg-violet-50 text-violet-700"
          />
          <StatCard
            title="Attrition Rate"
            value={mgmt ? `${mgmt.attrition_rate.toFixed(2)}%` : "—"}
            icon={<TrendingDown className="h-5 w-5" />}
            tone={
              mgmt && mgmt.attrition_rate > 10
                ? "bg-rose-50 text-rose-700"
                : "bg-slate-100 text-slate-700"
            }
          />
          <StatCard
            title="SLA Adherence"
            value={slaAdherence != null ? `${slaAdherence.toFixed(1)}%` : "—"}
            icon={<Target className="h-5 w-5" />}
            tone={
              slaAdherence != null && slaAdherence < 90
                ? "bg-amber-50 text-amber-700"
                : "bg-emerald-50 text-emerald-700"
            }
          />
        </div>

        {/* Operations Intervention Flags */}
        {opsFlags.length > 0 && (
          <InterventionPanel
            flags={opsFlags}
            title="Immediate Operations Actions"
            collapsible
          />
        )}

        {/* AI Operations Brief */}
        <AIInsightPanel
          contextType="wfm_roster"
          role="wfm"
          title="Operations AI Brief"
          enabled={mgmt !== null}
          data={{
            headcount: mgmt?.headcount,
            attendance_rate: mgmt?.attendance_rate,
            avg_kpi_score: mgmt?.avg_kpi_score,
            open_tickets: mgmt?.open_tickets,
            pending_leaves: mgmt?.pending_leaves,
            attrition_rate: mgmt?.attrition_rate,
          }}
        />

        {/* Section 1 */}
        <LiveWorkforceSection />

        {/* Section 2 */}
        <ProcessCoverageSection />

        {/* Section 5 — Inbound Project Performance (CEO/BH/PM/Ops Manager) */}
        <InboundOpsGated />

        {/* Section 3 & 4 side-by-side on wide screens */}
        <div className="grid gap-6 xl:grid-cols-2">
          <KpiLeaderboardSection />
          <AttritionSection />
        </div>
      </div>
    </DashboardLayout>
  );
}
