import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  ScatterChart, Scatter, ZAxis, Cell, ReferenceLine,
} from "recharts";
import {
  Activity, AlertTriangle, ArrowDown, ArrowUp, BarChart2,
  Clock, DollarSign, Layers, RefreshCcw, Target, TrendingUp, Users,
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

// ─── Date Helpers ─────────────────────────────────────────────────────────────

const today = () => new Date().toISOString().slice(0, 10);
const firstOfMonth = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface PerfSummary {
  total_agents: number; avg_calls_per_agent: number; avg_quality: number;
  avg_shrinkage: number; avg_conversion_rate: number; total_sales: number;
  calls_per_hour_avg: number; scope_label?: string;
}
interface AgentMatrixRow {
  agent_code: string; total_calls: number; avg_aht_seconds: number;
  shrinkage_pct: number; avg_quality: number; sales_done: number;
  conversion_pct: number; calls_per_hour: number; performance_score: number;
}
interface AprTrendPoint { date: string; avg_calls: number; avg_aht_seconds: number; avg_shrinkage: number; }
interface AuditTrendPoint { date: string; avg_quality: number; }
interface SalesTrendPoint { date: string; sales_count: number; conversion_pct: number; }
interface TrendData { apr_trend: AprTrendPoint[]; audit_trend: AuditTrendPoint[]; sales_trend: SalesTrendPoint[]; }
interface ProcessRow {
  process: string; agent_count: number; avg_calls: number; avg_aht_seconds: number;
  avg_shrinkage: number; avg_quality: number; avg_conversion: number; overall_score: number;
}
interface UtilizationRow {
  agent_code: string; login_hours: number; net_login_hours: number; utilization_pct: number;
  calls_per_hour: number; bio_mins: number; lunch_mins: number; qa_mins: number; training_mins: number;
}
interface ScatterPoint { x: number; y: number; z: number; label: string; fill: string; }

// ─── Tab Type ─────────────────────────────────────────────────────────────────

type TabId = "overview" | "matrix" | "process" | "utilization" | "correlation";

// ─── Micro Components ─────────────────────────────────────────────────────────

function Spinner({ size = "md" }: { size?: "sm" | "md" }) {
  const sz = size === "sm" ? "h-5 w-5 border-2" : "h-8 w-8 border-4";
  return (
    <div className="flex items-center justify-center py-10">
      <div className={`animate-spin rounded-full border-slate-200 border-t-blue-600 ${sz}`} />
    </div>
  );
}

function ErrBanner({ msg }: { msg: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
      <AlertTriangle className="h-4 w-4 flex-shrink-0" /> {msg}
    </div>
  );
}

function ScorePill({ score }: { score: number }) {
  const cls =
    score >= 80 ? "bg-emerald-100 text-emerald-700 border-emerald-200" :
    score >= 70 ? "bg-yellow-100 text-yellow-700 border-yellow-200" :
    score >= 60 ? "bg-orange-100 text-orange-700 border-orange-200" :
                  "bg-red-100 text-red-700 border-red-200";
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold ${cls}`}>{score}%</span>;
}

function AnimatedNumber({ target, suffix = "" }: { target: number; suffix?: string }) {
  const [val, setVal] = useState(0);
  const frame = useRef<number | null>(null);
  useEffect(() => {
    const start = performance.now();
    const duration = 800;
    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setVal(Math.round(eased * target));
      if (progress < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => { if (frame.current) cancelAnimationFrame(frame.current); };
  }, [target]);
  return <>{val.toLocaleString()}{suffix}</>;
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

interface KpiProps {
  label: string; value: number | string; sub?: string; icon: React.ReactNode;
  tone: "blue" | "emerald" | "red" | "purple" | "orange" | "slate";
  trend?: number; animate?: boolean;
}

const TONE_MAP = {
  blue:    { bg: "bg-blue-50",    icon: "bg-blue-100 text-blue-600",       val: "text-blue-700" },
  emerald: { bg: "bg-emerald-50", icon: "bg-emerald-100 text-emerald-600", val: "text-emerald-700" },
  red:     { bg: "bg-red-50",     icon: "bg-red-100 text-red-600",         val: "text-red-700" },
  purple:  { bg: "bg-purple-50",  icon: "bg-purple-100 text-purple-600",   val: "text-purple-700" },
  orange:  { bg: "bg-orange-50",  icon: "bg-orange-100 text-orange-600",   val: "text-orange-700" },
  slate:   { bg: "bg-slate-50",   icon: "bg-slate-100 text-slate-600",     val: "text-slate-900" },
};

function KpiCard({ label, value, sub, icon, tone, trend, animate }: KpiProps) {
  const t = TONE_MAP[tone];
  const numVal = typeof value === "number" ? value : parseFloat(String(value));
  return (
    <div className={`group relative overflow-hidden rounded-2xl border border-slate-200/80 ${t.bg} p-5 shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 cursor-default`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
          <p className={`mt-2 text-2xl font-black tracking-tight ${t.val}`}>
            {animate && typeof value === "number"
              ? <AnimatedNumber target={numVal} />
              : value}
          </p>
          {sub && <p className="mt-1 text-xs text-slate-400">{sub}</p>}
        </div>
        <div className={`flex-shrink-0 rounded-xl p-2.5 ${t.icon}`}>{icon}</div>
      </div>
      {trend !== undefined && (
        <div className={`mt-3 flex items-center gap-1 text-xs font-bold ${trend >= 0 ? "text-emerald-600" : "text-red-500"}`}>
          {trend >= 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
          {Math.abs(trend).toFixed(1)}% vs last period
        </div>
      )}
    </div>
  );
}

// ─── Custom Scatter Tooltip ───────────────────────────────────────────────────

function ScatterTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ScatterPoint }> }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload as ScatterPoint;
  if (!d) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-lg text-xs">
      <p className="font-bold text-slate-900">{d.label}</p>
      <p className="text-slate-600">Quality: <strong>{d.x}%</strong></p>
      <p className="text-slate-600">Conversion: <strong>{d.y}%</strong></p>
    </div>
  );
}

// ─── Tab Definitions ──────────────────────────────────────────────────────────

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "overview",     label: "Overview",          icon: <BarChart2 className="h-4 w-4" /> },
  { id: "matrix",       label: "Agent Matrix",      icon: <Users className="h-4 w-4" /> },
  { id: "process",      label: "Process Comparison",icon: <Layers className="h-4 w-4" /> },
  { id: "utilization",  label: "Utilization",       icon: <Clock className="h-4 w-4" /> },
  { id: "correlation",  label: "Quality vs Sales",  icon: <Target className="h-4 w-4" /> },
];

// ─── Main Component ───────────────────────────────────────────────────────────

export default function NativeAgentPerformanceDashboard() {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [refresh, setRefresh] = useState(0);
  const [sortField, setSortField] = useState<keyof AgentMatrixRow>("performance_score");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);

  const qs = `from=${from}&to=${to}`;
  const key = [from, to, refresh];

  const summaryQ = useQuery({
    queryKey: ["pd-summary", ...key],
    queryFn: () => hrmsApi.get<{ summary: PerfSummary }>(`/api/performance-dashboard/summary?${qs}`).then(r => r.summary),
  });
  const matrixQ = useQuery({
    queryKey: ["pd-matrix", ...key],
    queryFn: () => hrmsApi.get<{ matrix: AgentMatrixRow[] }>(`/api/performance-dashboard/agent-matrix?${qs}`).then(r => r.matrix),
    enabled: activeTab === "matrix" || activeTab === "correlation",
  });
  const trendQ = useQuery({
    queryKey: ["pd-trend", ...key],
    queryFn: () => hrmsApi.get<TrendData & { success: boolean }>(`/api/performance-dashboard/trend?${qs}`),
    enabled: activeTab === "overview",
  });
  const processQ = useQuery({
    queryKey: ["pd-process", ...key],
    queryFn: () => hrmsApi.get<{ processes: ProcessRow[] }>(`/api/performance-dashboard/process-comparison?${qs}`).then(r => r.processes),
    enabled: activeTab === "process",
  });
  const utilizQ = useQuery({
    queryKey: ["pd-utiliz", ...key],
    queryFn: () => hrmsApi.get<{ utilization: UtilizationRow[] }>(`/api/performance-dashboard/utilization?${qs}`).then(r => r.utilization),
    enabled: activeTab === "utilization",
  });

  // ─── Derived data ──────────────────────────────────────────────────────────

  const mergedTrend = useMemo(() => {
    if (!trendQ.data) return [];
    const map = new Map<string, Record<string, number>>();
    (trendQ.data.apr_trend ?? []).forEach(p => map.set(p.date, { avg_calls: p.avg_calls, avg_shrinkage: p.avg_shrinkage }));
    (trendQ.data.audit_trend ?? []).forEach(p => { const e = map.get(p.date) ?? {}; map.set(p.date, { ...e, avg_quality: p.avg_quality }); });
    (trendQ.data.sales_trend ?? []).forEach(p => { const e = map.get(p.date) ?? {}; map.set(p.date, { ...e, conversion_pct: p.conversion_pct }); });
    return Array.from(map.entries()).sort(([a], [b]) => a < b ? -1 : 1).map(([date, vals]) => ({ date, ...vals }));
  }, [trendQ.data]);

  const sortedMatrix = useMemo(() => {
    const data = [...(matrixQ.data ?? [])];
    data.sort((a, b) => sortDir === "desc" ? Number(b[sortField]) - Number(a[sortField]) : Number(a[sortField]) - Number(b[sortField]));
    return data;
  }, [matrixQ.data, sortField, sortDir]);

  const scatterData: ScatterPoint[] = useMemo(() => (matrixQ.data ?? []).map(a => ({
    x: a.avg_quality,
    y: a.conversion_pct,
    z: Math.max(a.total_calls, 1),
    label: a.agent_code,
    fill: a.avg_quality >= 75 && a.conversion_pct >= 5 ? "#10b981"
        : a.avg_quality >= 75 && a.conversion_pct < 5  ? "#3b82f6"
        : a.avg_quality < 75  && a.conversion_pct >= 5 ? "#ef4444"
        : "#94a3b8",
  })), [matrixQ.data]);

  // ─── Sort helper ──────────────────────────────────────────────────────────

  const handleSort = (field: keyof AgentMatrixRow) => {
    setSortDir(d => sortField === field && d === "desc" ? "asc" : "desc");
    setSortField(field);
  };

  const SortIcon = ({ field }: { field: keyof AgentMatrixRow }) => {
    if (sortField !== field) return null;
    return sortDir === "desc"
      ? <ArrowDown className="inline h-3 w-3 ml-1" />
      : <ArrowUp className="inline h-3 w-3 ml-1" />;
  };

  // ─── Filter Bar ───────────────────────────────────────────────────────────

  const FilterBar = (
    <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm backdrop-blur-sm">
      {([
        { label: "From", value: from, setter: setFrom },
        { label: "To",   value: to,   setter: setTo },
      ] as const).map(({ label, value, setter }) => (
        <div key={label} className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-slate-500">{label}</label>
          <input type="date" value={value} onChange={e => setter(e.target.value)}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-300 cursor-pointer" />
        </div>
      ))}
      <button onClick={() => setRefresh(r => r + 1)}
        className="ml-auto inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50">
        <RefreshCcw className="h-4 w-4" /> Refresh
      </button>
    </div>
  );

  // ─── Tab: Overview ────────────────────────────────────────────────────────

  const s = summaryQ.data;

  const OverviewTab = (
    <div className="space-y-5">
      {summaryQ.isLoading ? <Spinner /> : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <KpiCard label="Total Agents"     value={s?.total_agents ?? 0}         icon={<Users className="h-5 w-5" />}       tone="purple"  animate />
          <KpiCard label="Avg Calls/Agent"  value={s?.avg_calls_per_agent ?? 0}  icon={<BarChart2 className="h-5 w-5" />}   tone="blue"    animate />
          <KpiCard label="Avg Quality"      value={s ? `${s.avg_quality}%` : "–"} icon={<Target className="h-5 w-5" />}    tone="slate" />
          <KpiCard label="Avg Shrinkage"    value={s ? `${s.avg_shrinkage}%` : "–"} icon={<AlertTriangle className="h-5 w-5" />} tone="orange" />
          <KpiCard label="Avg Conversion"   value={s ? `${s.avg_conversion_rate}%` : "–"} icon={<TrendingUp className="h-5 w-5" />} tone="emerald" />
          <KpiCard label="Calls/Hour Avg"   value={s?.calls_per_hour_avg ?? 0}   icon={<Clock className="h-5 w-5" />}       tone="blue"    animate />
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4">
          <h2 className="font-black text-slate-900">Multi-Source Performance Trend</h2>
          <p className="text-xs text-slate-500">Calls · Quality · Shrinkage · Conversion over time</p>
        </div>
        {trendQ.isLoading ? <Spinner size="sm" /> : trendQ.isError ? <ErrBanner msg="Failed to load trend data" /> : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={mergedTrend} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Line yAxisId="left"  dataKey="avg_calls"      stroke="#22c55e" name="Avg Calls"      dot={false} strokeWidth={2} />
              <Line yAxisId="right" dataKey="avg_quality"    stroke="#3b82f6" name="Quality %"      dot={false} strokeWidth={2} />
              <Line yAxisId="right" dataKey="avg_shrinkage"  stroke="#f97316" name="Shrinkage %"    dot={false} strokeWidth={2} />
              <Line yAxisId="right" dataKey="conversion_pct" stroke="#10b981" name="Conversion %"   dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );

  // ─── Tab: Agent Matrix ────────────────────────────────────────────────────

  const matrixColumns: { label: string; field: keyof AgentMatrixRow; render?: (row: AgentMatrixRow) => React.ReactNode }[] = [
    { label: "Agent",      field: "agent_code",        render: r => <span className="font-semibold text-slate-800">{r.agent_code}</span> },
    { label: "Calls",      field: "total_calls",        render: r => r.total_calls },
    { label: "AHT (s)",    field: "avg_aht_seconds",    render: r => r.avg_aht_seconds },
    { label: "Shrinkage",  field: "shrinkage_pct",      render: r => <ScorePill score={100 - r.shrinkage_pct} /> },
    { label: "Quality",    field: "avg_quality",        render: r => <ScorePill score={r.avg_quality} /> },
    { label: "Sales",      field: "sales_done",         render: r => r.sales_done },
    { label: "Conversion", field: "conversion_pct",     render: r => `${r.conversion_pct}%` },
    { label: "CPH",        field: "calls_per_hour",     render: r => r.calls_per_hour },
    {
      label: "Score", field: "performance_score",
      render: r => (
        <div className="flex items-center gap-2">
          <div className="h-2 flex-1 rounded-full bg-slate-100">
            <div className="h-2 rounded-full transition-all"
              style={{
                width: `${Math.min(r.performance_score, 100)}%`,
                background: r.performance_score >= 80 ? "#10b981" : r.performance_score >= 60 ? "#f59e0b" : "#ef4444",
              }} />
          </div>
          <span className="text-xs font-bold w-8 text-right">{r.performance_score}</span>
        </div>
      ),
    },
  ];

  const MatrixTab = (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="font-black text-slate-900">Agent Performance Matrix</h2>
          <p className="text-xs text-slate-500">Click column headers to sort · Click a row to expand details</p>
        </div>
        {matrixQ.isLoading ? <Spinner size="sm" /> : matrixQ.isError ? <div className="p-4"><ErrBanner msg="Failed to load agent matrix" /></div> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
                <tr>
                  {matrixColumns.map(col => (
                    <th key={col.field}
                      onClick={() => handleSort(col.field)}
                      className="cursor-pointer px-4 py-3 font-semibold hover:text-slate-700 select-none whitespace-nowrap">
                      {col.label}<SortIcon field={col.field} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedMatrix.map(row => (
                  <>
                    <tr key={row.agent_code}
                      onClick={() => setExpandedAgent(expandedAgent === row.agent_code ? null : row.agent_code)}
                      className="border-t border-slate-50 cursor-pointer transition-colors hover:bg-blue-50/40">
                      {matrixColumns.map(col => (
                        <td key={col.field} className="px-4 py-3">
                          {col.render ? col.render(row) : String(row[col.field])}
                        </td>
                      ))}
                    </tr>
                    {expandedAgent === row.agent_code && (
                      <tr key={`${row.agent_code}-expand`} className="border-t border-blue-100 bg-blue-50/30">
                        <td colSpan={matrixColumns.length} className="px-5 py-4">
                          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
                            {[
                              { label: "Total Calls",    val: row.total_calls },
                              { label: "AHT (sec)",      val: row.avg_aht_seconds },
                              { label: "Shrinkage %",    val: `${row.shrinkage_pct}%` },
                              { label: "Quality",        val: `${row.avg_quality}%` },
                              { label: "Sales",          val: row.sales_done },
                              { label: "Conversion",     val: `${row.conversion_pct}%` },
                              { label: "Calls/Hour",     val: row.calls_per_hour },
                              { label: "Perf Score",     val: row.performance_score },
                            ].map(({ label, val }) => (
                              <div key={label} className="rounded-xl bg-white border border-slate-200 p-3 text-center shadow-sm">
                                <p className="text-[10px] font-semibold uppercase text-slate-500">{label}</p>
                                <p className="mt-1 text-base font-black text-slate-900">{val}</p>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );

  // ─── Tab: Process Comparison ──────────────────────────────────────────────

  const ProcessTab = (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 font-black text-slate-900">Process Performance Comparison</h2>
        {processQ.isLoading ? <Spinner size="sm" /> : processQ.isError ? <ErrBanner msg="Failed to load process data" /> : (
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={processQ.data ?? []} margin={{ top: 8, right: 16, left: 0, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="process" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" interval={0} />
              <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} />
              <Tooltip />
              <Legend />
              <Bar dataKey="avg_quality"    name="Quality %"    fill="#3b82f6" radius={[4, 4, 0, 0]} />
              <Bar dataKey="avg_shrinkage"  name="Shrinkage %"  fill="#f97316" radius={[4, 4, 0, 0]} />
              <Bar dataKey="avg_conversion" name="Conversion %"  fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {!processQ.isLoading && !processQ.isError && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="font-black text-slate-900">Process Summary Table</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
                <tr>
                  {["Process", "Agents", "Avg Calls", "AHT (s)", "Shrinkage", "Quality", "Conversion", "Overall Score"].map(h => (
                    <th key={h} className="px-4 py-3 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(processQ.data ?? []).map(row => (
                  <tr key={row.process} className="border-t border-slate-50 transition-colors hover:bg-slate-50/70">
                    <td className="px-4 py-3 font-semibold text-slate-800">{row.process}</td>
                    <td className="px-4 py-3 text-slate-500">{row.agent_count}</td>
                    <td className="px-4 py-3 text-slate-500">{row.avg_calls}</td>
                    <td className="px-4 py-3 text-slate-500 font-mono">{row.avg_aht_seconds}</td>
                    <td className="px-4 py-3 text-slate-500">{row.avg_shrinkage}%</td>
                    <td className="px-4 py-3"><ScorePill score={row.avg_quality} /></td>
                    <td className="px-4 py-3 text-slate-500">{row.avg_conversion}%</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 rounded-full bg-slate-100">
                          <div className="h-2 rounded-full transition-all"
                            style={{
                              width: `${Math.min(row.overall_score, 100)}%`,
                              background: row.overall_score >= 80 ? "#10b981" : row.overall_score >= 60 ? "#f59e0b" : "#ef4444",
                            }} />
                        </div>
                        <span className="text-xs font-bold w-8 text-right">{row.overall_score}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );

  // ─── Tab: Utilization ─────────────────────────────────────────────────────

  const utilizPieData = (utilizQ.data ?? []).slice(0, 10).map(r => {
    const total = r.bio_mins + r.lunch_mins + r.qa_mins + r.training_mins + 0.001;
    return {
      name: r.agent_code,
      bio: +(r.bio_mins / total * 100).toFixed(1),
      lunch: +(r.lunch_mins / total * 100).toFixed(1),
      qa: +(r.qa_mins / total * 100).toFixed(1),
      training: +(r.training_mins / total * 100).toFixed(1),
    };
  });

  const UtilizationTab = (
    <div className="space-y-5">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="font-black text-slate-900">Agent Utilization</h2>
          <p className="text-xs text-slate-500">Login hours, net hours, and utilization rate per agent</p>
        </div>
        {utilizQ.isLoading ? <Spinner size="sm" /> : utilizQ.isError ? <div className="p-4"><ErrBanner msg="Failed to load utilization data" /></div> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
                <tr>
                  {["Agent", "Login Hrs", "Net Login Hrs", "Utilization %", "Calls/Hour"].map(h => (
                    <th key={h} className="px-4 py-3 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(utilizQ.data ?? []).map(row => {
                  const utilCls = row.utilization_pct >= 80
                    ? "text-emerald-600 font-bold"
                    : row.utilization_pct >= 60
                    ? "text-yellow-600 font-bold"
                    : "text-red-600 font-bold";
                  return (
                    <tr key={row.agent_code} className="border-t border-slate-50 transition-colors hover:bg-slate-50/70">
                      <td className="px-4 py-3 font-semibold text-slate-800">{row.agent_code}</td>
                      <td className="px-4 py-3 text-slate-500">{row.login_hours}</td>
                      <td className="px-4 py-3 text-slate-500">{row.net_login_hours}</td>
                      <td className={`px-4 py-3 ${utilCls}`}>{row.utilization_pct}%</td>
                      <td className="px-4 py-3 text-slate-500">{row.calls_per_hour}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!utilizQ.isLoading && !utilizQ.isError && utilizPieData.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-1 font-black text-slate-900">Time Allocation — Top 10 Agents</h2>
          <p className="mb-4 text-xs text-slate-500">Stacked breakdown of non-productive time as % of total offline minutes</p>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={utilizPieData} layout="vertical" margin={{ top: 0, right: 24, left: 80, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} unit="%" domain={[0, 100]} />
              <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} tickLine={false} width={80} />
              <Tooltip formatter={(v: number) => [`${v}%`]} />
              <Legend />
              <Bar dataKey="bio"      name="Bio"      stackId="a" fill="#3b82f6" />
              <Bar dataKey="lunch"    name="Lunch"    stackId="a" fill="#f59e0b" />
              <Bar dataKey="qa"       name="QA"       stackId="a" fill="#8b5cf6" />
              <Bar dataKey="training" name="Training" stackId="a" fill="#10b981" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );

  // ─── Tab: Correlation ─────────────────────────────────────────────────────

  const CorrelationTab = (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-1 font-black text-slate-900">Quality vs Conversion Quadrant</h2>
      <p className="mb-4 text-xs text-slate-500">Each bubble = one agent. Size = call volume. Reference lines at 75% quality / 5% conversion.</p>
      <div className="mb-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        {[
          { color: "bg-emerald-500", label: "Top Performers (high quality + high sales)" },
          { color: "bg-blue-500",    label: "Coaching Opp (quality without sales)" },
          { color: "bg-red-500",     label: "Compliance Risk (sales without quality)" },
          { color: "bg-slate-400",   label: "Priority Training (low quality + low sales)" },
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-2">
            <div className={`h-3 w-3 flex-shrink-0 rounded-full ${color}`} />
            <span className="text-slate-600">{label}</span>
          </div>
        ))}
      </div>
      {matrixQ.isLoading ? <Spinner size="sm" /> : matrixQ.isError ? <ErrBanner msg="Failed to load matrix data" /> : (
        <ResponsiveContainer width="100%" height={360}>
          <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis type="number" dataKey="x" domain={[0, 100]} name="Quality" unit="%" tick={{ fontSize: 11 }}
              label={{ value: "Quality Score %", position: "insideBottom", offset: -10, fontSize: 11 }} />
            <YAxis type="number" dataKey="y" domain={[0, "auto"]} name="Conversion" unit="%" tick={{ fontSize: 11 }}
              label={{ value: "Conversion %", angle: -90, position: "insideLeft", fontSize: 11 }} />
            <ZAxis type="number" dataKey="z" range={[40, 400]} />
            <ReferenceLine x={75} stroke="#94a3b8" strokeDasharray="4 4" />
            <ReferenceLine y={5}  stroke="#94a3b8" strokeDasharray="4 4" />
            <Tooltip content={<ScatterTooltip />} />
            <Scatter data={scatterData} isAnimationActive={false}>
              {scatterData.map((d, i) => <Cell key={i} fill={d.fill} fillOpacity={0.8} />)}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      )}
    </div>
  );

  // ─── Tab Content Map ──────────────────────────────────────────────────────

  const TAB_CONTENT: Record<TabId, React.ReactNode> = {
    overview:    OverviewTab,
    matrix:      MatrixTab,
    process:     ProcessTab,
    utilization: UtilizationTab,
    correlation: CorrelationTab,
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <DashboardLayout>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-indigo-600">Performance Intelligence</p>
            <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-950">Agent Performance Dashboard</h1>
            <p className="mt-1 text-sm text-slate-500">Cross-source KPI: quality · productivity · sales — unified per-agent view</p>
          </div>
          {summaryQ.data?.scope_label && summaryQ.data.scope_label !== "All" && (
            <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
              <Layers className="h-4 w-4 text-amber-600" />
              <span className="text-xs font-bold text-amber-700">Scoped: {summaryQ.data.scope_label}</span>
            </div>
          )}
        </div>

        {/* Filter Bar */}
        {FilterBar}

        {summaryQ.isError && <ErrBanner msg={String(summaryQ.error)} />}

        {/* Tabs */}
        <div className="flex gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-slate-50 p-1 no-scrollbar">
          {TABS.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-bold transition-all ${
                activeTab === tab.id
                  ? "bg-white text-indigo-700 shadow-sm ring-1 ring-slate-200"
                  : "text-slate-500 hover:text-slate-700"
              }`}>
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {TAB_CONTENT[activeTab]}
      </div>
    </DashboardLayout>
  );
}
