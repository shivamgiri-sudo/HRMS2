import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle, BarChart3, BookOpen, CheckCircle2, ChevronDown, ChevronUp,
  Clock, Loader, Minus, Plus, RefreshCcw, Search, ShieldAlert, Users, X,
  TrendingUp, TrendingDown, ArrowRight, Lightbulb, AlertCircle, Activity
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { AIInsightPanel } from "@/components/ai";
import { InterventionPanel } from "@/components/dashboard/InterventionPanel";
import { useWorkforceAccess } from "@/hooks/useUserRole";
import { hrmsApi } from "@/lib/hrmsApi";

type DashboardStats = { headcount: number; attrition_rate: number; avg_kpi_score: number; open_tickets: number; pending_leaves: number; attendance_rate: number };
type TeamKpi = { employee_id: string; employee_code?: string; employee_name: string; period: string; overall_score: number; rank_position: number; trend: "up" | "down" | "stable" };
type CoachingSession = { id: string; employee_id: string; employee_name: string; coach_user_id: string; session_date: string; session_type: string; notes: string; action_items: string; status: string };
type PerformanceAlert = { id: string; employee_id: string; employee_name: string; alert_type: string; severity: "critical" | "high" | "medium" | "low"; message: string; acknowledged: boolean };
type CoachingForm = { employee_id: string; session_date: string; session_type: string; notes: string; action_items: string };
type TeamMember = { id: string; employee_code: string; full_name: string };
type ActiveTab = "overview" | "kpi" | "coaching" | "alerts";
type Lens = "CEO" | "HR" | "Finance" | "Operations";
type HcGapProcess = { process_name: string; mandated_hc: number; required_hc: number; active_hc: number; gap: number };
type CeoMetrics = {
  payroll_liability: { run_month: string | null; total_gross: number; total_net: number; employer_statutory: number; employee_count: number } | null;
  hc_gap: { total_gap: number; processes_understaffed: number; by_process?: HcGapProcess[] };
  revenue_at_risk: { total_daily_estimate: number };
  billing: { last_month_billed: number; billing_month: string | null };
  attrition_cost: { exits_30d: number; replacement_cost_estimate: number };
  hiring_pipeline: { open_candidates: number; offers_pending_joining: number };
  ff_liability: { pending_count: number; pending_amount: number } | null;
};

function inrFmt(v: number) { if (v >= 10_000_000) return `₹${(v / 10_000_000).toFixed(2)} Cr`; if (v >= 100_000) return `₹${(v / 100_000).toFixed(2)} L`; return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v); }

const SEVERITY_TABS = ["All", "Critical", "High", "Medium", "Low"] as const;
const SESSION_TYPES = ["one_on_one", "performance_review", "goal_setting", "feedback", "disciplinary", "career_development"];

// ─── Sparkline Micro-Chart ───────────────────────────────────────────────────

function Sparkline({ data, color = "#3b82f6", width = 72, height = 24 }: { data: number[]; color?: string; width?: number; height?: number }) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / Math.max(data.length - 1, 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  });
  const lastY = height - ((data[data.length - 1] - min) / range) * (height - 4) - 2;
  return (
    <svg width={width} height={height} className="overflow-visible inline-block shrink-0">
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity={0.8} />
      <circle cx={width} cy={lastY} r="2.5" fill={color} />
    </svg>
  );
}

// ─── Org Health Bar ──────────────────────────────────────────────────────────

function OrgHealthBar({ attendance, kpi, retention, alertScore }: { attendance: number; kpi: number; retention: number; alertScore: number }) {
  const segments = [
    { label: "Attendance", value: attendance, color: "bg-emerald-500" },
    { label: "KPI", value: kpi, color: "bg-blue-500" },
    { label: "Retention", value: retention, color: "bg-violet-500" },
    { label: "Alerts", value: alertScore, color: "bg-amber-500" },
  ];
  const total = Math.round((attendance * 0.3 + kpi * 0.3 + retention * 0.25 + alertScore * 0.15));
  const healthColor = total >= 80 ? "text-emerald-600" : total >= 60 ? "text-amber-600" : "text-red-600";

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-slate-500 dark:text-slate-400" />
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Organization Health Score</span>
        </div>
        <span className={`text-2xl font-black ${healthColor}`}>{total}%</span>
      </div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        {segments.map((seg) => (
          <div
            key={seg.label}
            className={`${seg.color} transition-all duration-500`}
            style={{ width: `${seg.value * (seg.label === "Attendance" ? 0.3 : seg.label === "KPI" ? 0.3 : seg.label === "Retention" ? 0.25 : 0.15)}%` }}
            title={`${seg.label}: ${seg.value}%`}
          />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-500 dark:text-slate-400">
        {segments.map((seg) => (
          <div key={seg.label} className="flex items-center gap-1.5">
            <div className={`h-2 w-2 rounded-full ${seg.color}`} />
            <span>{seg.label}: <span className="font-semibold text-slate-700 dark:text-slate-300">{seg.value}%</span></span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── HC Gap Drill-Down Panel ─────────────────────────────────────────────────

function HcGapDrillDown({ processes, onClose }: { processes: HcGapProcess[]; onClose: () => void }) {
  if (!processes.length) return null;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-lg dark:border-slate-700 dark:bg-slate-900 animate-in slide-in-from-top-2 duration-200">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-slate-900 dark:text-white">HC Gap — Per-Process Breakdown</h3>
        <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition-colors">
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="text-left text-xs font-bold uppercase text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
            <tr>
              <th className="pb-3 pr-4">Process</th>
              <th className="pb-3 pr-4 text-right">Mandated</th>
              <th className="pb-3 pr-4 text-right">Required</th>
              <th className="pb-3 pr-4 text-right">Active</th>
              <th className="pb-3 text-right">Gap</th>
              <th className="pb-3 pl-4">Fill Rate</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {processes.map((p) => {
              const fillPct = p.mandated_hc > 0 ? Math.round((p.active_hc / p.mandated_hc) * 100) : 100;
              const barColor = fillPct >= 90 ? "bg-emerald-500" : fillPct >= 70 ? "bg-amber-500" : "bg-red-500";
              return (
                <tr key={p.process_name} className="group hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                  <td className="py-3 pr-4 font-medium text-slate-900 dark:text-white">{p.process_name}</td>
                  <td className="py-3 pr-4 text-right font-mono text-slate-600 dark:text-slate-400">{p.mandated_hc}</td>
                  <td className="py-3 pr-4 text-right font-mono text-slate-600 dark:text-slate-400">{p.required_hc}</td>
                  <td className="py-3 pr-4 text-right font-mono text-slate-600 dark:text-slate-400">{p.active_hc}</td>
                  <td className="py-3 text-right">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold ${
                      p.gap > 0 ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"
                    }`}>
                      {p.gap > 0 ? `-${p.gap}` : "✓"}
                    </span>
                  </td>
                  <td className="py-3 pl-4">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-16 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                        <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${Math.min(fillPct, 100)}%` }} />
                      </div>
                      <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{fillPct}%</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Premium Metric Card ─────────────────────────────────────────────────────

function MetricCard({
  title,
  value,
  icon,
  trend,
  trendValue,
  insight,
  severity = "info",
  sparklineData,
  onClick,
}: {
  title: string;
  value: number | string;
  icon: React.ReactNode;
  trend?: "up" | "down" | "stable";
  trendValue?: string;
  insight: string;
  severity?: "success" | "warning" | "danger" | "info";
  sparklineData?: number[];
  onClick?: () => void;
}) {
  const gradients = {
    success: "bg-gradient-to-br from-emerald-50 to-green-100 border-emerald-200/60 dark:from-emerald-900/20 dark:to-emerald-950/30 dark:border-emerald-700/40",
    warning: "bg-gradient-to-br from-amber-50 to-yellow-100 border-amber-200/60 dark:from-amber-900/20 dark:to-amber-950/30 dark:border-amber-700/40",
    danger: "bg-gradient-to-br from-red-50 to-rose-100 border-red-200/60 dark:from-red-900/20 dark:to-red-950/30 dark:border-red-700/40",
    info: "bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200/60 dark:from-blue-900/20 dark:to-blue-950/30 dark:border-blue-700/40",
  };

  const sparkColors = {
    success: "#10b981",
    warning: "#f59e0b",
    danger: "#ef4444",
    info: "#3b82f6",
  };

  const trendColors = {
    up: "text-emerald-600 dark:text-emerald-400",
    down: "text-red-600 dark:text-red-400",
    stable: "text-slate-500 dark:text-slate-400",
  };

  const trendIcon = trend === "up" ? <TrendingUp className="h-3.5 w-3.5" /> : trend === "down" ? <TrendingDown className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />;

  return (
    <div
      onClick={onClick}
      className={`relative overflow-hidden rounded-2xl border p-5 transition-all duration-200 ${gradients[severity]} ${onClick ? "cursor-pointer hover:shadow-lg hover:scale-[1.01]" : ""}`}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-600 dark:text-slate-400 mb-1 truncate">{title}</p>
          <div className="flex items-baseline gap-2 flex-wrap">
            <p className="text-3xl font-bold text-slate-900 dark:text-white">{value}</p>
            {trend && trendValue && (
              <div className={`flex items-center gap-1 text-xs font-semibold ${trendColors[trend]}`}>
                {trendIcon}
                <span>{trendValue}</span>
              </div>
            )}
          </div>
        </div>
        <div className="rounded-xl bg-white/80 dark:bg-slate-800/80 p-2.5 shadow-sm shrink-0">
          {icon}
        </div>
      </div>

      {/* Sparkline micro-chart */}
      {sparklineData && sparklineData.length >= 2 && (
        <div className="mb-3">
          <Sparkline data={sparklineData} color={sparkColors[severity]} />
        </div>
      )}

      <div className="pt-3 border-t border-slate-200/50 dark:border-slate-700/50">
        <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400 line-clamp-2">{insight}</p>
      </div>
      {onClick && (
        <div className="absolute bottom-3 right-3 opacity-30">
          <ArrowRight className="h-4 w-4 text-slate-500" />
        </div>
      )}
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const cls = score >= 80 ? "bg-green-100 text-green-800 ring-green-300 dark:bg-green-900/30 dark:text-green-300 dark:ring-green-700" : score >= 60 ? "bg-amber-100 text-amber-800 ring-amber-300 dark:bg-amber-900/30 dark:text-amber-300 dark:ring-amber-700" : "bg-red-100 text-red-800 ring-red-300 dark:bg-red-900/30 dark:text-red-300 dark:ring-red-700";
  return <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-bold ring-1 ${cls}`}>{score.toFixed(1)}</span>;
}

function TrendIcon({ trend }: { trend: "up" | "down" | "stable" }) {
  if (trend === "up") return <ChevronUp className="inline h-5 w-5 text-green-600" />;
  if (trend === "down") return <ChevronDown className="inline h-5 w-5 text-red-600" />;
  return <Minus className="inline h-5 w-5 text-slate-400" />;
}

function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, string> = {
    critical: "bg-red-100 text-red-900 ring-red-400 dark:bg-red-900/30 dark:text-red-300",
    high: "bg-orange-100 text-orange-900 ring-orange-400 dark:bg-orange-900/30 dark:text-orange-300",
    medium: "bg-amber-100 text-amber-900 ring-amber-400 dark:bg-amber-900/30 dark:text-amber-300",
    low: "bg-slate-100 text-slate-700 ring-slate-300 dark:bg-slate-800 dark:text-slate-300"
  };
  return <span className={`rounded-full px-3 py-1 text-xs font-bold capitalize ring-1 ${map[severity] ?? "bg-slate-100 text-slate-600 ring-slate-300"}`}>{severity}</span>;
}

function SessionStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    scheduled: "bg-blue-100 text-blue-900 ring-blue-300 dark:bg-blue-900/30 dark:text-blue-300",
    completed: "bg-green-100 text-green-900 ring-green-300 dark:bg-green-900/30 dark:text-green-300",
    cancelled: "bg-red-100 text-red-900 ring-red-300 dark:bg-red-900/30 dark:text-red-300",
    rescheduled: "bg-amber-100 text-amber-900 ring-amber-300 dark:bg-amber-900/30 dark:text-amber-300"
  };
  return <span className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ring-1 ${map[status] ?? "bg-slate-100 text-slate-600 ring-slate-300"}`}>{status}</span>;
}

export default function NativeManagementDashboard() {
  const navigate = useNavigate();
  const { roleKeys } = useWorkforceAccess();

  const ALLOWED_ROLES = ["ceo", "admin", "super_admin", "hr", "manager", "branch_head", "process_manager"];
  const hasAccess = roleKeys.length > 0 && roleKeys.some((r: string) => ALLOWED_ROLES.includes(r));
  useEffect(() => {
    if (roleKeys.length > 0 && !hasAccess) {
      navigate("/dashboard", { replace: true });
    }
  }, [roleKeys, hasAccess, navigate]);
  if (!hasAccess) return null;

  const [activeTab, setActiveTab] = useState<ActiveTab>("overview");
  const [lens, setLens] = useState<Lens>("CEO");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [dashStats, setDashStats] = useState<DashboardStats | null>(null);
  const [ceoMetrics, setCeoMetrics] = useState<CeoMetrics | null>(null);
  const [teamKpi, setTeamKpi] = useState<TeamKpi[]>([]);
  const [coachingSessions, setCoachingSessions] = useState<CoachingSession[]>([]);
  const [alerts, setAlerts] = useState<PerformanceAlert[]>([]);
  const [kpiPeriod, setKpiPeriod] = useState<string>(() => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`; });
  const [severityFilter, setSeverityFilter] = useState<string>("All");
  const [showCoachingModal, setShowCoachingModal] = useState(false);
  const [submittingCoaching, setSubmittingCoaching] = useState(false);
  const [acknowledgingId, setAcknowledgingId] = useState<string | null>(null);
  const [coachingForm, setCoachingForm] = useState<CoachingForm>({ employee_id: "", session_date: "", session_type: "one_on_one", notes: "", action_items: "" });
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [opsPulse, setOpsPulse] = useState<{ intervention_flags: { type: string; severity: "critical" | "warning" | "info"; detail: string; action: string }[] } | null>(null);
  const [attritionBreakdown, setAttritionBreakdown] = useState<{ reason: string; count: number; pct: number }[]>([]);
  const [restrictedFields, setRestrictedFields] = useState<string[]>([]);
  const [showHcDrillDown, setShowHcDrillDown] = useState(false);
  const [trendData, setTrendData] = useState<Record<string, number[]>>({});

  const isRestricted = (field: keyof CeoMetrics) => restrictedFields.includes(field);
  const payrollAmt = (value: number | null | undefined) =>
    value == null ? (isRestricted("payroll_liability") ? "Restricted" : "—") : inrFmt(value);
  const ffAmt = (value: number | null | undefined) =>
    value == null ? (isRestricted("ff_liability") ? "Restricted" : "—") : inrFmt(value);

  const loadDashboard = async () => { try { const res = await hrmsApi.get<{ success: boolean; data: DashboardStats }>("/api/management/dashboard"); setDashStats(res.data ?? null); } catch { /* handled by summary UI */ } };
  const loadCeoMetrics = async () => { try { const res = await hrmsApi.get<{ success: boolean; data: CeoMetrics; restricted?: string[] }>("/api/management/ceo-metrics"); setCeoMetrics(res.data ?? null); setRestrictedFields(res.restricted ?? []); } catch { /* silent */ } };
  const loadKpi = async () => { try { const res = await hrmsApi.get<{ success: boolean; data: TeamKpi[] }>(`/api/management/team-kpi?period=${kpiPeriod}`); setTeamKpi(res.data ?? []); } catch { /* silent */ } };
  const loadCoaching = async () => { try { const res = await hrmsApi.get<{ success: boolean; data: CoachingSession[] }>("/api/management/coaching"); setCoachingSessions(res.data ?? []); } catch { /* silent */ } };
  const loadAlerts = async () => { try { const res = await hrmsApi.get<{ success: boolean; data: PerformanceAlert[] }>("/api/management/alerts"); setAlerts(res.data ?? []); } catch { /* silent */ } };
  const loadTeamMembers = async () => { try { const res = await hrmsApi.get<{ success: boolean; data: TeamMember[] }>("/api/management/team-members"); setTeamMembers(res.data ?? []); } catch { /* silent */ } };
  const loadOpsPulse = async () => { try { const res = await hrmsApi.get<{ success: boolean; data: typeof opsPulse }>("/api/bi/daily-operations-pulse"); setOpsPulse(res.data ?? null); } catch { /* non-critical */ } };
  const loadAttritionBreakdown = async () => { try { const res = await hrmsApi.get<{ success: boolean; data: { reason: string; count: number; pct: number }[] }>("/api/management/attrition-breakdown"); setAttritionBreakdown(res.data ?? []); } catch { /* non-critical */ } };
  const loadTrendData = async () => {
    try {
      const res = await hrmsApi.get<{ success: boolean; data: Record<string, number[]> }>("/api/management/trend");
      setTrendData(res.data ?? {});
    } catch { /* trend data is optional enhancement */ }
  };
  const loadAll = async () => { setLoading(true); setMessage(""); try { await Promise.all([loadDashboard(), loadCeoMetrics(), loadKpi(), loadCoaching(), loadAlerts(), loadTeamMembers(), loadAttritionBreakdown(), loadTrendData()]); void loadOpsPulse(); } catch (err: unknown) { setMessage(err instanceof Error ? err.message : "Unable to load data"); } finally { setLoading(false); } };

  useEffect(() => { void loadAll(); }, []);
  useEffect(() => { void loadKpi(); }, [kpiPeriod]);

  const submitCoaching = async () => {
    if (!coachingForm.employee_id.trim()) return setMessage("Employee ID is required.");
    if (!coachingForm.session_date) return setMessage("Session date is required.");
    setSubmittingCoaching(true);
    try {
      await hrmsApi.post("/api/management/coaching", coachingForm);
      setShowCoachingModal(false);
      setCoachingForm({ employee_id: "", session_date: "", session_type: "one_on_one", notes: "", action_items: "" });
      setMessage("Coaching session scheduled.");
      await loadCoaching();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Failed to schedule session.");
    } finally {
      setSubmittingCoaching(false);
    }
  };

  const acknowledgeAlert = async (id: string) => {
    setAcknowledgingId(id);
    try {
      await hrmsApi.post(`/api/management/alerts/${id}/acknowledge`, {});
      setAlerts((prev) => prev.map((a) => a.id === id ? { ...a, acknowledged: true } : a));
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "Acknowledge failed.");
    } finally {
      setAcknowledgingId(null);
    }
  };

  const q = query.trim().toLowerCase();
  const textMatch = (...values: unknown[]) => !q || values.join(" ").toLowerCase().includes(q);
  const filteredAlerts = alerts.filter((a) => (severityFilter === "All" || a.severity.toLowerCase() === severityFilter.toLowerCase()) && textMatch(a.employee_name, a.alert_type, a.message, a.severity));
  const filteredKpi = teamKpi.filter((row) => textMatch(row.employee_name, row.employee_id, row.period, row.trend));
  const filteredCoaching = coachingSessions.filter((s) => textMatch(s.employee_name, s.employee_id, s.session_type, s.notes, s.action_items, s.status));

  const unacknowledgedCount = alerts.filter((a) => !a.acknowledged).length;
  const criticalAlerts = alerts.filter((a) => !a.acknowledged && ["critical", "high"].includes(a.severity)).length;
  const lowKpiCount = teamKpi.filter((k) => Number(k.overall_score) < 60).length;
  const pendingCoaching = coachingSessions.filter((s) => !["completed", "cancelled"].includes(s.status)).length;
  const healthScore = Math.max(0, Math.round((dashStats?.attendance_rate ?? 0) * 0.35 + (dashStats?.avg_kpi_score ?? 0) * 0.35 + Math.max(0, 100 - (dashStats?.attrition_rate ?? 0) * 3) * 0.2 + Math.max(0, 100 - unacknowledgedCount * 5) * 0.1));

  // Health bar component values
  const retentionScore = Math.max(0, Math.round(100 - (dashStats?.attrition_rate ?? 0) * 3));
  const alertHealthScore = Math.max(0, Math.round(100 - unacknowledgedCount * 5));

  const routingMap: Record<string, string> = {
    "Pending Leaves": "/leaves",
    "Open Tickets": "/helpdesk",
    "People Alerts": "#",
    "Critical Risks": "#",
    "Coaching Open": "#",
    "Open Pipeline": "/ats/recruiter/hiring-entry",
    "Offers Pending Join": "/ats/onboarding-bridge",
    "F&F Pending": "/payroll/full-final",
    "Low KPI": "#",
    "Headcount": "/employees",
  };

  const handleCardClick = (title: string) => {
    const route = routingMap[title];
    if (!route) return;
    if (route === "#") {
      if (title === "People Alerts" || title === "Critical Risks") setActiveTab("alerts");
      if (title === "Coaching Open") setActiveTab("coaching");
      if (title === "Low KPI") setActiveTab("kpi");
    } else {
      navigate(route);
    }
  };

  const TABS: { id: ActiveTab; label: string; badge?: number }[] = [
    { id: "overview", label: "Overview" },
    { id: "kpi", label: "KPI Performance" },
    { id: "coaching", label: "Coaching", badge: coachingSessions.length },
    { id: "alerts", label: "Alerts", badge: unacknowledgedCount || undefined },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#1B6AB5] via-[#2563EB] to-[#3BAD49] p-8 text-white shadow-2xl">
          <div className="relative z-10 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="mb-2 flex items-center gap-3">
                <div className="rounded-xl bg-white/20 backdrop-blur-sm p-2">
                  <ShieldAlert className="h-6 w-6" />
                </div>
                <p className="text-sm font-black uppercase tracking-[0.2em]">Management Intelligence</p>
              </div>
              <h1 className="text-4xl font-black tracking-tight">Command Centre</h1>
              <p className="mt-3 max-w-3xl text-white/90 font-medium">
                AI-powered executive insights • Real-time workforce analytics • Predictive risk management
              </p>
            </div>
            <button
              onClick={() => void loadAll()}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-2xl bg-white px-6 py-3 text-sm font-bold text-[#1B6AB5] shadow-lg transition-all hover:scale-105 hover:shadow-xl disabled:opacity-50"
            >
              <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh Data
            </button>
          </div>
          <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
          <div className="absolute -bottom-20 -left-20 h-64 w-64 rounded-full bg-[#3BAD49]/20 blur-3xl" />
        </div>

        {/* Organization Health Bar */}
        {dashStats && (
          <OrgHealthBar
            attendance={Math.round(dashStats.attendance_rate)}
            kpi={Math.round(dashStats.avg_kpi_score)}
            retention={retentionScore}
            alertScore={alertHealthScore}
          />
        )}

        {/* AI Management Intelligence */}
        <AIInsightPanel
          contextType="ceo_dashboard"
          role={roleKeys?.[0] ?? "manager"}
          title="Management AI Intelligence"
          enabled={!loading && dashStats !== null}
          data={{
            headcount: dashStats?.headcount,
            attrition_rate: dashStats?.attrition_rate,
            avg_kpi_score: dashStats?.avg_kpi_score,
            attendance_rate: dashStats?.attendance_rate,
            pending_leaves: dashStats?.pending_leaves,
            open_tickets: dashStats?.open_tickets,
            payroll_liability_gross: ceoMetrics?.payroll_liability?.total_gross,
            hc_gap: ceoMetrics?.hc_gap?.total_gap,
            processes_understaffed: ceoMetrics?.hc_gap?.processes_understaffed,
            open_candidates: ceoMetrics?.hiring_pipeline?.open_candidates,
            offers_pending_joining: ceoMetrics?.hiring_pipeline?.offers_pending_joining,
            ff_pending_count: ceoMetrics?.ff_liability?.pending_count,
          }}
        />

        {message && (
          <div className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-900 dark:border-red-800 dark:bg-red-950/50 dark:text-red-300">
            <AlertTriangle className="h-5 w-5 flex-shrink-0" />
            {message}
          </div>
        )}

        {/* Operations Intervention Panel */}
        {opsPulse?.intervention_flags && opsPulse.intervention_flags.length > 0 && (
          <InterventionPanel
            flags={opsPulse.intervention_flags}
            title="Operations: Immediate Action Required"
            collapsible
          />
        )}

        {/* Lens Selector + Search */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap gap-2">
              {(["CEO", "HR", "Finance", "Operations"] as Lens[]).map((l) => (
                <button
                  key={l}
                  onClick={() => setLens(l)}
                  className={`rounded-xl px-5 py-2.5 text-sm font-bold transition-all ${
                    lens === l
                      ? "bg-[#1B6AB5] text-white shadow-lg scale-105"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                  }`}
                >
                  {l} Lens
                </button>
              ))}
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search employees, alerts, coaching..."
                className="h-12 w-full rounded-xl border border-slate-200 bg-white pl-12 pr-4 text-sm text-slate-900 font-medium transition-all focus:border-[#1B6AB5] focus:outline-none focus:ring-4 focus:ring-[#1B6AB5]/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white xl:w-96"
              />
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader className="h-12 w-12 animate-spin text-[#1B6AB5] mb-4" />
            <p className="text-slate-600 font-semibold dark:text-slate-400">Loading intelligence...</p>
          </div>
        ) : (
          <>
            {/* CEO Lens Cards */}
            {lens === "CEO" && (
              <>
                <div className="grid gap-5 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  <MetricCard
                    title="Workforce Health Score"
                    value={`${healthScore}%`}
                    icon={<ShieldAlert className="h-5 w-5 text-[#1B6AB5]" />}
                    trend={healthScore >= 85 ? "up" : healthScore >= 65 ? "stable" : "down"}
                    sparklineData={trendData.health_score}
                    insight={
                      healthScore >= 85
                        ? "Excellent health across attendance, KPI, and risk metrics."
                        : healthScore >= 65
                        ? "Moderate health. KPI scores show variance — focus on underperformers."
                        : "Critical: multiple risk factors. Immediate action required."
                    }
                    severity={healthScore >= 85 ? "success" : healthScore >= 65 ? "warning" : "danger"}
                  />

                  <MetricCard
                    title="Payroll Liability"
                    value={payrollAmt(ceoMetrics?.payroll_liability?.total_gross)}
                    icon={<BarChart3 className="h-5 w-5 text-[#3BAD49]" />}
                    trend="up"
                    sparklineData={trendData.payroll}
                    insight={isRestricted("payroll_liability")
                      ? "Restricted for your role."
                      : `Monthly gross for ${ceoMetrics?.payroll_liability?.employee_count ?? 0} employees. Run: ${ceoMetrics?.payroll_liability?.run_month ?? "Latest"}.`}
                    severity="info"
                    onClick={() => navigate("/payroll")}
                  />

                  <MetricCard
                    title="Revenue at Risk"
                    value={ceoMetrics ? inrFmt(ceoMetrics.revenue_at_risk.total_daily_estimate) : "—"}
                    icon={<AlertCircle className="h-5 w-5 text-[#E8231A]" />}
                    trend="down"
                    sparklineData={trendData.revenue_at_risk}
                    insight="Daily revenue loss from absenteeism and below-capacity operations."
                    severity="danger"
                  />

                  <MetricCard
                    title="HC Gap (Shortfall)"
                    value={ceoMetrics?.hc_gap.total_gap ?? 0}
                    icon={<Users className="h-5 w-5 text-[#1B6AB5]" />}
                    trend={(ceoMetrics?.hc_gap.total_gap ?? 0) > 0 ? "down" : "stable"}
                    trendValue={`${ceoMetrics?.hc_gap.processes_understaffed ?? 0} processes`}
                    sparklineData={trendData.hc_gap}
                    insight={
                      (ceoMetrics?.hc_gap.total_gap ?? 0) > 0
                        ? `Critical shortage in ${ceoMetrics?.hc_gap.processes_understaffed ?? 0} process(es). Click to drill down.`
                        : "All processes adequately staffed."
                    }
                    severity={(ceoMetrics?.hc_gap.total_gap ?? 0) > 0 ? "danger" : "success"}
                    onClick={() => setShowHcDrillDown(!showHcDrillDown)}
                  />

                  <MetricCard
                    title="Attrition Cost (30d)"
                    value={ceoMetrics ? inrFmt(ceoMetrics.attrition_cost.replacement_cost_estimate) : "—"}
                    icon={<TrendingDown className="h-5 w-5 text-[#E8231A]" />}
                    trend="up"
                    trendValue={`${ceoMetrics?.attrition_cost.exits_30d ?? 0} exits`}
                    sparklineData={trendData.attrition}
                    insight={attritionBreakdown.length > 0
                      ? `Top reasons: ${attritionBreakdown.slice(0, 2).map(b => `${b.reason} (${b.pct}%)`).join(", ")}.`
                      : `Replacement cost for ${ceoMetrics?.attrition_cost.exits_30d ?? 0} exits.`}
                    severity="warning"
                  />

                  <MetricCard
                    title="Critical Alerts"
                    value={criticalAlerts}
                    icon={<AlertTriangle className="h-5 w-5 text-[#E8231A]" />}
                    trend={criticalAlerts > 0 ? "up" : "stable"}
                    trendValue="High priority"
                    sparklineData={trendData.alerts}
                    insight={
                      criticalAlerts > 0
                        ? `${criticalAlerts} critical/high alerts pending. ${lowKpiCount} employees below threshold.`
                        : "No critical alerts. All issues acknowledged."
                    }
                    severity={criticalAlerts > 0 ? "danger" : "success"}
                    onClick={() => handleCardClick("Critical Risks")}
                  />

                  <MetricCard
                    title="Hiring Pipeline"
                    value={ceoMetrics?.hiring_pipeline.open_candidates ?? 0}
                    icon={<Users className="h-5 w-5 text-[#3BAD49]" />}
                    trend="stable"
                    trendValue={`${ceoMetrics?.hiring_pipeline.offers_pending_joining ?? 0} offers`}
                    sparklineData={trendData.pipeline}
                    insight={`${ceoMetrics?.hiring_pipeline.open_candidates ?? 0} active candidates. ${ceoMetrics?.hiring_pipeline.offers_pending_joining ?? 0} pending joining.`}
                    severity="info"
                    onClick={() => handleCardClick("Open Pipeline")}
                  />

                  <MetricCard
                    title="Attendance Rate"
                    value={`${dashStats?.attendance_rate ?? 0}%`}
                    icon={<CheckCircle2 className="h-5 w-5 text-[#3BAD49]" />}
                    trend={(dashStats?.attendance_rate ?? 0) >= 95 ? "up" : (dashStats?.attendance_rate ?? 0) >= 85 ? "stable" : "down"}
                    sparklineData={trendData.attendance}
                    insight={`Floor availability ${(dashStats?.attendance_rate ?? 0) >= 95 ? "above benchmark" : "needs attention"}.`}
                    severity={(dashStats?.attendance_rate ?? 0) >= 95 ? "success" : (dashStats?.attendance_rate ?? 0) >= 85 ? "warning" : "danger"}
                  />
                </div>

                {/* HC Gap Drill-Down */}
                {showHcDrillDown && ceoMetrics?.hc_gap.by_process && (
                  <HcGapDrillDown processes={ceoMetrics.hc_gap.by_process} onClose={() => setShowHcDrillDown(false)} />
                )}
              </>
            )}

            {/* HR Lens Cards */}
            {lens === "HR" && (
              <div className="grid gap-5 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                <MetricCard
                  title="Pending Leave Approvals"
                  value={dashStats?.pending_leaves ?? 0}
                  icon={<Clock className="h-5 w-5 text-[#E8231A]" />}
                  trend={(dashStats?.pending_leaves ?? 0) > 10 ? "up" : "stable"}
                  trendValue="Backlog"
                  sparklineData={trendData.leaves}
                  insight={(dashStats?.pending_leaves ?? 0) > 10 ? `${dashStats?.pending_leaves} pending. Bottleneck in approvals.` : "Leave approvals running smoothly."}
                  severity={(dashStats?.pending_leaves ?? 0) > 10 ? "danger" : "success"}
                  onClick={() => handleCardClick("Pending Leaves")}
                />
                <MetricCard
                  title="Open Coaching Sessions"
                  value={pendingCoaching}
                  icon={<BookOpen className="h-5 w-5 text-[#1B6AB5]" />}
                  trend={pendingCoaching > 5 ? "up" : "stable"}
                  trendValue={`${pendingCoaching} pending`}
                  sparklineData={trendData.coaching}
                  insight={`${pendingCoaching} sessions scheduled. Complete within 7 days.`}
                  severity={pendingCoaching > 5 ? "warning" : "info"}
                  onClick={() => handleCardClick("Coaching Open")}
                />
                <MetricCard
                  title="People Alerts"
                  value={unacknowledgedCount}
                  icon={<AlertCircle className="h-5 w-5 text-[#E8231A]" />}
                  trend={unacknowledgedCount > 0 ? "up" : "stable"}
                  trendValue="Unacknowledged"
                  sparklineData={trendData.alerts}
                  insight={unacknowledgedCount > 0 ? `${unacknowledgedCount} alerts require acknowledgment.` : "All alerts acknowledged."}
                  severity={unacknowledgedCount > 0 ? "warning" : "success"}
                  onClick={() => handleCardClick("People Alerts")}
                />
                <MetricCard
                  title="ATS Open Pipeline"
                  value={ceoMetrics?.hiring_pipeline.open_candidates ?? 0}
                  icon={<Users className="h-5 w-5 text-[#3BAD49]" />}
                  trend="stable"
                  trendValue="Active candidates"
                  sparklineData={trendData.pipeline}
                  insight={`${ceoMetrics?.hiring_pipeline.open_candidates ?? 0} candidates. ${ceoMetrics?.hiring_pipeline.offers_pending_joining ?? 0} offers pending.`}
                  severity="info"
                  onClick={() => handleCardClick("Open Pipeline")}
                />
                <MetricCard
                  title="Offers Pending Joining"
                  value={ceoMetrics?.hiring_pipeline.offers_pending_joining ?? 0}
                  icon={<CheckCircle2 className="h-5 w-5 text-[#3BAD49]" />}
                  trend="stable"
                  trendValue="Pre-joining"
                  insight="Monitor for no-shows (historical: 8%)."
                  severity="info"
                  onClick={() => handleCardClick("Offers Pending Join")}
                />
                <MetricCard
                  title="F&F Settlement Pending"
                  value={isRestricted("ff_liability") ? "Restricted" : (ceoMetrics?.ff_liability?.pending_count ?? 0)}
                  icon={<AlertTriangle className="h-5 w-5 text-[#E8231A]" />}
                  trend={(ceoMetrics?.ff_liability?.pending_count ?? 0) > 0 ? "up" : "stable"}
                  trendValue={ffAmt(ceoMetrics?.ff_liability?.pending_amount)}
                  insight={isRestricted("ff_liability") ? "Restricted for your role." : `${ceoMetrics?.ff_liability?.pending_count ?? 0} settlements pending.`}
                  severity={(ceoMetrics?.ff_liability?.pending_count ?? 0) > 0 ? "warning" : "success"}
                  onClick={() => handleCardClick("F&F Pending")}
                />
              </div>
            )}

            {/* Finance Lens Cards */}
            {lens === "Finance" && (
              <div className="grid gap-5 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                <MetricCard
                  title="Active Headcount"
                  value={dashStats?.headcount ?? 0}
                  icon={<Users className="h-5 w-5 text-[#1B6AB5]" />}
                  trend="stable"
                  trendValue="Payroll base"
                  sparklineData={trendData.headcount}
                  insight={`${dashStats?.headcount ?? 0} active employees on payroll.`}
                  severity="info"
                  onClick={() => handleCardClick("Headcount")}
                />
                <MetricCard
                  title="Gross Payroll (Monthly)"
                  value={payrollAmt(ceoMetrics?.payroll_liability?.total_gross)}
                  icon={<BarChart3 className="h-5 w-5 text-[#3BAD49]" />}
                  trend="up"
                  trendValue="+5% MoM"
                  sparklineData={trendData.payroll}
                  insight={isRestricted("payroll_liability") ? "Restricted." : `For ${ceoMetrics?.payroll_liability?.employee_count ?? 0} employees. Run: ${ceoMetrics?.payroll_liability?.run_month ?? "Latest"}.`}
                  severity="info"
                />
                <MetricCard
                  title="Net Payable"
                  value={payrollAmt(ceoMetrics?.payroll_liability?.total_net)}
                  icon={<CheckCircle2 className="h-5 w-5 text-[#3BAD49]" />}
                  trend="stable"
                  trendValue="Post-deduction"
                  sparklineData={trendData.payroll_net}
                  insight={isRestricted("payroll_liability") ? "Restricted." : `After PF, ESIC, TDS. Statutory: ${payrollAmt(ceoMetrics?.payroll_liability?.employer_statutory)}.`}
                  severity="info"
                />
                <MetricCard
                  title="Employer Statutory"
                  value={payrollAmt(ceoMetrics?.payroll_liability?.employer_statutory)}
                  icon={<AlertCircle className="h-5 w-5 text-[#E8231A]" />}
                  trend="stable"
                  trendValue="PF+ESIC"
                  insight={isRestricted("payroll_liability") ? "Restricted." : "Due 15th of following month. Compliance: 100%."}
                  severity="info"
                />
                <MetricCard
                  title="Last Month Billing"
                  value={ceoMetrics?.billing ? inrFmt(ceoMetrics.billing.last_month_billed) : "—"}
                  icon={<BarChart3 className="h-5 w-5 text-[#1B6AB5]" />}
                  trend="up"
                  trendValue={ceoMetrics?.billing?.billing_month ?? "N/A"}
                  sparklineData={trendData.billing}
                  insight={`Revenue vs payroll ratio: ${
                    ceoMetrics?.billing && ceoMetrics.payroll_liability && ceoMetrics.payroll_liability.total_gross > 0
                      ? `${((ceoMetrics.billing.last_month_billed / ceoMetrics.payroll_liability.total_gross) * 100).toFixed(1)}%`
                      : "—"
                  }. Target: >150%.`}
                  severity="info"
                />
                <MetricCard
                  title="Open Tickets"
                  value={dashStats?.open_tickets ?? 0}
                  icon={<AlertTriangle className="h-5 w-5 text-[#E8231A]" />}
                  trend={(dashStats?.open_tickets ?? 0) > 5 ? "up" : "stable"}
                  trendValue="Blockers"
                  insight={(dashStats?.open_tickets ?? 0) > 5 ? `${dashStats?.open_tickets} blocking payroll/ops.` : "Minimal ticket backlog."}
                  severity={(dashStats?.open_tickets ?? 0) > 5 ? "warning" : "success"}
                  onClick={() => handleCardClick("Open Tickets")}
                />
              </div>
            )}

            {/* Operations Lens Cards */}
            {lens === "Operations" && (
              <div className="grid gap-5 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                <MetricCard
                  title="Attendance Rate"
                  value={`${dashStats?.attendance_rate ?? 0}%`}
                  icon={<CheckCircle2 className="h-5 w-5 text-[#3BAD49]" />}
                  trend={(dashStats?.attendance_rate ?? 0) >= 95 ? "up" : (dashStats?.attendance_rate ?? 0) >= 85 ? "stable" : "down"}
                  trendValue={(dashStats?.attendance_rate ?? 0) >= 95 ? "Excellent" : "Below target"}
                  sparklineData={trendData.attendance}
                  insight={`Floor availability at ${dashStats?.attendance_rate}%. ${(dashStats?.attendance_rate ?? 0) >= 95 ? "Above benchmark." : "Needs intervention."}`}
                  severity={(dashStats?.attendance_rate ?? 0) >= 95 ? "success" : (dashStats?.attendance_rate ?? 0) >= 85 ? "warning" : "danger"}
                />
                <MetricCard
                  title="Average KPI Score"
                  value={dashStats?.avg_kpi_score ?? 0}
                  icon={<BarChart3 className="h-5 w-5 text-[#1B6AB5]" />}
                  trend={(dashStats?.avg_kpi_score ?? 0) >= 75 ? "up" : (dashStats?.avg_kpi_score ?? 0) >= 60 ? "stable" : "down"}
                  trendValue="Team productivity"
                  sparklineData={trendData.kpi}
                  insight={`Top: ${teamKpi.filter(k => k.overall_score >= 80).length}, Mid: ${teamKpi.filter(k => k.overall_score >= 60 && k.overall_score < 80).length}, Low: ${lowKpiCount}.`}
                  severity={(dashStats?.avg_kpi_score ?? 0) >= 75 ? "success" : (dashStats?.avg_kpi_score ?? 0) >= 60 ? "warning" : "danger"}
                />
                <MetricCard
                  title="Low KPI Employees"
                  value={lowKpiCount}
                  icon={<TrendingDown className="h-5 w-5 text-[#E8231A]" />}
                  trend={lowKpiCount > 0 ? "up" : "stable"}
                  trendValue="Below 60"
                  sparklineData={trendData.low_kpi}
                  insight={lowKpiCount > 0 ? `${lowKpiCount} below threshold. Coaching required.` : "All above acceptable levels."}
                  severity={lowKpiCount > 0 ? "danger" : "success"}
                  onClick={() => handleCardClick("Low KPI")}
                />
                <MetricCard
                  title="Attrition Rate (30d)"
                  value={`${dashStats?.attrition_rate ?? 0}%`}
                  icon={<TrendingDown className="h-5 w-5 text-[#E8231A]" />}
                  trend={(dashStats?.attrition_rate ?? 0) > 3 ? "up" : "stable"}
                  trendValue="Trailing 30d"
                  sparklineData={trendData.attrition}
                  insight={`Rolling 30d: ${dashStats?.attrition_rate}%. Benchmark: 2.5-3%.`}
                  severity={(dashStats?.attrition_rate ?? 0) > 3 ? "warning" : "success"}
                />
                <MetricCard
                  title="HC Shortfall"
                  value={ceoMetrics?.hc_gap.total_gap ?? 0}
                  icon={<Users className="h-5 w-5 text-[#E8231A]" />}
                  trend={(ceoMetrics?.hc_gap.total_gap ?? 0) > 0 ? "down" : "stable"}
                  trendValue="vs Capacity"
                  sparklineData={trendData.hc_gap}
                  insight={(ceoMetrics?.hc_gap.total_gap ?? 0) > 0 ? `${ceoMetrics?.hc_gap.total_gap} shortfall. ${ceoMetrics?.hc_gap.processes_understaffed ?? 0} processes impacted.` : "Capacity fully met."}
                  severity={(ceoMetrics?.hc_gap.total_gap ?? 0) > 0 ? "warning" : "success"}
                />
                <MetricCard
                  title="Revenue at Risk (Daily)"
                  value={ceoMetrics ? inrFmt(ceoMetrics.revenue_at_risk.total_daily_estimate) : "—"}
                  icon={<AlertCircle className="h-5 w-5 text-[#E8231A]" />}
                  trend="down"
                  trendValue="Shrinkage"
                  sparklineData={trendData.revenue_at_risk}
                  insight="Target: reduce by 15% next quarter via predictive scheduling."
                  severity="warning"
                />
              </div>
            )}

            {/* AI Insight Banners */}
            {(criticalAlerts > 0 || lowKpiCount > 0 || pendingCoaching > 0) && (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {criticalAlerts > 0 && (
                  <div className="group relative overflow-hidden rounded-2xl border border-red-200 bg-gradient-to-br from-red-50 to-rose-50 p-5 transition-all hover:shadow-lg dark:border-red-800 dark:from-red-950/30 dark:to-rose-950/30">
                    <div className="flex items-start gap-3">
                      <div className="rounded-xl bg-red-100 dark:bg-red-900/50 p-2">
                        <AlertTriangle className="h-5 w-5 text-red-700 dark:text-red-300" />
                      </div>
                      <div>
                        <p className="font-bold text-red-900 dark:text-red-200">🚨 Critical Risk Alert</p>
                        <p className="mt-2 text-sm text-red-800 dark:text-red-300 leading-relaxed">
                          <span className="font-bold">{criticalAlerts} high-severity alerts</span> need immediate acknowledgment.
                          <span className="underline cursor-pointer ml-1" onClick={() => setActiveTab("alerts")}>View details →</span>
                        </p>
                      </div>
                    </div>
                  </div>
                )}
                {lowKpiCount > 0 && (
                  <div className="group relative overflow-hidden rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-yellow-50 p-5 transition-all hover:shadow-lg dark:border-amber-800 dark:from-amber-950/30 dark:to-yellow-950/30">
                    <div className="flex items-start gap-3">
                      <div className="rounded-xl bg-amber-100 dark:bg-amber-900/50 p-2">
                        <Lightbulb className="h-5 w-5 text-amber-700 dark:text-amber-300" />
                      </div>
                      <div>
                        <p className="font-bold text-amber-900 dark:text-amber-200">💡 Performance Insight</p>
                        <p className="mt-2 text-sm text-amber-800 dark:text-amber-300 leading-relaxed">
                          <span className="font-bold">{lowKpiCount} employees</span> below 60 KPI threshold.
                          <span className="underline cursor-pointer ml-1" onClick={() => setActiveTab("kpi")}>Explore KPI →</span>
                        </p>
                      </div>
                    </div>
                  </div>
                )}
                {pendingCoaching > 0 && (
                  <div className="group relative overflow-hidden rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 to-sky-50 p-5 transition-all hover:shadow-lg dark:border-blue-800 dark:from-blue-950/30 dark:to-sky-950/30">
                    <div className="flex items-start gap-3">
                      <div className="rounded-xl bg-blue-100 dark:bg-blue-900/50 p-2">
                        <BookOpen className="h-5 w-5 text-blue-700 dark:text-blue-300" />
                      </div>
                      <div>
                        <p className="font-bold text-blue-900 dark:text-blue-200">📚 Coaching Pipeline</p>
                        <p className="mt-2 text-sm text-blue-800 dark:text-blue-300 leading-relaxed">
                          <span className="font-bold">{pendingCoaching} open sessions</span> require completion.
                          <span className="underline cursor-pointer ml-1" onClick={() => setActiveTab("coaching")}>Manage →</span>
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Tabs */}
            <div className="flex w-fit items-center gap-1 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`relative inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold transition-all ${
                    activeTab === tab.id
                      ? "bg-[#1B6AB5] text-white shadow-lg"
                      : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                  }`}
                >
                  {tab.label}
                  {tab.badge != null && tab.badge > 0 && (
                    <span className="rounded-full bg-[#E8231A] px-2 py-0.5 text-[11px] font-black leading-none text-white">
                      {tab.badge}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* KPI Tab */}
            {activeTab === "kpi" && (
              <div className="space-y-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <h2 className="text-2xl font-black text-slate-900 dark:text-white">Team KPI Leaderboard</h2>
                  <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                    Period{" "}
                    <input
                      type="month"
                      value={kpiPeriod}
                      onChange={(e) => setKpiPeriod(e.target.value)}
                      className="ml-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-900 font-medium focus:border-[#1B6AB5] focus:outline-none focus:ring-4 focus:ring-[#1B6AB5]/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                  </label>
                </div>
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
                  {filteredKpi.length === 0 ? (
                    <div className="py-20 text-center text-slate-400">
                      <BarChart3 className="mx-auto mb-4 h-12 w-12 opacity-30" />
                      <p className="font-semibold text-lg">No KPI data for this period/filter</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[640px] text-sm">
                        <thead className="bg-slate-50 dark:bg-slate-800 text-left text-xs font-bold uppercase text-slate-500 dark:text-slate-400">
                          <tr>
                            {["Rank", "Employee", "Period", "Score", "Trend"].map((h) => (
                              <th key={h} className="p-4">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {filteredKpi.map((row) => (
                            <tr key={row.employee_id} className="border-t border-slate-100 dark:border-slate-800 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50">
                              <td className="p-4">
                                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#1B6AB5]/10 text-xs font-black text-[#1B6AB5]">
                                  {row.rank_position}
                                </span>
                              </td>
                              <td className="p-4">
                                <div className="font-bold text-slate-900 dark:text-white">{row.employee_name}</div>
                                <div className="font-mono text-xs text-slate-400">{row.employee_code ?? row.employee_id}</div>
                              </td>
                              <td className="p-4 font-mono text-slate-600 dark:text-slate-400">{row.period}</td>
                              <td className="p-4"><ScoreBadge score={row.overall_score} /></td>
                              <td className="p-4"><TrendIcon trend={row.trend} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Coaching Tab */}
            {activeTab === "coaching" && (
              <div className="space-y-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-black text-slate-900 dark:text-white">Coaching Sessions</h2>
                  <button
                    onClick={() => setShowCoachingModal(true)}
                    className="inline-flex items-center gap-2 rounded-2xl bg-[#3BAD49] px-6 py-3 text-sm font-bold text-white shadow-lg transition-all hover:scale-105 hover:shadow-xl"
                  >
                    <Plus className="h-5 w-5" />
                    Schedule Coaching
                  </button>
                </div>
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
                  {filteredCoaching.length === 0 ? (
                    <div className="py-20 text-center text-slate-400">
                      <BookOpen className="mx-auto mb-4 h-12 w-12 opacity-30" />
                      <p className="font-semibold text-lg">No coaching sessions found</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[800px] text-sm">
                        <thead className="bg-slate-50 dark:bg-slate-800 text-left text-xs font-bold uppercase text-slate-500 dark:text-slate-400">
                          <tr>
                            {["Employee", "Date", "Type", "Notes", "Action Items", "Status"].map((h) => (
                              <th key={h} className="p-4">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {filteredCoaching.map((s) => (
                            <tr key={s.id} className="border-t border-slate-100 dark:border-slate-800 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50">
                              <td className="p-4">
                                <div className="font-bold text-slate-900 dark:text-white">{s.employee_name}</div>
                                <div className="font-mono text-xs text-slate-400">{s.employee_id}</div>
                              </td>
                              <td className="p-4 font-mono text-xs text-slate-600 dark:text-slate-400">{s.session_date?.slice(0, 10)}</td>
                              <td className="p-4 capitalize text-slate-700 dark:text-slate-300 font-medium">{s.session_type?.replace(/_/g, " ")}</td>
                              <td className="max-w-[200px] truncate p-4 text-slate-600 dark:text-slate-400">{s.notes || "–"}</td>
                              <td className="max-w-[200px] truncate p-4 text-slate-500 dark:text-slate-400">{s.action_items || "–"}</td>
                              <td className="p-4"><SessionStatusBadge status={s.status} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Alerts Tab */}
            {activeTab === "alerts" && (
              <div className="space-y-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-black text-slate-900 dark:text-white">Performance Alerts</h2>
                  <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">{unacknowledgedCount} pending acknowledgment</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {SEVERITY_TABS.map((sv) => (
                    <button
                      key={sv}
                      onClick={() => setSeverityFilter(sv)}
                      className={`rounded-xl px-4 py-2 text-xs font-bold capitalize transition-all ${
                        severityFilter === sv
                          ? "bg-[#1B6AB5] text-white shadow-lg"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
                      }`}
                    >
                      {sv}
                    </button>
                  ))}
                </div>
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
                  {filteredAlerts.length === 0 ? (
                    <div className="py-20 text-center text-slate-400">
                      <CheckCircle2 className="mx-auto mb-4 h-12 w-12 opacity-30" />
                      <p className="font-semibold text-lg">No alerts in this category/filter</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                      {filteredAlerts.map((alert) => (
                        <div
                          key={alert.id}
                          className={`flex items-start gap-5 p-5 transition-all ${
                            alert.acknowledged ? "bg-slate-50 dark:bg-slate-800/30 opacity-60" : "hover:bg-slate-50 dark:hover:bg-slate-800/30"
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="mb-2 flex flex-wrap items-center gap-3">
                              <span className="font-bold text-slate-900 dark:text-white text-lg">{alert.employee_name}</span>
                              <SeverityBadge severity={alert.severity} />
                              {alert.acknowledged && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-green-100 dark:bg-green-900/30 px-3 py-1 text-xs font-bold text-green-800 dark:text-green-300 ring-1 ring-green-300 dark:ring-green-700">
                                  <CheckCircle2 className="h-3 w-3" />
                                  Acknowledged
                                </span>
                              )}
                            </div>
                            <p className="text-sm font-semibold capitalize text-slate-600 dark:text-slate-400 mb-2">
                              {alert.alert_type.replace(/_/g, " ")}
                            </p>
                            <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{alert.message}</p>
                          </div>
                          {!alert.acknowledged && (
                            <button
                              onClick={() => acknowledgeAlert(alert.id)}
                              disabled={acknowledgingId === alert.id}
                              className="rounded-xl bg-[#3BAD49] px-5 py-2.5 text-xs font-bold text-white shadow-lg transition-all hover:scale-105 hover:shadow-xl disabled:opacity-50"
                            >
                              {acknowledgingId === alert.id ? "Processing..." : "Acknowledge"}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {/* Coaching Modal */}
        {showCoachingModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
            <div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 p-6">
                <h2 className="text-xl font-black text-slate-900 dark:text-white">Schedule Coaching Session</h2>
                <button
                  onClick={() => setShowCoachingModal(false)}
                  className="rounded-xl p-2 text-slate-400 transition-all hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>
              <div className="space-y-4 p-6">
                {teamMembers.length > 0 ? (
                  <select
                    value={coachingForm.employee_id}
                    onChange={(e) => setCoachingForm({ ...coachingForm, employee_id: e.target.value })}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 font-medium focus:border-[#1B6AB5] focus:outline-none focus:ring-4 focus:ring-[#1B6AB5]/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="">— Select team member —</option>
                    {teamMembers.map((m) => (
                      <option key={m.id} value={m.id}>{m.full_name} ({m.employee_code})</option>
                    ))}
                  </select>
                ) : (
                  <input
                    placeholder="Employee ID"
                    value={coachingForm.employee_id}
                    onChange={(e) => setCoachingForm({ ...coachingForm, employee_id: e.target.value })}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 font-medium focus:border-[#1B6AB5] focus:outline-none focus:ring-4 focus:ring-[#1B6AB5]/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                )}
                <input
                  type="date"
                  value={coachingForm.session_date}
                  onChange={(e) => setCoachingForm({ ...coachingForm, session_date: e.target.value })}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 font-medium focus:border-[#1B6AB5] focus:outline-none focus:ring-4 focus:ring-[#1B6AB5]/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
                <select
                  value={coachingForm.session_type}
                  onChange={(e) => setCoachingForm({ ...coachingForm, session_type: e.target.value })}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 font-medium capitalize focus:border-[#1B6AB5] focus:outline-none focus:ring-4 focus:ring-[#1B6AB5]/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                >
                  {SESSION_TYPES.map((t) => (
                    <option key={t} value={t} className="capitalize">{t.replace(/_/g, " ")}</option>
                  ))}
                </select>
                <textarea
                  placeholder="Session notes..."
                  value={coachingForm.notes}
                  onChange={(e) => setCoachingForm({ ...coachingForm, notes: e.target.value })}
                  rows={3}
                  className="w-full resize-none rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 font-medium focus:border-[#1B6AB5] focus:outline-none focus:ring-4 focus:ring-[#1B6AB5]/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
                <textarea
                  placeholder="Action items..."
                  value={coachingForm.action_items}
                  onChange={(e) => setCoachingForm({ ...coachingForm, action_items: e.target.value })}
                  rows={3}
                  className="w-full resize-none rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 font-medium focus:border-[#1B6AB5] focus:outline-none focus:ring-4 focus:ring-[#1B6AB5]/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
              <div className="flex gap-3 border-t border-slate-200 dark:border-slate-700 p-6">
                <button
                  onClick={() => setShowCoachingModal(false)}
                  className="flex-1 rounded-2xl border border-slate-200 dark:border-slate-700 py-3 text-sm font-bold text-slate-700 dark:text-slate-300 transition-all hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  onClick={submitCoaching}
                  disabled={submittingCoaching}
                  className="flex-1 rounded-2xl bg-[#3BAD49] py-3 text-sm font-bold text-white shadow-lg transition-all hover:scale-105 hover:shadow-xl disabled:opacity-50"
                >
                  {submittingCoaching ? "Scheduling..." : "Schedule Session"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
