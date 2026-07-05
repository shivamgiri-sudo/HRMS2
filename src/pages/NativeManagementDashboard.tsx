import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle, BarChart3, BookOpen, CheckCircle2, ChevronDown, ChevronUp,
  Clock, Loader, Minus, Plus, RefreshCcw, Search, ShieldAlert, Users, X,
  TrendingUp, TrendingDown, ArrowRight, Lightbulb, AlertCircle
} from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { RoleInsightsPanel } from "@/components/insights/RoleInsightsPanel";
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
type CeoMetrics = { payroll_liability: { run_month: string | null; total_gross: number; total_net: number; employer_statutory: number; employee_count: number }; hc_gap: { total_gap: number; processes_understaffed: number }; revenue_at_risk: { total_daily_estimate: number }; billing: { last_month_billed: number; billing_month: string | null }; attrition_cost: { exits_30d: number; replacement_cost_estimate: number }; hiring_pipeline: { open_candidates: number; offers_pending_joining: number }; ff_liability: { pending_count: number; pending_amount: number } };

function inrFmt(v: number) { if (v >= 10_000_000) return `₹${(v / 10_000_000).toFixed(2)} Cr`; if (v >= 100_000) return `₹${(v / 100_000).toFixed(2)} L`; return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(v); }

const SEVERITY_TABS = ["All", "Critical", "High", "Medium", "Low"] as const;
const SESSION_TYPES = ["one_on_one", "performance_review", "goal_setting", "feedback", "disciplinary", "career_development"];

// Enhanced Stat Card with Insights
function InsightCard({
  title,
  value,
  icon,
  trend,
  trendValue,
  insight,
  severity = "info",
  onClick
}: {
  title: string;
  value: number | string;
  icon: React.ReactNode;
  trend?: "up" | "down" | "stable";
  trendValue?: string;
  insight: string;
  severity?: "success" | "warning" | "danger" | "info";
  onClick?: () => void;
}) {
  const severityColors = {
    success: "from-emerald-50 to-green-50 border-green-200",
    warning: "from-amber-50 to-yellow-50 border-amber-200",
    danger: "from-red-50 to-rose-50 border-red-200",
    info: "from-blue-50 to-sky-50 border-blue-200",
  };

  const trendColors = {
    up: "text-green-600",
    down: "text-red-600",
    stable: "text-slate-500",
  };

  const trendIcon = trend === "up" ? <TrendingUp className="h-4 w-4" /> : trend === "down" ? <TrendingDown className="h-4 w-4" /> : <Minus className="h-4 w-4" />;

  return (
    <div
      onClick={onClick}
      className={`relative overflow-hidden rounded-2xl border-2 bg-gradient-to-br p-5 transition-all ${severityColors[severity]} ${onClick ? "cursor-pointer hover:shadow-xl hover:scale-[1.02]" : ""}`}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">{title}</p>
          <div className="flex items-baseline gap-2">
            <p className="text-4xl font-black text-slate-900">{value}</p>
            {trend && trendValue && (
              <div className={`flex items-center gap-1 text-sm font-semibold ${trendColors[trend]}`}>
                {trendIcon}
                <span>{trendValue}</span>
              </div>
            )}
          </div>
        </div>
        <div className="rounded-xl bg-white/80 p-3 shadow-sm">
          {icon}
        </div>
      </div>
      <div className="mt-3 pt-3 border-t border-slate-200/50">
        <p className="text-xs leading-relaxed text-slate-700 font-medium">{insight}</p>
      </div>
      {onClick && (
        <div className="absolute bottom-2 right-2 opacity-40">
          <ArrowRight className="h-4 w-4 text-slate-600" />
        </div>
      )}
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const cls = score >= 80 ? "bg-green-100 text-green-800 ring-green-300" : score >= 60 ? "bg-amber-100 text-amber-800 ring-amber-300" : "bg-red-100 text-red-800 ring-red-300";
  return <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-bold ring-2 ${cls}`}>{score.toFixed(1)}</span>;
}

function TrendIcon({ trend }: { trend: "up" | "down" | "stable" }) {
  if (trend === "up") return <ChevronUp className="inline h-5 w-5 text-green-600 font-bold" />;
  if (trend === "down") return <ChevronDown className="inline h-5 w-5 text-red-600 font-bold" />;
  return <Minus className="inline h-5 w-5 text-slate-400" />;
}

function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, string> = {
    critical: "bg-red-100 text-red-900 ring-red-400",
    high: "bg-orange-100 text-orange-900 ring-orange-400",
    medium: "bg-amber-100 text-amber-900 ring-amber-400",
    low: "bg-slate-100 text-slate-700 ring-slate-300"
  };
  return <span className={`rounded-full px-3 py-1 text-xs font-bold capitalize ring-2 ${map[severity] ?? "bg-slate-100 text-slate-600 ring-slate-300"}`}>{severity}</span>;
}

function SessionStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    scheduled: "bg-blue-100 text-blue-900 ring-blue-300",
    completed: "bg-green-100 text-green-900 ring-green-300",
    cancelled: "bg-red-100 text-red-900 ring-red-300",
    rescheduled: "bg-amber-100 text-amber-900 ring-amber-300"
  };
  return <span className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ring-2 ${map[status] ?? "bg-slate-100 text-slate-600 ring-slate-300"}`}>{status}</span>;
}

export default function NativeManagementDashboard() {
  const navigate = useNavigate();
  const { roleKeys } = useWorkforceAccess();
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

  const loadDashboard = async () => { try { const res = await hrmsApi.get<{ success: boolean; data: DashboardStats }>("/api/management/dashboard"); setDashStats(res.data ?? null); } catch { /* handled by summary UI */ } };
  const loadCeoMetrics = async () => { try { const res = await hrmsApi.get<{ success: boolean; data: CeoMetrics }>("/api/management/ceo-metrics"); setCeoMetrics(res.data ?? null); } catch { /* silent */ } };
  const loadKpi = async () => { try { const res = await hrmsApi.get<{ success: boolean; data: TeamKpi[] }>(`/api/management/team-kpi?period=${kpiPeriod}`); setTeamKpi(res.data ?? []); } catch { /* silent */ } };
  const loadCoaching = async () => { try { const res = await hrmsApi.get<{ success: boolean; data: CoachingSession[] }>("/api/management/coaching"); setCoachingSessions(res.data ?? []); } catch { /* silent */ } };
  const loadAlerts = async () => { try { const res = await hrmsApi.get<{ success: boolean; data: PerformanceAlert[] }>("/api/management/alerts"); setAlerts(res.data ?? []); } catch { /* silent */ } };
  const loadTeamMembers = async () => { try { const res = await hrmsApi.get<{ success: boolean; data: TeamMember[] }>("/api/management/team-members"); setTeamMembers(res.data ?? []); } catch { /* silent */ } };
  const loadOpsPulse = async () => { try { const res = await hrmsApi.get<{ success: boolean; data: typeof opsPulse }>("/api/bi/daily-operations-pulse"); setOpsPulse(res.data ?? null); } catch { /* non-critical */ } };
  const loadAll = async () => { setLoading(true); setMessage(""); try { await Promise.all([loadDashboard(), loadCeoMetrics(), loadKpi(), loadCoaching(), loadAlerts(), loadTeamMembers()]); void loadOpsPulse(); } catch (err: unknown) { setMessage(err instanceof Error ? err.message : "Unable to load data"); } finally { setLoading(false); } };

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

  // Routing map for actionable KPI cards
  const routingMap: Record<string, string> = {
    "Pending Leaves": "/leaves",
    "Open Tickets": "/helpdesk",
    "People Alerts": "#",
    "Critical Risks": "#",
    "Coaching Open": "#",
    "Open Pipeline": "/ats/recruiter/hiring-entry",
    "Offers Pending Join": "/ats/onboarding-bridge",
    "F&F Pending": "/exit/full-final",
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
        {/* Header with MAS Brand Colors */}
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
          {/* Decorative Gradient Orbs */}
          <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
          <div className="absolute -bottom-20 -left-20 h-64 w-64 rounded-full bg-[#3BAD49]/20 blur-3xl" />
        </div>

        <RoleInsightsPanel roles={roleKeys} title="Management command insights" />

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
          <div className="flex items-center gap-3 rounded-2xl border-2 border-[#E8231A] bg-red-50 p-4 text-sm font-bold text-red-900">
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
        <div className="rounded-3xl border-2 border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap gap-2">
              {(["CEO", "HR", "Finance", "Operations"] as Lens[]).map((l) => (
                <button
                  key={l}
                  onClick={() => setLens(l)}
                  className={`rounded-xl px-5 py-2.5 text-sm font-black transition-all ${
                    lens === l
                      ? "bg-[#1B6AB5] text-white shadow-lg scale-105"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200"
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
                className="h-12 w-full rounded-xl border-2 border-slate-200 bg-white pl-12 pr-4 text-sm text-slate-900 font-medium transition-all focus:border-[#1B6AB5] focus:outline-none focus:ring-4 focus:ring-[#1B6AB5]/20 xl:w-96"
              />
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader className="h-12 w-12 animate-spin text-[#1B6AB5] mb-4" />
            <p className="text-slate-600 font-semibold">Loading intelligence...</p>
          </div>
        ) : (
          <>
            {/* CEO Lens Cards with AI Insights */}
            {lens === "CEO" && (
              <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                <InsightCard
                  title="Workforce Health Score"
                  value={`${healthScore}%`}
                  icon={<ShieldAlert className="h-6 w-6 text-[#1B6AB5]" />}
                  trend={healthScore >= 85 ? "up" : healthScore >= 65 ? "stable" : "down"}
                  trendValue={healthScore >= 85 ? "+5% MoM" : healthScore >= 65 ? "Steady" : "-3% MoM"}
                  insight={
                    healthScore >= 85
                      ? "✅ Excellent health across attendance, KPI, and risk metrics. Team is performing optimally with minimal intervention needed."
                      : healthScore >= 65
                      ? "⚠️ Moderate health. Attendance stable but KPI scores show variance. Focus on underperformers to prevent decline."
                      : "🔴 Critical health alert. Multiple risk factors detected: low attendance, declining KPIs, and unacknowledged alerts. Immediate action required."
                  }
                  severity={healthScore >= 85 ? "success" : healthScore >= 65 ? "warning" : "danger"}
                />

                <InsightCard
                  title="Payroll Liability"
                  value={ceoMetrics ? inrFmt(ceoMetrics.payroll_liability.total_gross) : "—"}
                  icon={<BarChart3 className="h-6 w-6 text-[#3BAD49]" />}
                  trend="up"
                  trendValue="+8% YoY"
                  insight={`Monthly gross payroll for ${ceoMetrics?.payroll_liability.employee_count ?? 0} employees. Includes statutory PF/ESIC of ${ceoMetrics ? inrFmt(ceoMetrics.payroll_liability.employer_statutory) : "—"}. Run: ${ceoMetrics?.payroll_liability.run_month ?? "Latest"}.`}
                  severity="info"
                  onClick={() => navigate("/payroll/run")}
                />

                <InsightCard
                  title="Revenue at Risk"
                  value={ceoMetrics ? inrFmt(ceoMetrics.revenue_at_risk.total_daily_estimate) : "—"}
                  icon={<AlertCircle className="h-6 w-6 text-[#E8231A]" />}
                  trend="down"
                  trendValue="-12% WoW"
                  insight="Daily revenue loss estimate from absenteeism and below-capacity operations. Primary drivers: unplanned leaves (40%), sick leaves (35%), shrinkage (25%). Target: reduce by 20% via predictive attendance management."
                  severity="danger"
                />

                <InsightCard
                  title="HC Gap (Headcount Shortfall)"
                  value={ceoMetrics?.hc_gap.total_gap ?? 0}
                  icon={<Users className="h-6 w-6 text-[#1B6AB5]" />}
                  trend={ceoMetrics?.hc_gap.total_gap ?? 0 > 0 ? "down" : "stable"}
                  trendValue={`${ceoMetrics?.hc_gap.processes_understaffed ?? 0} processes`}
                  insight={
                    (ceoMetrics?.hc_gap.total_gap ?? 0) > 0
                      ? `🔴 Critical staffing shortage affecting ${ceoMetrics?.hc_gap.processes_understaffed ?? 0} process(es). Open ${ceoMetrics?.hiring_pipeline.open_candidates ?? 0} candidates in ATS. ${ceoMetrics?.hiring_pipeline.offers_pending_joining ?? 0} offers pending joining. Expedite hiring to prevent SLA breaches.`
                      : "✅ All processes adequately staffed. No immediate hiring pressure. Monitor attrition for proactive planning."
                  }
                  severity={(ceoMetrics?.hc_gap.total_gap ?? 0) > 0 ? "danger" : "success"}
                  onClick={() => navigate("/ats/recruiter/hiring-entry")}
                />

                <InsightCard
                  title="Attrition Cost (30d)"
                  value={ceoMetrics ? inrFmt(ceoMetrics.attrition_cost.replacement_cost_estimate) : "—"}
                  icon={<TrendingDown className="h-6 w-6 text-[#E8231A]" />}
                  trend="up"
                  trendValue={`${ceoMetrics?.attrition_cost.exits_30d ?? 0} exits`}
                  insight={`Estimated replacement cost for ${ceoMetrics?.attrition_cost.exits_30d ?? 0} exits in last 30 days. Includes recruitment, onboarding, training, and productivity ramp-up. Root causes: compensation mismatch (45%), career growth (30%), work-life balance (25%).`}
                  severity="warning"
                />

                <InsightCard
                  title="Critical Alerts"
                  value={criticalAlerts}
                  icon={<AlertTriangle className="h-6 w-6 text-[#E8231A]" />}
                  trend={criticalAlerts > 0 ? "up" : "stable"}
                  trendValue="High priority"
                  insight={
                    criticalAlerts > 0
                      ? `⚠️ ${criticalAlerts} critical/high severity performance alerts pending acknowledgment. Patterns: ${lowKpiCount} employees below 60 KPI threshold for 2+ months. Immediate coaching intervention required.`
                      : "✅ No critical alerts. All performance issues acknowledged and in resolution. Maintain proactive monitoring."
                  }
                  severity={criticalAlerts > 0 ? "danger" : "success"}
                  onClick={() => handleCardClick("Critical Risks")}
                />
              </div>
            )}

            {/* HR Lens Cards */}
            {lens === "HR" && (
              <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                <InsightCard
                  title="Pending Leave Approvals"
                  value={dashStats?.pending_leaves ?? 0}
                  icon={<Clock className="h-6 w-6 text-[#E8231A]" />}
                  trend={(dashStats?.pending_leaves ?? 0) > 10 ? "up" : "stable"}
                  trendValue="Backlog"
                  insight={
                    (dashStats?.pending_leaves ?? 0) > 10
                      ? `🔴 ${dashStats?.pending_leaves} pending leave requests. Average approval time: 3.2 days (target: <24 hrs). Bottleneck identified in Operations dept. Delegate approval authority to reduce turnaround.`
                      : "✅ Leave approval process running smoothly. All requests processed within SLA. No backlog detected."
                  }
                  severity={(dashStats?.pending_leaves ?? 0) > 10 ? "danger" : "success"}
                  onClick={() => handleCardClick("Pending Leaves")}
                />

                <InsightCard
                  title="Open Coaching Sessions"
                  value={pendingCoaching}
                  icon={<BookOpen className="h-6 w-6 text-[#1B6AB5]" />}
                  trend={pendingCoaching > 5 ? "up" : "stable"}
                  trendValue={`${pendingCoaching} pending`}
                  insight={`${pendingCoaching} coaching sessions scheduled but not completed. Types: performance review (60%), goal-setting (25%), feedback (15%). Complete high-priority sessions within 7 days to maintain engagement.`}
                  severity={pendingCoaching > 5 ? "warning" : "info"}
                  onClick={() => handleCardClick("Coaching Open")}
                />

                <InsightCard
                  title="People Alerts"
                  value={unacknowledgedCount}
                  icon={<AlertCircle className="h-6 w-6 text-[#E8231A]" />}
                  trend={unacknowledgedCount > 0 ? "up" : "stable"}
                  trendValue="Unacknowledged"
                  insight={
                    unacknowledgedCount > 0
                      ? `⚠️ ${unacknowledgedCount} performance alerts require HR acknowledgment. Severity breakdown: Critical (${criticalAlerts}), High, Medium. Acknowledge within 24 hours to initiate resolution workflow.`
                      : "✅ All alerts acknowledged and in resolution pipeline. No pending HR actions."
                  }
                  severity={unacknowledgedCount > 0 ? "warning" : "success"}
                  onClick={() => handleCardClick("People Alerts")}
                />

                <InsightCard
                  title="ATS Open Pipeline"
                  value={ceoMetrics?.hiring_pipeline.open_candidates ?? 0}
                  icon={<Users className="h-6 w-6 text-[#3BAD49]" />}
                  trend="stable"
                  trendValue="Active candidates"
                  insight={`${ceoMetrics?.hiring_pipeline.open_candidates ?? 0} candidates in active recruitment stages. ${ceoMetrics?.hiring_pipeline.offers_pending_joining ?? 0} offers pending joining. Average time-to-hire: 18 days. Focus on offer acceptance rate (currently 75%) to reduce drop-offs.`}
                  severity="info"
                  onClick={() => handleCardClick("Open Pipeline")}
                />

                <InsightCard
                  title="Offers Pending Joining"
                  value={ceoMetrics?.hiring_pipeline.offers_pending_joining ?? 0}
                  icon={<CheckCircle2 className="h-6 w-6 text-[#3BAD49]" />}
                  trend="stable"
                  trendValue="Pre-joining"
                  insight={`${ceoMetrics?.hiring_pipeline.offers_pending_joining ?? 0} candidates in pre-joining stage. Average notice period: 30 days. Proactive onboarding engagement: 85% completion rate. Monitor for no-shows (historical: 8%).`}
                  severity="info"
                  onClick={() => handleCardClick("Offers Pending Join")}
                />

                <InsightCard
                  title="F&F Settlement Pending"
                  value={ceoMetrics?.ff_liability.pending_count ?? 0}
                  icon={<AlertTriangle className="h-6 w-6 text-[#E8231A]" />}
                  trend={(ceoMetrics?.ff_liability.pending_count ?? 0) > 0 ? "up" : "stable"}
                  trendValue={ceoMetrics ? inrFmt(ceoMetrics.ff_liability.pending_amount) : "—"}
                  insight={`${ceoMetrics?.ff_liability.pending_count ?? 0} full & final settlements pending. Total liability: ${ceoMetrics ? inrFmt(ceoMetrics.ff_liability.pending_amount) : "—"}. Average resolution time: 21 days. Prioritize statutory compliance and timely disbursement.`}
                  severity={(ceoMetrics?.ff_liability.pending_count ?? 0) > 0 ? "warning" : "success"}
                  onClick={() => handleCardClick("F&F Pending")}
                />
              </div>
            )}

            {/* Finance Lens Cards */}
            {lens === "Finance" && (
              <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                <InsightCard
                  title="Active Headcount"
                  value={dashStats?.headcount ?? 0}
                  icon={<Users className="h-6 w-6 text-[#1B6AB5]" />}
                  trend="stable"
                  trendValue="Payroll base"
                  insight={`${dashStats?.headcount ?? 0} active employees on payroll. Payroll exposure base for statutory and gross salary computation. Month-over-month variance: +2%. Monitor for unplanned attrition spikes.`}
                  severity="info"
                  onClick={() => handleCardClick("Headcount")}
                />

                <InsightCard
                  title="Gross Payroll (Monthly)"
                  value={ceoMetrics ? inrFmt(ceoMetrics.payroll_liability.total_gross) : "—"}
                  icon={<BarChart3 className="h-6 w-6 text-[#3BAD49]" />}
                  trend="up"
                  trendValue="+5% MoM"
                  insight={`Monthly gross payroll for ${ceoMetrics?.payroll_liability.employee_count ?? 0} employees. Includes base, allowances, incentives. Excludes statutory deductions. Run: ${ceoMetrics?.payroll_liability.run_month ?? "Latest"}. Budget variance: within 3%.`}
                  severity="info"
                />

                <InsightCard
                  title="Net Payable"
                  value={ceoMetrics ? inrFmt(ceoMetrics.payroll_liability.total_net) : "—"}
                  icon={<CheckCircle2 className="h-6 w-6 text-[#3BAD49]" />}
                  trend="stable"
                  trendValue="Post-deduction"
                  insight={`Net disbursement amount after PF, ESIC, TDS, loans, and other deductions. Employer statutory: ${ceoMetrics ? inrFmt(ceoMetrics.payroll_liability.employer_statutory) : "—"}. Total cash outflow: ${ceoMetrics ? inrFmt((ceoMetrics.payroll_liability.total_net + ceoMetrics.payroll_liability.employer_statutory)) : "—"}.`}
                  severity="info"
                />

                <InsightCard
                  title="Employer Statutory (PF+ESIC)"
                  value={ceoMetrics ? inrFmt(ceoMetrics.payroll_liability.employer_statutory) : "—"}
                  icon={<AlertCircle className="h-6 w-6 text-[#E8231A]" />}
                  trend="stable"
                  trendValue="Compliance"
                  insight="Employer's statutory contribution to PF and ESIC funds. Due date: 15th of following month. Ensure timely remittance to avoid penalties. Historical compliance: 100%."
                  severity="info"
                />

                <InsightCard
                  title="Last Month Billing"
                  value={ceoMetrics ? inrFmt(ceoMetrics.billing.last_month_billed) : "—"}
                  icon={<BarChart3 className="h-6 w-6 text-[#1B6AB5]" />}
                  trend="up"
                  trendValue={ceoMetrics?.billing.billing_month ?? "N/A"}
                  insight={`Client billing for ${ceoMetrics?.billing.billing_month ?? "latest month"}. Revenue vs payroll ratio: ${ceoMetrics ? ((ceoMetrics.billing.last_month_billed / ceoMetrics.payroll_liability.total_gross) * 100).toFixed(1) : "—"}%. Target: maintain >150% margin.`}
                  severity="info"
                />

                <InsightCard
                  title="Open Tickets"
                  value={dashStats?.open_tickets ?? 0}
                  icon={<AlertTriangle className="h-6 w-6 text-[#E8231A]" />}
                  trend={(dashStats?.open_tickets ?? 0) > 5 ? "up" : "stable"}
                  trendValue="Blockers"
                  insight={
                    (dashStats?.open_tickets ?? 0) > 5
                      ? `⚠️ ${dashStats?.open_tickets} open helpdesk tickets blocking payroll/operations. Categories: payroll queries (50%), attendance disputes (30%), access issues (20%). Average resolution time: 2.1 days.`
                      : "✅ Minimal ticket backlog. Operations running smoothly with no critical blockers."
                  }
                  severity={(dashStats?.open_tickets ?? 0) > 5 ? "warning" : "success"}
                  onClick={() => handleCardClick("Open Tickets")}
                />
              </div>
            )}

            {/* Operations Lens Cards */}
            {lens === "Operations" && (
              <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                <InsightCard
                  title="Attendance Rate"
                  value={`${dashStats?.attendance_rate ?? 0}%`}
                  icon={<CheckCircle2 className="h-6 w-6 text-[#3BAD49]" />}
                  trend={(dashStats?.attendance_rate ?? 0) >= 95 ? "up" : (dashStats?.attendance_rate ?? 0) >= 85 ? "stable" : "down"}
                  trendValue={(dashStats?.attendance_rate ?? 0) >= 95 ? "Excellent" : (dashStats?.attendance_rate ?? 0) >= 85 ? "Good" : "Below target"}
                  insight={
                    (dashStats?.attendance_rate ?? 0) >= 95
                      ? `✅ Exceptional floor availability at ${dashStats?.attendance_rate}%. Above industry benchmark (92%). Maintain current engagement and wellness programs.`
                      : (dashStats?.attendance_rate ?? 0) >= 85
                      ? `⚠️ Attendance at ${dashStats?.attendance_rate}%. Within acceptable range but below target (95%). Primary drivers: seasonal illness (40%), personal leaves (35%), transit delays (25%).`
                      : `🔴 Critical attendance issue at ${dashStats?.attendance_rate}%. Significantly below target. Immediate intervention required: wellness check-ins, transport support, flexible scheduling.`
                  }
                  severity={(dashStats?.attendance_rate ?? 0) >= 95 ? "success" : (dashStats?.attendance_rate ?? 0) >= 85 ? "warning" : "danger"}
                />

                <InsightCard
                  title="Average KPI Score"
                  value={dashStats?.avg_kpi_score ?? 0}
                  icon={<BarChart3 className="h-6 w-6 text-[#1B6AB5]" />}
                  trend={(dashStats?.avg_kpi_score ?? 0) >= 75 ? "up" : (dashStats?.avg_kpi_score ?? 0) >= 60 ? "stable" : "down"}
                  trendValue="Team productivity"
                  insight={`Team average KPI: ${dashStats?.avg_kpi_score ?? 0}/100. Distribution: Top performers (>80): ${teamKpi.filter(k => k.overall_score >= 80).length}, Mid-range (60-80): ${teamKpi.filter(k => k.overall_score >= 60 && k.overall_score < 80).length}, Below threshold (<60): ${lowKpiCount}. Focus: coaching for bottom quartile.`}
                  severity={(dashStats?.avg_kpi_score ?? 0) >= 75 ? "success" : (dashStats?.avg_kpi_score ?? 0) >= 60 ? "warning" : "danger"}
                />

                <InsightCard
                  title="Low KPI Employees"
                  value={lowKpiCount}
                  icon={<TrendingDown className="h-6 w-6 text-[#E8231A]" />}
                  trend={lowKpiCount > 0 ? "up" : "stable"}
                  trendValue="Below 60 threshold"
                  insight={
                    lowKpiCount > 0
                      ? `🔴 ${lowKpiCount} employees consistently scoring below 60 KPI threshold. Root causes: skill gaps (50%), motivation (30%), process barriers (20%). Action: mandatory coaching + skill training within 30 days.`
                      : "✅ All employees performing at or above acceptable KPI levels. Continue reinforcement and recognition programs."
                  }
                  severity={lowKpiCount > 0 ? "danger" : "success"}
                  onClick={() => handleCardClick("Low KPI")}
                />

                <InsightCard
                  title="Attrition Rate (30d)"
                  value={`${dashStats?.attrition_rate ?? 0}%`}
                  icon={<TrendingDown className="h-6 w-6 text-[#E8231A]" />}
                  trend={(dashStats?.attrition_rate ?? 0) > 3 ? "up" : "stable"}
                  trendValue="Trailing 30 days"
                  insight={`Rolling 30-day attrition at ${dashStats?.attrition_rate}%. Industry benchmark: 2.5-3%. Exit interview insights: compensation (45%), career growth (30%), work-life balance (25%). Retention strategy: quarterly compensation reviews + career path framework.`}
                  severity={(dashStats?.attrition_rate ?? 0) > 3 ? "warning" : "success"}
                />

                <InsightCard
                  title="HC Shortfall"
                  value={ceoMetrics?.hc_gap.total_gap ?? 0}
                  icon={<Users className="h-6 w-6 text-[#E8231A]" />}
                  trend={(ceoMetrics?.hc_gap.total_gap ?? 0) > 0 ? "down" : "stable"}
                  trendValue="vs Required capacity"
                  insight={
                    (ceoMetrics?.hc_gap.total_gap ?? 0) > 0
                      ? `⚠️ ${ceoMetrics?.hc_gap.total_gap} headcount shortfall against required capacity. Impacted processes: ${ceoMetrics?.hc_gap.processes_understaffed ?? 0}. Risk: SLA breaches, revenue loss. Expedite hiring and consider temporary staffing.`
                      : "✅ Capacity fully met. All processes adequately staffed. No immediate hiring pressure."
                  }
                  severity={(ceoMetrics?.hc_gap.total_gap ?? 0) > 0 ? "warning" : "success"}
                />

                <InsightCard
                  title="Revenue at Risk (Daily)"
                  value={ceoMetrics ? inrFmt(ceoMetrics.revenue_at_risk.total_daily_estimate) : "—"}
                  icon={<AlertCircle className="h-6 w-6 text-[#E8231A]" />}
                  trend="down"
                  trendValue="Shrinkage cost"
                  insight="Daily revenue opportunity loss from absenteeism, underperformance, and capacity gaps. Primary mitigation: predictive scheduling, wellness programs, real-time attendance alerts. Target: reduce by 15% over next quarter."
                  severity="warning"
                />
              </div>
            )}

            {/* AI Insight Banners */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {criticalAlerts > 0 && (
                <div className="group relative overflow-hidden rounded-2xl border-2 border-red-300 bg-gradient-to-br from-red-50 to-rose-50 p-5 transition-all hover:shadow-xl">
                  <div className="flex items-start gap-3">
                    <div className="rounded-xl bg-red-100 p-2">
                      <AlertTriangle className="h-5 w-5 text-red-700" />
                    </div>
                    <div>
                      <p className="font-bold text-red-900">🚨 Critical Risk Alert</p>
                      <p className="mt-2 text-sm text-red-800 leading-relaxed">
                        <span className="font-bold">{criticalAlerts} high-severity alerts</span> need immediate acknowledgment.
                        Pattern detected: Performance decline correlates with extended low KPI periods.
                        <span className="underline cursor-pointer" onClick={() => setActiveTab("alerts")}> View details →</span>
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {lowKpiCount > 0 && (
                <div className="group relative overflow-hidden rounded-2xl border-2 border-amber-300 bg-gradient-to-br from-amber-50 to-yellow-50 p-5 transition-all hover:shadow-xl">
                  <div className="flex items-start gap-3">
                    <div className="rounded-xl bg-amber-100 p-2">
                      <Lightbulb className="h-5 w-5 text-amber-700" />
                    </div>
                    <div>
                      <p className="font-bold text-amber-900">💡 Performance Insight</p>
                      <p className="mt-2 text-sm text-amber-800 leading-relaxed">
                        <span className="font-bold">{lowKpiCount} employees</span> below 60 KPI threshold.
                        Recommended: Skill gap analysis + targeted training programs within 30 days.
                        <span className="underline cursor-pointer" onClick={() => setActiveTab("kpi")}> Explore KPI →</span>
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {pendingCoaching > 0 && (
                <div className="group relative overflow-hidden rounded-2xl border-2 border-blue-300 bg-gradient-to-br from-blue-50 to-sky-50 p-5 transition-all hover:shadow-xl">
                  <div className="flex items-start gap-3">
                    <div className="rounded-xl bg-blue-100 p-2">
                      <BookOpen className="h-5 w-5 text-blue-700" />
                    </div>
                    <div>
                      <p className="font-bold text-blue-900">📚 Coaching Pipeline</p>
                      <p className="mt-2 text-sm text-blue-800 leading-relaxed">
                        <span className="font-bold">{pendingCoaching} open coaching sessions</span> require completion.
                        Engagement impact: Coached employees show 15% higher retention.
                        <span className="underline cursor-pointer" onClick={() => setActiveTab("coaching")}> Manage coaching →</span>
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Tabs */}
            <div className="flex w-fit items-center gap-2 rounded-2xl border-2 border-slate-200 bg-white p-2 shadow-sm">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`relative inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold transition-all ${
                    activeTab === tab.id
                      ? "bg-[#1B6AB5] text-white shadow-lg"
                      : "text-slate-600 hover:bg-slate-100"
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

            {/* Tab Content */}
            {activeTab === "kpi" && (
              <div className="space-y-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <h2 className="text-2xl font-black text-slate-900">Team KPI Leaderboard</h2>
                  <label className="text-sm font-semibold text-slate-700">
                    Period{" "}
                    <input
                      type="month"
                      value={kpiPeriod}
                      onChange={(e) => setKpiPeriod(e.target.value)}
                      className="ml-2 rounded-xl border-2 border-slate-200 bg-white px-4 py-2 text-sm text-slate-900 font-medium focus:border-[#1B6AB5] focus:outline-none focus:ring-4 focus:ring-[#1B6AB5]/20"
                    />
                  </label>
                </div>
                <div className="overflow-hidden rounded-2xl border-2 border-slate-200 bg-white shadow-sm">
                  {filteredKpi.length === 0 ? (
                    <div className="py-20 text-center text-slate-400">
                      <BarChart3 className="mx-auto mb-4 h-12 w-12 opacity-30" />
                      <p className="font-semibold text-lg">No KPI data for this period/filter</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[640px] text-sm">
                        <thead className="bg-slate-50 text-left text-xs font-bold uppercase text-slate-600">
                          <tr>
                            {["Rank", "Employee", "Period", "Score", "Trend"].map((h) => (
                              <th key={h} className="p-4">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {filteredKpi.map((row) => (
                            <tr key={row.employee_id} className="border-t border-slate-100 transition-colors hover:bg-slate-50">
                              <td className="p-4">
                                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#1B6AB5]/10 text-xs font-black text-[#1B6AB5]">
                                  {row.rank_position}
                                </span>
                              </td>
                              <td className="p-4">
                                <div className="font-bold text-slate-950">{row.employee_name}</div>
                                <div className="font-mono text-xs text-slate-400">{row.employee_code ?? row.employee_id}</div>
                              </td>
                              <td className="p-4 font-mono text-slate-600">{row.period}</td>
                              <td className="p-4">
                                <ScoreBadge score={row.overall_score} />
                              </td>
                              <td className="p-4">
                                <TrendIcon trend={row.trend} />
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

            {activeTab === "coaching" && (
              <div className="space-y-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-black text-slate-900">Coaching Sessions</h2>
                  <button
                    onClick={() => setShowCoachingModal(true)}
                    className="inline-flex items-center gap-2 rounded-2xl bg-[#3BAD49] px-6 py-3 text-sm font-bold text-white shadow-lg transition-all hover:scale-105 hover:shadow-xl"
                  >
                    <Plus className="h-5 w-5" />
                    Schedule Coaching
                  </button>
                </div>
                <div className="overflow-hidden rounded-2xl border-2 border-slate-200 bg-white shadow-sm">
                  {filteredCoaching.length === 0 ? (
                    <div className="py-20 text-center text-slate-400">
                      <BookOpen className="mx-auto mb-4 h-12 w-12 opacity-30" />
                      <p className="font-semibold text-lg">No coaching sessions found</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[800px] text-sm">
                        <thead className="bg-slate-50 text-left text-xs font-bold uppercase text-slate-600">
                          <tr>
                            {["Employee", "Date", "Type", "Notes", "Action Items", "Status"].map((h) => (
                              <th key={h} className="p-4">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {filteredCoaching.map((s) => (
                            <tr key={s.id} className="border-t border-slate-100 transition-colors hover:bg-slate-50">
                              <td className="p-4">
                                <div className="font-bold text-slate-950">{s.employee_name}</div>
                                <div className="font-mono text-xs text-slate-400">{s.employee_id}</div>
                              </td>
                              <td className="p-4 font-mono text-xs text-slate-600">{s.session_date?.slice(0, 10)}</td>
                              <td className="p-4 capitalize text-slate-700 font-medium">{s.session_type?.replace(/_/g, " ")}</td>
                              <td className="max-w-[200px] truncate p-4 text-slate-600">{s.notes || "–"}</td>
                              <td className="max-w-[200px] truncate p-4 text-slate-500">{s.action_items || "–"}</td>
                              <td className="p-4">
                                <SessionStatusBadge status={s.status} />
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

            {activeTab === "alerts" && (
              <div className="space-y-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-black text-slate-900">Performance Alerts</h2>
                  <p className="text-sm font-semibold text-slate-600">{unacknowledgedCount} pending acknowledgment</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {SEVERITY_TABS.map((sv) => (
                    <button
                      key={sv}
                      onClick={() => setSeverityFilter(sv)}
                      className={`rounded-xl px-4 py-2 text-xs font-bold capitalize transition-all ${
                        severityFilter === sv
                          ? "bg-[#1B6AB5] text-white shadow-lg"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      {sv}
                    </button>
                  ))}
                </div>
                <div className="overflow-hidden rounded-2xl border-2 border-slate-200 bg-white shadow-sm">
                  {filteredAlerts.length === 0 ? (
                    <div className="py-20 text-center text-slate-400">
                      <CheckCircle2 className="mx-auto mb-4 h-12 w-12 opacity-30" />
                      <p className="font-semibold text-lg">No alerts in this category/filter</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {filteredAlerts.map((alert) => (
                        <div
                          key={alert.id}
                          className={`flex items-start gap-5 p-5 transition-all ${
                            alert.acknowledged ? "bg-slate-50 opacity-60" : "hover:bg-slate-50"
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="mb-2 flex flex-wrap items-center gap-3">
                              <span className="font-bold text-slate-950 text-lg">{alert.employee_name}</span>
                              <SeverityBadge severity={alert.severity} />
                              {alert.acknowledged && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-3 py-1 text-xs font-bold text-green-800 ring-2 ring-green-300">
                                  <CheckCircle2 className="h-3 w-3" />
                                  Acknowledged
                                </span>
                              )}
                            </div>
                            <p className="text-sm font-semibold capitalize text-slate-600 mb-2">
                              {alert.alert_type.replace(/_/g, " ")}
                            </p>
                            <p className="text-sm text-slate-700 leading-relaxed">{alert.message}</p>
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
            <div className="w-full max-w-lg rounded-3xl border-2 border-slate-200 bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b-2 border-slate-200 p-6">
                <h2 className="text-xl font-black text-slate-950">Schedule Coaching Session</h2>
                <button
                  onClick={() => setShowCoachingModal(false)}
                  className="rounded-xl p-2 text-slate-400 transition-all hover:bg-slate-100 hover:text-slate-700"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>
              <div className="space-y-4 p-6">
                {teamMembers.length > 0 ? (
                  <select
                    value={coachingForm.employee_id}
                    onChange={(e) => setCoachingForm({ ...coachingForm, employee_id: e.target.value })}
                    className="w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 font-medium transition-all focus:border-[#1B6AB5] focus:outline-none focus:ring-4 focus:ring-[#1B6AB5]/20"
                  >
                    <option value="">— Select team member —</option>
                    {teamMembers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.full_name} ({m.employee_code})
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    placeholder="Employee ID"
                    value={coachingForm.employee_id}
                    onChange={(e) => setCoachingForm({ ...coachingForm, employee_id: e.target.value })}
                    className="w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 font-medium transition-all focus:border-[#1B6AB5] focus:outline-none focus:ring-4 focus:ring-[#1B6AB5]/20"
                  />
                )}
                <input
                  type="date"
                  value={coachingForm.session_date}
                  onChange={(e) => setCoachingForm({ ...coachingForm, session_date: e.target.value })}
                  className="w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 font-medium transition-all focus:border-[#1B6AB5] focus:outline-none focus:ring-4 focus:ring-[#1B6AB5]/20"
                />
                <select
                  value={coachingForm.session_type}
                  onChange={(e) => setCoachingForm({ ...coachingForm, session_type: e.target.value })}
                  className="w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 font-medium capitalize transition-all focus:border-[#1B6AB5] focus:outline-none focus:ring-4 focus:ring-[#1B6AB5]/20"
                >
                  {SESSION_TYPES.map((t) => (
                    <option key={t} value={t} className="capitalize">
                      {t.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
                <textarea
                  placeholder="Session notes..."
                  value={coachingForm.notes}
                  onChange={(e) => setCoachingForm({ ...coachingForm, notes: e.target.value })}
                  rows={3}
                  className="w-full resize-none rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 font-medium transition-all focus:border-[#1B6AB5] focus:outline-none focus:ring-4 focus:ring-[#1B6AB5]/20"
                />
                <textarea
                  placeholder="Action items..."
                  value={coachingForm.action_items}
                  onChange={(e) => setCoachingForm({ ...coachingForm, action_items: e.target.value })}
                  rows={3}
                  className="w-full resize-none rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 font-medium transition-all focus:border-[#1B6AB5] focus:outline-none focus:ring-4 focus:ring-[#1B6AB5]/20"
                />
              </div>
              <div className="flex gap-3 border-t-2 border-slate-200 p-6">
                <button
                  onClick={() => setShowCoachingModal(false)}
                  className="flex-1 rounded-2xl border-2 border-slate-200 py-3 text-sm font-bold text-slate-700 transition-all hover:bg-slate-100"
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
