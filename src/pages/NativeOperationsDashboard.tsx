import { useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart2,
  CalendarDays,
  ChevronDown,
  Loader,
  RefreshCcw,
  Target,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

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
      .then(setCoverage)
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

type KpiPeriod = "monthly" | "quarterly" | "yearly";

function KpiLeaderboardSection() {
  const [period, setPeriod] = useState<KpiPeriod>("monthly");
  const [entries, setEntries] = useState<KpiEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const PERIODS: KpiPeriod[] = ["monthly", "quarterly", "yearly"];

  useEffect(() => {
    setLoading(true);
    setError("");
    hrmsApi
      .get<KpiLeaderboard | KpiEntry[]>(`/api/kpi/leaderboard?period=${period}`)
      .then((res) => {
        const list = Array.isArray(res) ? res : (res as KpiLeaderboard).data ?? [];
        setEntries(list.slice(0, 10));
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Unable to load leaderboard");
      })
      .finally(() => setLoading(false));
  }, [period]);

  return (
    <div className="rounded-3xl border bg-white p-6 shadow-sm space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <SectionHeader label="Performance" title="KPI Leaderboard" />
        <div className="flex rounded-2xl border bg-slate-50 p-1 gap-1">
          {PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`cursor-pointer rounded-xl px-4 py-1.5 text-xs font-bold capitalize transition-colors ${
                period === p ? "bg-slate-950 text-white shadow-sm" : "text-slate-600 hover:bg-slate-200"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      {loading ? (
        <LoadingRow />
      ) : entries.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">No leaderboard data available.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border">
          <table className="w-full min-w-[500px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="p-4 font-semibold">Rank</th>
                <th className="p-4 font-semibold">Employee</th>
                <th className="p-4 font-semibold">KPI Score</th>
                <th className="p-4 font-semibold">Trend</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={e.employee_id ?? i} className="border-t hover:bg-slate-50/80 transition-colors">
                  <td className="p-4">
                    <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-black
                      ${i === 0 ? "bg-amber-400 text-amber-900" : i === 1 ? "bg-slate-300 text-slate-800" : i === 2 ? "bg-orange-300 text-orange-900" : "bg-slate-100 text-slate-600"}`}>
                      {e.rank ?? i + 1}
                    </span>
                  </td>
                  <td className="p-4 font-semibold text-slate-950">{e.employee_name}</td>
                  <td className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="h-2 w-24 rounded-full bg-slate-100">
                        <div
                          className="h-2 rounded-full bg-blue-600"
                          style={{ width: `${Math.min(e.score, 100)}%` }}
                        />
                      </div>
                      <span className="font-black text-slate-950">{e.score.toFixed(1)}</span>
                    </div>
                  </td>
                  <td className="p-4">
                    {e.trend === "up" && <TrendingUp className="h-4 w-4 text-emerald-600" />}
                    {e.trend === "down" && <TrendingDown className="h-4 w-4 text-rose-600" />}
                    {(!e.trend || e.trend === "flat") && <span className="text-xs text-slate-400">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
      .then(setData)
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
// Main Page
// ---------------------------------------------------------------------------

export default function NativeOperationsDashboard() {
  const [mgmt, setMgmt] = useState<ManagementDashboard | null>(null);
  const [mgmtLoading, setMgmtLoading] = useState(false);
  const [mgmtError, setMgmtError] = useState("");

  const loadMgmt = async () => {
    setMgmtLoading(true);
    setMgmtError("");
    try {
      const res = await hrmsApi.get<ManagementDashboard | { data: ManagementDashboard }>(
        "/api/management/dashboard"
      );
      const payload =
        "headcount" in res
          ? (res as ManagementDashboard)
          : (res as { data: ManagementDashboard }).data;
      setMgmt(payload);
    } catch (err: unknown) {
      setMgmtError(err instanceof Error ? err.message : "Unable to load management stats");
    } finally {
      setMgmtLoading(false);
    }
  };

  useEffect(() => { void loadMgmt(); }, []);

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
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
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
        </div>

        {/* Section 1 */}
        <LiveWorkforceSection />

        {/* Section 2 */}
        <ProcessCoverageSection />

        {/* Section 3 & 4 side-by-side on wide screens */}
        <div className="grid gap-6 xl:grid-cols-2">
          <KpiLeaderboardSection />
          <AttritionSection />
        </div>
      </div>
    </DashboardLayout>
  );
}
