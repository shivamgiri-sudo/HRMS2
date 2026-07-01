import { useState, useEffect, useRef } from "react";
import { AIInsightPanel } from "@/components/ai";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from "recharts";
import {
  Shield, TrendingUp, TrendingDown, Users, AlertTriangle, Target,
  BarChart2, RefreshCcw, CheckCircle2, Zap, Brain, DollarSign,
  ChevronRight, X, Info, ArrowUp, ArrowDown, Clock, Activity,
  Layers,
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

interface Summary {
  total_calls: number; audited_calls: number; avg_quality_score: number;
  calls_above_80: number; calls_below_50: number; unique_agents: number;
  unique_clients: number; fraud_flags: number;
  fail_rate_call_open: number; fail_rate_professionalism: number;
  fail_rate_active_listening: number; fail_rate_call_closure: number;
  fail_rate_accuracy: number; scope_label?: string;
}
interface TrendPoint { date: string; total_calls: number; avg_score: number; above_80: number; below_50: number; }
interface AgentRow { agent_name: string; agent_code?: string; total_calls: number; avg_score: number; calls_above_80: number; calls_below_50: number; band: string; }
interface ClientRow { client_id: string; client_name?: string; total_calls: number; avg_score: number; agent_count: number; }
interface AprRow { process: string; process_code?: string; agents: number; avg_calls: number; avg_aht: number; avg_shrinkage_pct: number; avg_bio_mins: number; avg_lunch_mins: number; avg_qa_mins: number; avg_training_mins: number; }
interface SalesSummary { total_calls: number; sales_done: number; competitor_mentions: number; objection_calls: number; }
interface Competitor { CompetitorName: string; mentions: number; }
interface FraudSignals { data_theft: number; financial_fraud: number; collusion: number; escalation_failure: number; unprofessional: number; system_manipulation: number; }
interface SalesFunnel { total_calls: number; opening_done: number; offer_made: number; objection_handled: number; sale_done: number; }
interface RejectionFunnel { total_calls: number; not_interested: number; objection_raised: number; rejected_after_offer: number; offering_rejected: number; opening_rejected: number; }
interface RejectionReason { reason: string; count: number; }
interface HeatmapCell { score: number; calls: number; critical: number; }
interface AgentRisk {
  agent_name: string; agent_code?: string; total_calls: number; overall_avg: number; week_avg: number;
  yesterday_avg: number; volatility: number; critical_count: number; trend_delta: number;
  risk_status: string; recommended_action: string;
}
interface Insight { type: "success" | "warning" | "critical" | "opportunity"; title: string; message: string; metric?: number; action?: string; }
interface RoiProjection { improvement: number; label: string; current_quality: number; projected_quality: number; current_conversion: string; projected_conversion: string; additional_sales: number; additional_revenue: number; roi_multiple: string; }
interface RoiData { current_metrics: { quality: number; conversion: number; total_calls: number; total_sales: number }; projections: RoiProjection[]; }

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

// ─── Animated Counter ─────────────────────────────────────────────────────────

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
  blue:    { bg: "bg-blue-50",    icon: "bg-blue-100 text-blue-600",    val: "text-blue-700" },
  emerald: { bg: "bg-emerald-50", icon: "bg-emerald-100 text-emerald-600", val: "text-emerald-700" },
  red:     { bg: "bg-red-50",     icon: "bg-red-100 text-red-600",      val: "text-red-700" },
  purple:  { bg: "bg-purple-50",  icon: "bg-purple-100 text-purple-600", val: "text-purple-700" },
  orange:  { bg: "bg-orange-50",  icon: "bg-orange-100 text-orange-600", val: "text-orange-700" },
  slate:   { bg: "bg-slate-50",   icon: "bg-slate-100 text-slate-600",   val: "text-slate-900" },
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

// ─── Insight Card ─────────────────────────────────────────────────────────────

const INSIGHT_STYLES = {
  success:     { border: "border-emerald-200 bg-emerald-50", icon: <CheckCircle2 className="h-5 w-5 text-emerald-600" />, badge: "bg-emerald-100 text-emerald-700" },
  warning:     { border: "border-amber-200 bg-amber-50",     icon: <AlertTriangle className="h-5 w-5 text-amber-600" />, badge: "bg-amber-100 text-amber-700" },
  critical:    { border: "border-red-200 bg-red-50",         icon: <Zap className="h-5 w-5 text-red-600" />,            badge: "bg-red-100 text-red-700" },
  opportunity: { border: "border-blue-200 bg-blue-50",       icon: <TrendingUp className="h-5 w-5 text-blue-600" />,    badge: "bg-blue-100 text-blue-700" },
};

function InsightCard({ insight }: { insight: Insight }) {
  const style = INSIGHT_STYLES[insight.type];
  return (
    <div className={`rounded-xl border p-4 ${style.border}`}>
      <div className="flex gap-3">
        <div className="mt-0.5 flex-shrink-0">{style.icon}</div>
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2 flex-wrap">
            <p className="text-sm font-bold text-slate-900">{insight.title}</p>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${style.badge}`}>{insight.type}</span>
          </div>
          <p className="text-sm text-slate-600">{insight.message}</p>
          {insight.action && (
            <p className="mt-1.5 flex items-center gap-1 text-xs font-semibold text-slate-500">
              <ChevronRight className="h-3 w-3" />{insight.action}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Heatmap Component ────────────────────────────────────────────────────────

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

function QualityHeatmap({ data }: { data: Record<string, Record<number, HeatmapCell>> }) {
  const [tooltip, setTooltip] = useState<{ day: string; hour: number; cell: HeatmapCell } | null>(null);

  const getColor = (score: number | undefined) => {
    if (score === undefined) return "bg-slate-100";
    if (score >= 85) return "bg-emerald-500";
    if (score >= 75) return "bg-emerald-300";
    if (score >= 65) return "bg-yellow-300";
    if (score >= 55) return "bg-orange-300";
    return "bg-red-400";
  };

  return (
    <div className="relative overflow-x-auto">
      <div className="min-w-[680px]">
        {/* Hour labels */}
        <div className="mb-1 flex">
          <div className="w-24 flex-shrink-0" />
          {HOURS.filter(h => h % 2 === 0).map(h => (
            <div key={h} className="flex-1 text-center text-[10px] text-slate-400 font-medium">{h}h</div>
          ))}
        </div>
        {/* Grid */}
        {DAYS.map(day => (
          <div key={day} className="mb-0.5 flex items-center gap-0.5">
            <div className="w-24 flex-shrink-0 text-xs font-semibold text-slate-500 text-right pr-2">{day.slice(0, 3)}</div>
            {HOURS.map(hour => {
              const cell = data[day]?.[hour];
              return (
                <div
                  key={hour}
                  className={`relative flex-1 h-7 rounded cursor-pointer transition-transform hover:scale-110 hover:z-10 ${getColor(cell?.score)}`}
                  onMouseEnter={() => cell && setTooltip({ day, hour, cell })}
                  onMouseLeave={() => setTooltip(null)}
                />
              );
            })}
          </div>
        ))}
        {/* Legend */}
        <div className="mt-3 flex items-center gap-3 text-xs text-slate-500">
          <span>Quality:</span>
          {[
            { color: "bg-red-400", label: "<55%" },
            { color: "bg-orange-300", label: "55-64%" },
            { color: "bg-yellow-300", label: "65-74%" },
            { color: "bg-emerald-300", label: "75-84%" },
            { color: "bg-emerald-500", label: "≥85%" },
            { color: "bg-slate-100", label: "No data" },
          ].map(({ color, label }) => (
            <div key={label} className="flex items-center gap-1">
              <div className={`h-3 w-3 rounded-sm ${color}`} />
              <span>{label}</span>
            </div>
          ))}
        </div>
      </div>
      {/* Tooltip */}
      {tooltip && (
        <div className="pointer-events-none fixed z-50 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-xl" style={{ top: "50%", left: "50%", transform: "translate(-50%,-50%)" }}>
          <p className="font-bold text-slate-900">{tooltip.day} {tooltip.hour}:00</p>
          <p className="text-slate-600">Avg Score: <strong>{tooltip.cell.score}%</strong></p>
          <p className="text-slate-600">Calls: {tooltip.cell.calls}</p>
          {tooltip.cell.critical > 0 && <p className="text-red-600">Critical: {tooltip.cell.critical}</p>}
        </div>
      )}
    </div>
  );
}

// ─── Agent Risk Row ────────────────────────────────────────────────────────────

const RISK_MAP: Record<string, { label: string; cls: string }> = {
  declining_fast:     { label: "Declining Fast",      cls: "bg-red-100 text-red-700 border-red-200" },
  declining:          { label: "Declining",            cls: "bg-orange-100 text-orange-700 border-orange-200" },
  improving:          { label: "Improving",            cls: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  unstable:           { label: "Unstable",             cls: "bg-yellow-100 text-yellow-700 border-yellow-200" },
  consistently_poor:  { label: "Consistently Poor",   cls: "bg-red-100 text-red-700 border-red-200" },
  top_performer:      { label: "Top Performer",        cls: "bg-blue-100 text-blue-700 border-blue-200" },
  stable:             { label: "Stable",               cls: "bg-slate-100 text-slate-600 border-slate-200" },
};

// ─── Drill-down Modal ─────────────────────────────────────────────────────────

function AgentDetailModal({ agent, onClose }: { agent: AgentRisk; onClose: () => void }) {
  const radarData = [
    { metric: "Overall", value: agent.overall_avg },
    { metric: "This Week", value: agent.week_avg ?? 0 },
    { metric: "Yesterday", value: agent.yesterday_avg ?? 0 },
    { metric: "Consistency", value: Math.max(0, 100 - (agent.volatility ?? 0)) },
    { metric: "Pass Rate", value: agent.total_calls > 0 ? ((agent.total_calls - agent.critical_count) / agent.total_calls) * 100 : 0 },
  ];
  const risk = RISK_MAP[agent.risk_status] ?? { label: agent.risk_status, cls: "bg-slate-100 text-slate-600 border-slate-200" };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="text-lg font-black text-slate-900">{agent.agent_name}</h3>
            <span className={`mt-1 inline-block rounded-full border px-2.5 py-0.5 text-xs font-bold ${risk.cls}`}>{risk.label}</span>
          </div>
          <button onClick={onClose} className="cursor-pointer rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-5">
          {[
            { label: "Total Calls", val: agent.total_calls },
            { label: "Overall Avg", val: `${agent.overall_avg}%` },
            { label: "Week Avg", val: `${agent.week_avg ?? "–"}%` },
            { label: "Yesterday", val: `${agent.yesterday_avg ?? "–"}%` },
            { label: "Critical Calls", val: agent.critical_count },
            { label: "Volatility", val: `${agent.volatility ?? 0}σ` },
          ].map(({ label, val }) => (
            <div key={label} className="rounded-xl bg-slate-50 p-3">
              <p className="text-xs text-slate-500">{label}</p>
              <p className="mt-0.5 text-base font-black text-slate-900">{val}</p>
            </div>
          ))}
        </div>

        <ResponsiveContainer width="100%" height={220}>
          <RadarChart data={radarData}>
            <PolarGrid stroke="#e2e8f0" />
            <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11, fill: "#64748b" }} />
            <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
            <Radar dataKey="value" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.18} strokeWidth={2} />
          </RadarChart>
        </ResponsiveContainer>

        {agent.recommended_action && (
          <div className="mt-4 flex gap-2 rounded-xl border border-blue-200 bg-blue-50 p-3">
            <Info className="h-4 w-4 flex-shrink-0 text-blue-600 mt-0.5" />
            <p className="text-sm font-semibold text-blue-800">{agent.recommended_action}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Tab Definition ───────────────────────────────────────────────────────────

type TabId = "overview" | "quality" | "sales" | "insights" | "roi";

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "overview",  label: "Overview",      icon: <BarChart2 className="h-4 w-4" /> },
  { id: "quality",   label: "Quality Deep",  icon: <Activity className="h-4 w-4" /> },
  { id: "sales",     label: "Sales & Funnel",icon: <TrendingUp className="h-4 w-4" /> },
  { id: "insights",  label: "AI Insights",   icon: <Brain className="h-4 w-4" /> },
  { id: "roi",       label: "ROI Calculator",icon: <DollarSign className="h-4 w-4" /> },
];

// ─── Main Component ───────────────────────────────────────────────────────────

export default function NativeQualityDashboard() {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [clientId, setClientId] = useState("");
  const [granularity, setGranularity] = useState<"day" | "week">("day");
  const [refresh, setRefresh] = useState(0);
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [selectedAgent, setSelectedAgent] = useState<AgentRisk | null>(null);

  const qs = `from=${from}&to=${to}&client_id=${clientId}`;
  const key = [from, to, clientId, granularity, refresh];

  // Core queries — always fetched
  const summaryQ  = useQuery({ queryKey: ["qd-summary",  ...key], queryFn: () => hrmsApi.get<{ summary: Summary }>(`/api/quality-dashboard/summary?${qs}`).then(r => r.summary) });
  const clientsQ  = useQuery({ queryKey: ["qd-clients",  ...key], queryFn: () => hrmsApi.get<{ clients: ClientRow[] }>(`/api/quality-dashboard/clients?from=${from}&to=${to}`).then(r => r.clients) });

  // Tab-lazy queries
  const trendQ    = useQuery({ queryKey: ["qd-trend",    ...key], queryFn: () => hrmsApi.get<{ trend: TrendPoint[] }>(`/api/quality-dashboard/trend?from=${from}&to=${to}&granularity=${granularity}`).then(r => r.trend), enabled: activeTab === "overview" || activeTab === "quality" });
  const agentsQ   = useQuery({ queryKey: ["qd-agents",   ...key], queryFn: () => hrmsApi.get<{ agents: AgentRow[] }>(`/api/quality-dashboard/agents?${qs}&limit=20`).then(r => r.agents), enabled: activeTab === "overview" || activeTab === "quality" });
  const aprQ      = useQuery({ queryKey: ["qd-apr",      ...key], queryFn: () => hrmsApi.get<{ processes: AprRow[] }>(`/api/quality-dashboard/apr-summary?from=${from}&to=${to}`).then(r => r.processes), enabled: activeTab === "quality" });
  const heatmapQ  = useQuery({ queryKey: ["qd-heatmap",  ...key], queryFn: () => hrmsApi.get<{ heatmap: Record<string, Record<number, HeatmapCell>> }>(`/api/quality-dashboard/heatmap?from=${from}&to=${to}`).then(r => r.heatmap), enabled: activeTab === "quality" });
  const agentRiskQ = useQuery({ queryKey: ["qd-agentrisk",...key], queryFn: () => hrmsApi.get<{ agents: AgentRisk[] }>(`/api/quality-dashboard/agent-risk?from=${from}&to=${to}`).then(r => r.agents), enabled: activeTab === "quality" });
  const salesQ    = useQuery({ queryKey: ["qd-sales",    ...key], queryFn: () => hrmsApi.get<{ summary: SalesSummary; top_competitors: Competitor[] }>(`/api/quality-dashboard/sales-intelligence?${qs}`).then(r => r), enabled: activeTab === "overview" || activeTab === "sales" });
  const fraudQ    = useQuery({ queryKey: ["qd-fraud",    ...key], queryFn: () => hrmsApi.get<{ fraud_signals: FraudSignals }>(`/api/quality-dashboard/fraud-signals?from=${from}&to=${to}`).then(r => r.fraud_signals), enabled: activeTab === "overview" || activeTab === "insights" });
  const funnelQ   = useQuery({ queryKey: ["qd-funnel",   ...key], queryFn: () => hrmsApi.get<{ sales_funnel: SalesFunnel; rejection_funnel: RejectionFunnel; top_rejection_reasons: RejectionReason[] }>(`/api/quality-dashboard/sales-funnel?${qs}`).then(r => r), enabled: activeTab === "sales" });
  const insightsQ = useQuery({ queryKey: ["qd-insights", ...key], queryFn: () => hrmsApi.get<{ insights: Insight[] }>(`/api/quality-dashboard/insights?from=${from}&to=${to}`).then(r => r.insights), enabled: activeTab === "insights" });
  const roiQ      = useQuery({ queryKey: ["qd-roi",      ...key], queryFn: () => hrmsApi.get<{ roi: RoiData }>(`/api/quality-dashboard/roi?from=${from}&to=${to}`).then(r => r.roi), enabled: activeTab === "roi" });

  const s = summaryQ.data;
  const pct = (n: number) => s && s.total_calls > 0 ? `${((n / s.total_calls) * 100).toFixed(1)}% of total` : "–";
  const scoreColor = !s ? "text-slate-900" : s.avg_quality_score >= 80 ? "text-emerald-600" : s.avg_quality_score >= 70 ? "text-yellow-600" : "text-red-600";

  const shrinkageColor = (p: number) => p < 15 ? "text-emerald-600 font-bold" : p <= 25 ? "text-yellow-600 font-bold" : "text-red-600 font-bold";

  // ─── Filter Bar ─────────────────────────────────────────────────────────────

  const FilterBar = (
    <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm backdrop-blur-sm">
      {[
        { label: "From", value: from, setter: setFrom },
        { label: "To",   value: to,   setter: setTo },
      ].map(({ label, value, setter }) => (
        <div key={label} className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-slate-500">{label}</label>
          <input type="date" value={value} onChange={e => setter(e.target.value)}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-300 cursor-pointer" />
        </div>
      ))}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-semibold text-slate-500">Client</label>
        <select value={clientId} onChange={e => setClientId(e.target.value)}
          className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-300 cursor-pointer">
          <option value="">All Clients</option>
          {(clientsQ.data ?? []).map(c => <option key={c.client_id} value={c.client_id}>{c.client_name ?? c.client_id}</option>)}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-semibold text-slate-500">Granularity</label>
        <div className="flex gap-1">
          {(["day", "week"] as const).map(g => (
            <button key={g} onClick={() => setGranularity(g)}
              className={`cursor-pointer rounded-xl px-3 py-2 text-sm font-semibold capitalize transition-colors ${granularity === g ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
              {g}
            </button>
          ))}
        </div>
      </div>
      <button onClick={() => setRefresh(r => r + 1)}
        className="ml-auto inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50">
        <RefreshCcw className="h-4 w-4" /> Refresh
      </button>
    </div>
  );

  // ─── KPI Cards ───────────────────────────────────────────────────────────────

  const KpiRow = summaryQ.isLoading ? <Spinner /> : (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      <KpiCard label="Total Calls"      value={s?.total_calls ?? 0}            icon={<BarChart2 className="h-5 w-5" />} tone="blue"    animate />
      <KpiCard label="Avg Quality Score" value={s ? `${s.avg_quality_score}%` : "–"} icon={<Target className="h-5 w-5" />}   tone="slate"  />
      <KpiCard label="Above 80%"        value={s?.calls_above_80 ?? 0}         sub={s ? pct(s.calls_above_80) : undefined} icon={<TrendingUp className="h-5 w-5" />}   tone="emerald" animate />
      <KpiCard label="Below 50%"        value={s?.calls_below_50 ?? 0}         sub={s ? pct(s.calls_below_50) : undefined} icon={<AlertTriangle className="h-5 w-5" />} tone="red"    animate />
      <KpiCard label="Agents"           value={s?.unique_agents ?? 0}          icon={<Users className="h-5 w-5" />}        tone="purple" animate />
      <KpiCard label="Fraud Flags"      value={s?.fraud_flags ?? 0}            icon={<Shield className="h-5 w-5" />}       tone={s && s.fraud_flags > 0 ? "orange" : "slate"} animate />
    </div>
  );

  // ─── Tab: Overview ───────────────────────────────────────────────────────────

  const OverviewTab = (
    <div className="space-y-5">
      {KpiRow}

      {/* AI Quality Operations Brief */}
      <AIInsightPanel
        contextType="quality_operations"
        role="qa"
        title="Quality AI Brief"
        enabled={!summaryQ.isLoading && s !== undefined}
        data={{
          total_calls: s?.total_calls,
          audited_calls: s?.audited_calls,
          avg_quality_score: s?.avg_quality_score,
          calls_above_80: s?.calls_above_80,
          calls_below_50: s?.calls_below_50,
          unique_agents: s?.unique_agents,
          fraud_flags: s?.fraud_flags,
        }}
      />

      {/* Trend + Clients */}
      <div className="grid gap-5 xl:grid-cols-3">
        <div className="xl:col-span-2 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="font-black text-slate-900">Quality Score Trend</h2>
              <p className="text-xs text-slate-500">Avg quality over time</p>
            </div>
          </div>
          {trendQ.isLoading ? <Spinner size="sm" /> : trendQ.isError ? <ErrBanner msg="Failed to load trend" /> : (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={trendQ.data ?? []} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="scoreGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                <Tooltip formatter={(v: number) => [`${v}%`, "Avg Score"]} contentStyle={{ borderRadius: "12px", border: "1px solid #e2e8f0", fontSize: 12 }} />
                <ReferenceLine y={80} stroke="#22c55e" strokeDasharray="6 3" label={{ value: "80%", position: "right", fontSize: 10, fill: "#22c55e" }} />
                <ReferenceLine y={50} stroke="#ef4444" strokeDasharray="6 3" label={{ value: "50%", position: "right", fontSize: 10, fill: "#ef4444" }} />
                <Area type="monotone" dataKey="avg_score" stroke="#3b82f6" strokeWidth={2.5} fill="url(#scoreGrad)" dot={false} activeDot={{ r: 4 }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 font-black text-slate-900">Client Performance</h2>
          {clientsQ.isLoading ? <Spinner size="sm" /> : clientsQ.isError ? <ErrBanner msg="Failed" /> : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={(clientsQ.data ?? []).slice(0, 8).map(c => ({ ...c, display_name: c.client_name ?? c.client_id }))} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                <YAxis dataKey="display_name" type="category" tick={{ fontSize: 10, fill: "#64748b" }} tickLine={false} width={80} />
                <Tooltip formatter={(v: number) => [`${v}%`, "Avg Score"]} contentStyle={{ borderRadius: "12px", border: "1px solid #e2e8f0", fontSize: 12 }} />
                <Bar dataKey="avg_score" fill="#6366f1" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Agent Table + Fraud */}
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="font-black text-slate-900">Agent Leaderboard</h2>
            <p className="text-xs text-slate-500">Ranked by avg quality · Top 10</p>
          </div>
          {agentsQ.isLoading ? <Spinner size="sm" /> : agentsQ.isError ? <div className="p-4"><ErrBanner msg="Failed to load agents" /></div> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[440px] text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
                  <tr>{["#", "Agent", "Calls", "Score", "Band"].map(h => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {(agentsQ.data ?? []).slice(0, 10).map((a, i) => (
                    <tr key={a.agent_name} className="border-t border-slate-50 transition-colors hover:bg-slate-50/70">
                      <td className="px-4 py-3 font-bold text-slate-300">{i + 1}</td>
                      <td className="px-4 py-3"><div className="font-semibold text-slate-800">{a.agent_name}</div>{a.agent_code && <div className="text-xs text-slate-400">{a.agent_code}</div>}</td>
                      <td className="px-4 py-3 text-slate-500">{a.total_calls}</td>
                      <td className="px-4 py-3"><ScorePill score={a.avg_score} /></td>
                      <td className="px-4 py-3 text-xs text-slate-500 capitalize">{a.band}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Fail Rates */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 font-black text-slate-900">Parameter Fail Rates</h2>
          {summaryQ.isLoading ? <Spinner size="sm" /> : s ? (
            <div className="space-y-4">
              {([
                { label: "Call Opening",     val: s.fail_rate_call_open },
                { label: "Professionalism",  val: s.fail_rate_professionalism },
                { label: "Active Listening", val: s.fail_rate_active_listening },
                { label: "Call Closure",     val: s.fail_rate_call_closure },
                { label: "Accuracy",         val: s.fail_rate_accuracy },
              ] as const).map(({ label, val }) => (
                <div key={label}>
                  <div className="mb-1.5 flex justify-between text-sm">
                    <span className="font-semibold text-slate-700">{label}</span>
                    <span className={`font-bold ${val > 30 ? "text-red-600" : val > 20 ? "text-orange-500" : "text-yellow-600"}`}>{val}%</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-slate-100">
                    <div className={`h-2 rounded-full transition-all duration-700 ${val > 30 ? "bg-red-400" : val > 20 ? "bg-orange-400" : "bg-yellow-400"}`} style={{ width: `${Math.min(val, 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {/* Fraud */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 font-black text-slate-900">Fraud Risk Signals</h2>
        {fraudQ.isLoading ? <Spinner size="sm" /> : fraudQ.isError ? <ErrBanner msg="Failed to load fraud signals" /> : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {([
              ["data_theft", "Data Theft"],
              ["financial_fraud", "Financial Fraud"],
              ["collusion", "Collusion"],
              ["escalation_failure", "Escalation Failure"],
              ["unprofessional", "Unprofessional"],
              ["system_manipulation", "System Manipulation"],
            ] as [keyof FraudSignals, string][]).map(([key, label]) => {
              const count = fraudQ.data?.[key] ?? 0;
              return (
                <div key={key} className={`flex items-center gap-3 rounded-xl border p-3 transition-all ${count > 0 ? "border-red-200 bg-red-50 hover:border-red-300" : "border-emerald-200 bg-emerald-50"}`}>
                  {count > 0
                    ? <AlertTriangle className="h-4 w-4 flex-shrink-0 text-red-500" />
                    : <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-emerald-500" />}
                  <div>
                    <p className={`text-lg font-black ${count > 0 ? "text-red-700" : "text-emerald-700"}`}>{count}</p>
                    <p className="text-xs font-medium text-slate-600 leading-tight">{label}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  // ─── Tab: Quality Deep ───────────────────────────────────────────────────────

  const QualityTab = (
    <div className="space-y-5">
      {/* Heatmap */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-1 flex items-center gap-2">
          <h2 className="font-black text-slate-900">Quality Heatmap</h2>
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700">Hour × Day</span>
        </div>
        <p className="mb-4 text-xs text-slate-500">Hover a cell to see avg score, call volume, and critical count</p>
        {heatmapQ.isLoading ? <Spinner size="sm" /> : heatmapQ.isError ? <ErrBanner msg="Failed to load heatmap" /> : (
          <QualityHeatmap data={heatmapQ.data ?? {}} />
        )}
      </div>

      {/* Agent Risk Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="font-black text-slate-900">Agent Risk Intelligence</h2>
          <p className="text-xs text-slate-500">Click a row to drill down into full agent analytics</p>
        </div>
        {agentRiskQ.isLoading ? <Spinner size="sm" /> : agentRiskQ.isError ? <div className="p-4"><ErrBanner msg="Failed to load agent risk data" /></div> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
                <tr>{["Agent", "Total", "Overall", "Week", "Delta", "Status", "Action"].map(h => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}</tr>
              </thead>
              <tbody>
                {(agentRiskQ.data ?? []).map(agent => {
                  const risk = RISK_MAP[agent.risk_status] ?? { label: agent.risk_status, cls: "bg-slate-100 text-slate-600 border-slate-200" };
                  const isAtRisk = ["declining_fast", "declining", "consistently_poor"].includes(agent.risk_status);
                  return (
                    <tr key={agent.agent_name} onClick={() => setSelectedAgent(agent)}
                      className={`border-t border-slate-50 cursor-pointer transition-colors hover:bg-blue-50/40 ${isAtRisk ? "bg-red-50/30" : ""}`}>
                      <td className="px-4 py-3"><div className="font-semibold text-slate-800">{agent.agent_name}</div>{agent.agent_code && <div className="text-xs text-slate-400">{agent.agent_code}</div>}</td>
                      <td className="px-4 py-3 text-slate-500">{agent.total_calls}</td>
                      <td className="px-4 py-3"><ScorePill score={agent.overall_avg} /></td>
                      <td className="px-4 py-3"><ScorePill score={agent.week_avg ?? 0} /></td>
                      <td className={`px-4 py-3 font-bold ${(agent.trend_delta ?? 0) >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                        {(agent.trend_delta ?? 0) >= 0 ? "+" : ""}{agent.trend_delta ?? 0}%
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-bold ${risk.cls}`}>{risk.label}</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-400 max-w-[180px] truncate">{agent.recommended_action}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* APR */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="font-black text-slate-900">APR / Shrinkage Decomposition</h2>
          <p className="text-xs text-slate-500">Average handling time and shrinkage by process</p>
        </div>
        {aprQ.isLoading ? <Spinner size="sm" /> : aprQ.isError ? <div className="p-4"><ErrBanner msg="Failed to load APR data" /></div> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-400">
                <tr>{["Process", "Agents", "Avg Calls", "Avg AHT", "Shrinkage", "Bio", "Lunch", "QA", "Training"].map(h => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}</tr>
              </thead>
              <tbody>
                {(aprQ.data ?? []).map(row => (
                  <tr key={row.process} className="border-t border-slate-50 transition-colors hover:bg-slate-50/70">
                    <td className="px-4 py-3"><div className="font-semibold text-slate-800">{row.process}</div>{row.process_code && row.process_code !== row.process && <div className="text-xs text-slate-400">{row.process_code}</div>}</td>
                    <td className="px-4 py-3 text-slate-500">{row.agents}</td>
                    <td className="px-4 py-3 text-slate-500">{row.avg_calls}</td>
                    <td className="px-4 py-3 text-slate-500 font-mono">{row.avg_aht}</td>
                    <td className={`px-4 py-3 ${shrinkageColor(row.avg_shrinkage_pct)}`}>{row.avg_shrinkage_pct}%</td>
                    {[row.avg_bio_mins, row.avg_lunch_mins, row.avg_qa_mins, row.avg_training_mins].map((m, i) => (
                      <td key={i} className="px-4 py-3 text-slate-500">{m}m</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );

  // ─── Tab: Sales & Funnel ─────────────────────────────────────────────────────

  const SalesTab = (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 font-black text-slate-900">Sales Intelligence</h2>
          {salesQ.isLoading ? <Spinner size="sm" /> : salesQ.isError ? <ErrBanner msg="Failed" /> : (() => {
            const ss = salesQ.data?.summary;
            const convPct = ss && ss.total_calls > 0 ? ((ss.sales_done / ss.total_calls) * 100).toFixed(1) : "0";
            return (
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Total Calls",          value: ss?.total_calls ?? 0,          sub: undefined,                    bg: "bg-blue-50" },
                  { label: "Sales Converted",      value: ss?.sales_done ?? 0,            sub: `${convPct}% conversion rate`, bg: "bg-emerald-50" },
                  { label: "Competitor Mentions",  value: ss?.competitor_mentions ?? 0,   sub: undefined,                    bg: "bg-orange-50" },
                  { label: "Objection Calls",      value: ss?.objection_calls ?? 0,       sub: undefined,                    bg: "bg-yellow-50" },
                ].map(({ label, value, sub, bg }) => (
                  <div key={label} className={`rounded-xl p-4 ${bg}`}>
                    <p className="text-xs font-semibold text-slate-500">{label}</p>
                    <p className="mt-1.5 text-2xl font-black text-slate-900">{value.toLocaleString()}</p>
                    {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
                  </div>
                ))}
              </div>
            );
          })()}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 font-black text-slate-900">Top Competitors Mentioned</h2>
          {salesQ.isLoading ? <Spinner size="sm" /> : salesQ.isError ? <ErrBanner msg="Failed" /> : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={salesQ.data?.top_competitors ?? []} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                <YAxis dataKey="CompetitorName" type="category" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} width={100} />
                <Tooltip contentStyle={{ borderRadius: "12px", border: "1px solid #e2e8f0", fontSize: 12 }} />
                <Bar dataKey="mentions" fill="#f97316" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Funnels */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-1 font-black text-slate-900">Conversion &amp; Rejection Funnels</h2>
        <p className="mb-5 text-xs text-slate-500">Customer journey from first contact to sale or rejection</p>
        {funnelQ.isLoading ? <Spinner size="sm" /> : funnelQ.isError ? <ErrBanner msg="Failed to load funnel data" /> : (() => {
          const sf = funnelQ.data?.sales_funnel;
          const rf = funnelQ.data?.rejection_funnel;
          const reasons = funnelQ.data?.top_rejection_reasons ?? [];
          const sfTotal = sf?.total_calls || 1;
          const rfTotal = rf?.total_calls || 1;

          const salesStages = sf ? [
            { label: "Total Calls",       count: sf.total_calls,       pct: 100,                                      tw: "bg-indigo-500" },
            { label: "Opening Done",      count: sf.opening_done,      pct: (sf.opening_done / sfTotal) * 100,        tw: "bg-blue-500" },
            { label: "Offer Made",        count: sf.offer_made,        pct: (sf.offer_made / sfTotal) * 100,          tw: "bg-cyan-500" },
            { label: "Objection Handled", count: sf.objection_handled, pct: (sf.objection_handled / sfTotal) * 100,   tw: "bg-teal-500" },
            { label: "Sale Done",         count: sf.sale_done,         pct: (sf.sale_done / sfTotal) * 100,           tw: "bg-emerald-500" },
          ] : [];

          const rejectStages = rf ? [
            { label: "Total Calls",      count: rf.total_calls,      pct: 100,                                        tw: "bg-slate-400" },
            { label: "Not Interested",   count: rf.not_interested,   pct: (rf.not_interested / rfTotal) * 100,        tw: "bg-orange-400" },
            { label: "Objection Raised", count: rf.objection_raised, pct: (rf.objection_raised / rfTotal) * 100,      tw: "bg-amber-500" },
            { label: "Offering Rejected",count: rf.offering_rejected,pct: (rf.offering_rejected / rfTotal) * 100,     tw: "bg-red-400" },
            { label: "Opening Rejected", count: rf.opening_rejected, pct: (rf.opening_rejected / rfTotal) * 100,      tw: "bg-red-600" },
          ] : [];

          const renderFunnel = (stages: typeof salesStages) => (
            <div className="space-y-1.5">
              {stages.map((stage, i) => (
                <div key={stage.label}>
                  <div className="mb-1 flex items-center justify-between text-xs font-semibold text-slate-600">
                    <span>{stage.label}</span>
                    <span className="text-slate-400">{stage.count.toLocaleString()} · {stage.pct.toFixed(1)}%</span>
                  </div>
                  <div className="flex h-8 items-center">
                    <div className={`h-full rounded-md transition-all duration-700 ${stage.tw}`}
                      style={{ width: `${Math.max(stage.pct, 2)}%`, minWidth: "2%" }} />
                  </div>
                  {i < stages.length - 1 && <div className="flex justify-start pl-1 py-0.5 text-xs text-slate-200">▼</div>}
                </div>
              ))}
            </div>
          );

          return (
            <div className="space-y-6">
              <div className="grid gap-8 lg:grid-cols-2">
                <div>
                  <h3 className="mb-4 text-xs font-black uppercase tracking-widest text-emerald-700">Sales Transition Funnel</h3>
                  {renderFunnel(salesStages)}
                </div>
                <div>
                  <h3 className="mb-4 text-xs font-black uppercase tracking-widest text-red-700">Rejection Transition Funnel</h3>
                  {renderFunnel(rejectStages)}
                </div>
              </div>

              {reasons.length > 0 && (
                <div>
                  <h3 className="mb-3 text-xs font-black uppercase tracking-widest text-slate-700">Top Rejection Reasons</h3>
                  <ResponsiveContainer width="100%" height={Math.max(reasons.length * 36, 120)}>
                    <BarChart data={reasons} layout="vertical" margin={{ top: 0, right: 24, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                      <YAxis dataKey="reason" type="category" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} width={160} />
                      <Tooltip contentStyle={{ borderRadius: "12px", border: "1px solid #e2e8f0", fontSize: 12 }} />
                      <Bar dataKey="count" fill="#ef4444" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );

  // ─── Tab: AI Insights ────────────────────────────────────────────────────────

  const InsightsTab = (
    <div className="space-y-5">
      <div className="rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 to-indigo-50 p-5 shadow-sm">
        <div className="mb-1 flex items-center gap-2">
          <Brain className="h-5 w-5 text-blue-600" />
          <h2 className="font-black text-blue-900">AI-Generated Insights</h2>
        </div>
        <p className="text-xs text-blue-600">Automated analysis of quality patterns, agent behavior, and performance gaps</p>
      </div>

      {insightsQ.isLoading ? <Spinner /> : insightsQ.isError ? <ErrBanner msg="Failed to load insights" /> :
        insightsQ.data && insightsQ.data.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {insightsQ.data.map((insight, i) => <InsightCard key={i} insight={insight} />)}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 py-12 text-center">
            <CheckCircle2 className="mb-3 h-10 w-10 text-emerald-400" />
            <p className="font-bold text-slate-700">No active alerts</p>
            <p className="mt-1 text-sm text-slate-400">Quality metrics are within normal range for the selected period</p>
          </div>
        )
      }

      {/* Fraud */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 font-black text-slate-900">Fraud Risk Signals</h2>
        {fraudQ.isLoading ? <Spinner size="sm" /> : fraudQ.isError ? <ErrBanner msg="Failed" /> : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {([
              ["data_theft", "Data Theft"],
              ["financial_fraud", "Financial Fraud"],
              ["collusion", "Collusion"],
              ["escalation_failure", "Escalation Failure"],
              ["unprofessional", "Unprofessional"],
              ["system_manipulation", "System Manipulation"],
            ] as [keyof FraudSignals, string][]).map(([key, label]) => {
              const count = fraudQ.data?.[key] ?? 0;
              return (
                <div key={key} className={`flex items-center gap-3 rounded-xl border p-3 ${count > 0 ? "border-red-200 bg-red-50" : "border-emerald-200 bg-emerald-50"}`}>
                  {count > 0
                    ? <AlertTriangle className="h-4 w-4 flex-shrink-0 text-red-500" />
                    : <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-emerald-500" />}
                  <div>
                    <p className={`text-lg font-black ${count > 0 ? "text-red-700" : "text-emerald-700"}`}>{count}</p>
                    <p className="text-xs font-medium text-slate-600 leading-tight">{label}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  // ─── Tab: ROI Calculator ─────────────────────────────────────────────────────

  const RoiTab = (
    <div className="space-y-5">
      <div className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50 to-teal-50 p-5 shadow-sm">
        <div className="mb-1 flex items-center gap-2">
          <DollarSign className="h-5 w-5 text-emerald-600" />
          <h2 className="font-black text-emerald-900">Quality ROI Calculator</h2>
        </div>
        <p className="text-xs text-emerald-700">Projected revenue impact of quality improvements — based on quality-to-conversion correlation</p>
      </div>

      {roiQ.isLoading ? <Spinner /> : roiQ.isError ? <ErrBanner msg="Failed to load ROI data" /> : roiQ.data ? (() => {
        const { current_metrics, projections } = roiQ.data;
        return (
          <div className="space-y-5">
            {/* Current State */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { label: "Current Quality",    value: `${current_metrics.quality?.toFixed(1) ?? "–"}%`, icon: <Target className="h-5 w-5" />,   tone: "blue" as const },
                { label: "Conversion Rate",    value: `${current_metrics.conversion?.toFixed(2) ?? "–"}%`, icon: <TrendingUp className="h-5 w-5" />, tone: "emerald" as const },
                { label: "Total Calls",        value: (current_metrics.total_calls ?? 0).toLocaleString(), icon: <Clock className="h-5 w-5" />,   tone: "purple" as const },
                { label: "Total Sales",        value: (current_metrics.total_sales ?? 0).toLocaleString(), icon: <DollarSign className="h-5 w-5" />, tone: "orange" as const },
              ].map(p => <KpiCard key={p.label} {...p} />)}
            </div>

            {/* Projections */}
            <div className="grid gap-4 lg:grid-cols-3">
              {projections.map(proj => (
                <div key={proj.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-black text-emerald-700">{proj.label}</span>
                    <span className="text-xs text-slate-400">ROI: {proj.roi_multiple}×</span>
                  </div>
                  <div className="space-y-2">
                    {[
                      { label: "Projected Quality",    val: `${proj.projected_quality.toFixed(1)}%` },
                      { label: "Projected Conversion", val: `${proj.projected_conversion}%` },
                      { label: "Additional Sales",     val: proj.additional_sales.toLocaleString() },
                      { label: "Additional Revenue",   val: `$${proj.additional_revenue.toLocaleString()}` },
                    ].map(({ label, val }) => (
                      <div key={label} className="flex items-center justify-between text-sm">
                        <span className="text-slate-500">{label}</span>
                        <span className="font-bold text-slate-900">{val}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 h-1.5 w-full rounded-full bg-slate-100">
                    <div className="h-1.5 rounded-full bg-emerald-500 transition-all duration-700"
                      style={{ width: `${Math.min((proj.improvement / 15) * 100, 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>

            <p className="text-xs text-slate-400 text-center">* Revenue projections assume empirical 0.3% conversion lift per 1% quality improvement. Actual results may vary.</p>
          </div>
        );
      })() : null}
    </div>
  );

  // ─── Render ───────────────────────────────────────────────────────────────────

  const TAB_CONTENT: Record<TabId, React.ReactNode> = {
    overview: OverviewTab,
    quality:  QualityTab,
    sales:    SalesTab,
    insights: InsightsTab,
    roi:      RoiTab,
  };

  return (
    <DashboardLayout>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-blue-600">Call Audit Intelligence</p>
              {s && (
                <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${s.avg_quality_score >= 80 ? "bg-emerald-100 text-emerald-700" : s.avg_quality_score >= 70 ? "bg-yellow-100 text-yellow-700" : "bg-red-100 text-red-700"}`}>
                  {s.avg_quality_score}% avg
                </span>
              )}
            </div>
            <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-950">Quality Dashboard</h1>
            <p className="mt-1 text-sm text-slate-500">Real-time call quality · Agent risk intelligence · Sales funnel · AI insights · ROI</p>
          </div>
          {summaryQ.data?.scope_label && summaryQ.data.scope_label !== "All" && (
            <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
              <Layers className="h-4 w-4 text-amber-600" />
              <span className="text-xs font-bold text-amber-700">Scoped: {summaryQ.data.scope_label}</span>
            </div>
          )}
        </div>

        {FilterBar}

        {summaryQ.isError && <ErrBanner msg={String(summaryQ.error)} />}

        {/* Tabs */}
        <div className="flex gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-slate-50 p-1 no-scrollbar">
          {TABS.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-bold transition-all ${
                activeTab === tab.id
                  ? "bg-white text-blue-700 shadow-sm ring-1 ring-slate-200"
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

      {/* Agent Detail Modal */}
      {selectedAgent && <AgentDetailModal agent={selectedAgent} onClose={() => setSelectedAgent(null)} />}
    </DashboardLayout>
  );
}
