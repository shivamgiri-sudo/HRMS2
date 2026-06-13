import { useEffect, useState } from "react";
import { ChevronRight, X, Loader, Search, Activity } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import type { TeamMember } from "@/pages/Performance";

// ─── Types ────────────────────────────────────────────────────────────────────

type Period = "day" | "wtd" | "mtd" | "past_month";

interface TrendPoint {
  date: string;
  value: number;
  source: string;
}

interface KpiMetricResult {
  metric_id: string;
  metric_code: string;
  metric_name: string;
  category: string;
  unit: string;
  direction: string;
  family: string;
  target_value: number;
  min_threshold: number | null;
  actual_value: number | null;
  score_pct: number;
  score_status: string;
  rating: string | null;
  rating_color: string | null;
  resolved_from: string;
  trend_data: TrendPoint[];
}

interface MemberPerf {
  employee_id: string;
  employee_code: string;
  full_name: string;
  process_name: string | null;
  overall_score: number;
  overall_rating: string | null;
  overall_rating_color: string | null;
  metrics: KpiMetricResult[];
  date_range: { start: string; end: string };
}

interface TeamSummary {
  period: Period;
  date_range: { start: string; end: string };
  team_size: number;
  team_avg_score: number;
  team_rating: string | null;
  score_distribution: Record<string, number>;
  members_on_target: number;
  members_at_risk: number;
  per_metric_averages: {
    metric_code: string;
    metric_name: string;
    unit: string;
    direction: string;
    category: string;
    team_avg_actual: number;
    team_avg_score_pct: number;
    team_avg_rating: string;
    target_value: number;
    members_with_data: number;
  }[];
  members: MemberPerf[];
}

interface DrillData {
  period: Period;
  overall_score: number;
  overall_rating: string | null;
  metrics: KpiMetricResult[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PERIOD_LABELS: Record<Period, string> = {
  day: "Today",
  wtd: "This Week",
  mtd: "This Month",
  past_month: "Last Month",
};

const RATING_BG: Record<string, string> = {
  S: "bg-emerald-500",
  A: "bg-blue-500",
  B: "bg-amber-500",
  C: "bg-orange-500",
  D: "bg-red-500",
};

const RATING_LIGHT: Record<string, string> = {
  S: "bg-emerald-50 text-emerald-700",
  A: "bg-blue-50 text-blue-700",
  B: "bg-amber-50 text-amber-700",
  C: "bg-orange-50 text-orange-700",
  D: "bg-red-50 text-red-700",
};

const CATEGORY_COLORS: Record<string, string> = {
  operations: "bg-blue-100 text-blue-700",
  quality: "bg-green-100 text-green-700",
  hr: "bg-purple-100 text-purple-700",
  sales: "bg-orange-100 text-orange-700",
  custom: "bg-gray-100 text-gray-700",
};

// ─── Sparkline ────────────────────────────────────────────────────────────────

function Sparkline({ data, color }: { data: TrendPoint[]; color: string }) {
  if (!data.length) return <span className="text-xs text-gray-300">—</span>;
  const values = data.map(d => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = 80, h = 28;
  const pts = values.map((v, i) => {
    const x = (i / Math.max(values.length - 1, 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x},${y}`;
  });
  return (
    <svg width={w} height={h} className="overflow-visible inline-block">
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── KPI Card (for drill-down panel) ─────────────────────────────────────────

function KpiCard({ metric }: { metric: KpiMetricResult }) {
  const hasData = metric.actual_value !== null;
  const ratingBg = metric.rating ? RATING_BG[metric.rating] ?? "bg-gray-400" : "bg-gray-300";
  const sparkColor = metric.score_pct >= 90 ? "#10b981" : metric.score_pct >= 75 ? "#f59e0b" : "#ef4444";
  const barWidth = Math.min(metric.score_pct, 100);
  const barColor = metric.score_pct >= 90 ? "bg-emerald-500" : metric.score_pct >= 75 ? "bg-amber-500" : "bg-red-500";

  function fmt(v: number | null, unit: string): string {
    if (v === null) return "—";
    if (unit === "seconds") {
      const m = Math.floor(v / 60);
      const s = Math.round(v % 60);
      return m > 0 ? `${m}m ${s}s` : `${s}s`;
    }
    if (unit === "percent") return `${Math.round(v * 10) / 10}%`;
    return String(Math.round(v * 10) / 10);
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-medium text-gray-900 text-xs truncate">{metric.metric_name}</span>
            <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium capitalize ${CATEGORY_COLORS[metric.category] ?? "bg-gray-100 text-gray-700"}`} style={{ fontSize: "10px" }}>
              {metric.category}
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-0.5">{metric.metric_code}</p>
        </div>
        {metric.rating && (
          <span className={`${ratingBg} text-white text-xs font-bold w-7 h-7 flex items-center justify-center rounded-full flex-shrink-0`}>
            {metric.rating}
          </span>
        )}
      </div>
      <div className="flex items-end gap-2">
        <div>
          <div className="text-lg font-bold text-gray-900">{fmt(metric.actual_value, metric.unit)}</div>
          <div className="text-xs text-gray-400">Target: {fmt(metric.target_value, metric.unit)}</div>
        </div>
        <div className="flex-1 pb-0.5">
          <Sparkline data={metric.trend_data} color={hasData ? sparkColor : "#e5e7eb"} />
        </div>
      </div>
      {hasData && (
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-gray-400">Score</span>
            <span className="font-semibold text-gray-700">{Math.round(metric.score_pct)}%</span>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${barColor}`} style={{ width: `${barWidth}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Distribution Bar ─────────────────────────────────────────────────────────

function DistributionBar({ dist, total }: { dist: Record<string, number>; total: number }) {
  const bands = [
    { key: "S", color: "bg-emerald-500", label: "S" },
    { key: "A", color: "bg-blue-500", label: "A" },
    { key: "B", color: "bg-amber-500", label: "B" },
    { key: "C", color: "bg-orange-500", label: "C" },
    { key: "D", color: "bg-red-500", label: "D" },
  ];

  return (
    <div className="space-y-2">
      <div className="flex h-4 rounded-full overflow-hidden gap-px">
        {bands.map(b => {
          const count = dist[b.key] ?? 0;
          const pct = total > 0 ? (count / total) * 100 : 0;
          if (!pct) return null;
          return <div key={b.key} className={`${b.color} transition-all`} style={{ width: `${pct}%` }} title={`${b.label}: ${count}`} />;
        })}
        {(dist.no_data ?? 0) > 0 && (
          <div className="bg-gray-200" style={{ width: `${((dist.no_data ?? 0) / total) * 100}%` }} title={`No data: ${dist.no_data}`} />
        )}
      </div>
      <div className="flex gap-3 flex-wrap">
        {bands.map(b => (
          <span key={b.key} className="flex items-center gap-1 text-xs text-gray-600">
            <span className={`${b.color} inline-block w-2 h-2 rounded-full`} />
            {b.label}: {dist[b.key] ?? 0}
          </span>
        ))}
        {(dist.no_data ?? 0) > 0 && (
          <span className="flex items-center gap-1 text-xs text-gray-400">
            <span className="bg-gray-300 inline-block w-2 h-2 rounded-full" />
            No data: {dist.no_data}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface Props {
  teamMembers: TeamMember[];
}

export function TeamKpiView({ teamMembers }: Props) {
  const [period, setPeriod] = useState<Period>("mtd");
  const [summary, setSummary] = useState<TeamSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [processFilter, setProcessFilter] = useState("");

  // Drill-down
  const [drillEmployee, setDrillEmployee] = useState<MemberPerf | null>(null);
  const [drillPeriod, setDrillPeriod] = useState<Period>("mtd");
  const [drillData, setDrillData] = useState<DrillData | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);

  async function loadSummary(p: Period) {
    setLoading(true);
    setError(null);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: TeamSummary }>(`/kpi-master/team-summary?period=${p}`);
      setSummary(res.data ?? null);
    } catch (err: any) {
      setError(err?.message ?? "Failed to load team KPI data");
    } finally {
      setLoading(false);
    }
  }

  async function loadDrillDown(empId: string, p: Period) {
    setDrillLoading(true);
    try {
      const res = await hrmsApi.get<{ success: boolean; data: DrillData }>(`/kpi-master/live/${empId}?period=${p}`);
      setDrillData(res.data ?? null);
    } catch {
      setDrillData(null);
    } finally {
      setDrillLoading(false);
    }
  }

  useEffect(() => { loadSummary(period); }, [period]);

  function openDrill(member: MemberPerf) {
    setDrillEmployee(member);
    setDrillPeriod(period);
    setDrillData(null);
    loadDrillDown(member.employee_id, period);
  }

  function onDrillPeriodChange(p: Period) {
    setDrillPeriod(p);
    if (drillEmployee) loadDrillDown(drillEmployee.employee_id, p);
  }

  // Get unique processes from team
  const processes = Array.from(new Set(
    teamMembers.map(m => m.process_name).filter(Boolean) as string[]
  )).sort();

  // Filter members
  const filteredMembers = (summary?.members ?? []).filter(m => {
    const matchSearch = !search || m.full_name.toLowerCase().includes(search.toLowerCase());
    const matchProcess = !processFilter || m.process_name === processFilter;
    return matchSearch && matchProcess;
  });

  // Sort by score descending
  const sortedMembers = [...filteredMembers].sort((a, b) => (b.overall_score ?? 0) - (a.overall_score ?? 0));

  function fmtActual(v: number | null, unit: string) {
    if (v === null) return "—";
    if (unit === "seconds") return `${Math.round(v)}s`;
    if (unit === "percent") return `${Math.round(v * 10) / 10}%`;
    return String(Math.round(v * 10) / 10);
  }

  // Key metrics to show in table (first 2 by category: operations first, then quality)
  const keyMetrics = summary?.per_metric_averages
    .sort((a, b) => {
      const order: Record<string, number> = { operations: 0, quality: 1, hr: 2 };
      return (order[a.category] ?? 3) - (order[b.category] ?? 3);
    })
    .slice(0, 2) ?? [];

  return (
    <div className="space-y-5">
      {/* Period Tabs */}
      <div className="flex gap-2 flex-wrap">
        {(Object.entries(PERIOD_LABELS) as [Period, string][]).map(([p, label]) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              period === p
                ? "bg-indigo-600 text-white shadow-sm"
                : "bg-white text-gray-600 border border-gray-200 hover:border-indigo-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader className="animate-spin text-indigo-500" size={28} />
        </div>
      )}

      {!loading && error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}

      {!loading && !error && (!summary || summary.team_size === 0) && (
        <div className="text-center py-16 text-gray-400">
          <Activity size={40} className="mx-auto mb-3 opacity-40" />
          <p className="font-medium text-gray-500">No team members found</p>
          <p className="text-sm mt-1">Ensure your direct reports are linked via reporting_manager in employee records.</p>
        </div>
      )}

      {!loading && summary && summary.team_size > 0 && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Team Average */}
            <div className="bg-gradient-to-br from-indigo-600 to-indigo-700 rounded-2xl p-5 text-white">
              <p className="text-indigo-200 text-xs font-medium uppercase tracking-wide">Team Average</p>
              <div className="flex items-center gap-3 mt-2">
                <span className="text-4xl font-bold">{Math.round(summary.team_avg_score)}%</span>
                {summary.team_rating && (
                  <span className={`${RATING_BG[summary.team_rating] ?? "bg-gray-500"} text-white font-bold w-10 h-10 flex items-center justify-center rounded-full text-lg`}>
                    {summary.team_rating}
                  </span>
                )}
              </div>
              <p className="text-indigo-200 text-xs mt-1">{summary.team_size} team members · {PERIOD_LABELS[period]}</p>
            </div>

            {/* Distribution */}
            <div className="bg-white rounded-2xl border border-gray-200 p-5">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Score Distribution</p>
              <DistributionBar dist={summary.score_distribution} total={summary.team_size} />
            </div>

            {/* At Risk / On Target */}
            <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Performance Flags</p>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">On Target</span>
                <span className="bg-emerald-100 text-emerald-700 font-bold px-3 py-1 rounded-full text-sm">
                  {summary.members_on_target}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">At Risk</span>
                <span className="bg-red-100 text-red-700 font-bold px-3 py-1 rounded-full text-sm">
                  {summary.members_at_risk}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">No Data</span>
                <span className="bg-gray-100 text-gray-600 font-bold px-3 py-1 rounded-full text-sm">
                  {summary.score_distribution.no_data ?? 0}
                </span>
              </div>
            </div>
          </div>

          {/* Team Metric Averages */}
          {summary.per_metric_averages.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Team Metric Averages</p>
              <div className="flex gap-3 overflow-x-auto pb-2">
                {summary.per_metric_averages.map(m => (
                  <div key={m.metric_code} className="flex-shrink-0 bg-white border border-gray-200 rounded-xl p-3 min-w-[140px]">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-xs font-medium text-gray-700 truncate">{m.metric_name}</span>
                      <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${RATING_LIGHT[m.team_avg_rating] ?? "bg-gray-100 text-gray-600"}`}>
                        {m.team_avg_rating}
                      </span>
                    </div>
                    <div className="text-xl font-bold text-gray-900">
                      {fmtActual(m.team_avg_actual, m.unit)}
                    </div>
                    <div className="text-xs text-gray-400">Target: {fmtActual(m.target_value, m.unit)}</div>
                    <div className="mt-2 h-1 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${m.team_avg_score_pct >= 90 ? "bg-emerald-500" : m.team_avg_score_pct >= 75 ? "bg-amber-500" : "bg-red-500"}`}
                        style={{ width: `${Math.min(m.team_avg_score_pct, 100)}%` }}
                      />
                    </div>
                    <div className="text-xs text-gray-400 mt-1">{Math.round(m.team_avg_score_pct)}% · {m.members_with_data} members</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Individual Table */}
          <div>
            <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Individual Performance</p>
              <div className="flex gap-2">
                <div className="relative">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search name…"
                    className="pl-8 pr-3 py-1.5 border border-gray-200 rounded-lg text-sm w-44 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  />
                </div>
                {processes.length > 1 && (
                  <select
                    value={processFilter}
                    onChange={e => setProcessFilter(e.target.value)}
                    className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  >
                    <option value="">All Processes</option>
                    {processes.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                )}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Employee</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Process</th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-600">Score</th>
                    <th className="text-center px-4 py-3 font-semibold text-gray-600">Rating</th>
                    {keyMetrics.map(km => (
                      <th key={km.metric_code} className="text-right px-4 py-3 font-semibold text-gray-600">
                        {km.metric_name}
                      </th>
                    ))}
                    <th className="text-center px-4 py-3 font-semibold text-gray-600">Detail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {sortedMembers.length === 0 && (
                    <tr>
                      <td colSpan={6 + keyMetrics.length} className="text-center py-10 text-gray-400">No members match filters</td>
                    </tr>
                  )}
                  {sortedMembers.map(member => {
                    const isAtRisk = member.overall_rating === "D";
                    const isTopPerformer = member.overall_rating === "S";
                    return (
                      <tr
                        key={member.employee_id}
                        className={`hover:bg-gray-50 transition-colors relative ${
                          isAtRisk ? "border-l-2 border-l-red-400" : isTopPerformer ? "bg-emerald-50/30" : ""
                        }`}
                      >
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">{member.full_name}</div>
                          <div className="text-xs text-gray-400">{member.employee_code}</div>
                          {isAtRisk && (
                            <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-medium mt-0.5 inline-block">At Risk</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-600 text-sm">{member.process_name ?? "—"}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="font-bold text-gray-900">{Math.round(member.overall_score)}%</div>
                          <div className="w-16 h-1 bg-gray-100 rounded-full overflow-hidden ml-auto mt-1">
                            <div
                              className={`h-full rounded-full ${member.overall_score >= 90 ? "bg-emerald-500" : member.overall_score >= 75 ? "bg-amber-500" : "bg-red-400"}`}
                              style={{ width: `${Math.min(member.overall_score, 100)}%` }}
                            />
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {member.overall_rating ? (
                            <span className={`${RATING_BG[member.overall_rating] ?? "bg-gray-400"} text-white font-bold w-7 h-7 flex items-center justify-center rounded-full text-xs mx-auto`}>
                              {member.overall_rating}
                            </span>
                          ) : (
                            <span className="text-gray-300 text-xs">—</span>
                          )}
                        </td>
                        {keyMetrics.map(km => {
                          const m = member.metrics.find(x => x.metric_code === km.metric_code);
                          return (
                            <td key={km.metric_code} className="px-4 py-3 text-right text-sm font-mono text-gray-700">
                              {m?.actual_value !== null && m?.actual_value !== undefined
                                ? fmtActual(m.actual_value, m.unit)
                                : "—"}
                            </td>
                          );
                        })}
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => openDrill(member)}
                            className="text-indigo-500 hover:text-indigo-700 transition-colors"
                          >
                            <ChevronRight size={18} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Drill-down Slide-over Panel */}
      {drillEmployee && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/40" onClick={() => setDrillEmployee(null)} />
          <div className="w-full max-w-lg bg-white shadow-2xl flex flex-col overflow-hidden">
            {/* Panel Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 bg-indigo-600 text-white">
              <div>
                <h3 className="font-semibold text-lg">{drillEmployee.full_name}</h3>
                <p className="text-indigo-200 text-xs mt-0.5">{drillEmployee.process_name ?? "No process"} · {drillEmployee.employee_code}</p>
              </div>
              <button onClick={() => setDrillEmployee(null)} className="text-indigo-200 hover:text-white">
                <X size={20} />
              </button>
            </div>

            {/* Panel Period Tabs */}
            <div className="px-4 py-3 border-b border-gray-100 flex gap-2 overflow-x-auto">
              {(Object.entries(PERIOD_LABELS) as [Period, string][]).map(([p, label]) => (
                <button
                  key={p}
                  onClick={() => onDrillPeriodChange(p)}
                  className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    drillPeriod === p
                      ? "bg-indigo-600 text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Panel Score Banner */}
            {drillData && (
              <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center gap-3">
                <span className="text-2xl font-bold text-gray-900">{Math.round(drillData.overall_score)}%</span>
                {drillData.overall_rating && (
                  <span className={`${RATING_BG[drillData.overall_rating] ?? "bg-gray-400"} text-white font-bold w-9 h-9 flex items-center justify-center rounded-full`}>
                    {drillData.overall_rating}
                  </span>
                )}
                <span className="text-xs text-gray-400">{PERIOD_LABELS[drillPeriod]}</span>
              </div>
            )}

            {/* Panel KPI Cards */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {drillLoading && (
                <div className="flex items-center justify-center py-12">
                  <Loader className="animate-spin text-indigo-500" size={24} />
                </div>
              )}
              {!drillLoading && drillData && (drillData.metrics as KpiMetricResult[]).length === 0 && (
                <div className="text-center py-12 text-gray-400 text-sm">No KPIs assigned for this employee</div>
              )}
              {!drillLoading && drillData && (drillData.metrics as KpiMetricResult[]).map(m => (
                <KpiCard key={m.metric_id} metric={m} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
