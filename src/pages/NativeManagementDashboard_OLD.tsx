import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, BarChart3, BookOpen, CheckCircle2, ChevronDown, ChevronUp, Clock, Loader, Minus, Plus, RefreshCcw, Search, ShieldAlert, Users, X } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { RoleInsightsPanel } from "@/components/insights/RoleInsightsPanel";
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

function StatCard({ title, value, icon, tone, suffix = "", sub, onClick }: { title: string; value: number | string; icon: React.ReactNode; tone: string; suffix?: string; sub?: string; onClick?: () => void }) {
  const baseClasses = "glass-card stat-card rounded-3xl p-5";
  const interactiveClasses = onClick ? "cursor-pointer hover:shadow-lg hover:scale-[1.02] transition-all" : "";
  return <div className={`${baseClasses} ${interactiveClasses}`} onClick={onClick}><div className="flex items-start justify-between gap-4"><div><p className="text-sm font-semibold text-slate-500">{title}</p><p className="mt-2 text-3xl font-black tracking-tight text-slate-950">{value}{suffix}</p>{sub && <p className="mt-1 text-xs font-semibold text-slate-400">{sub}</p>}</div><div className={`rounded-2xl p-3 ${tone}`}>{icon}</div></div></div>;
}
function ScoreBadge({ score }: { score: number }) { const cls = score >= 80 ? "bg-emerald-50 text-emerald-700" : score >= 60 ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700"; return <span className={`rounded-full px-3 py-1 text-xs font-bold ${cls}`}>{score.toFixed(1)}</span>; }
function TrendIcon({ trend }: { trend: "up" | "down" | "stable" }) { if (trend === "up") return <ChevronUp className="inline h-4 w-4 text-emerald-500" />; if (trend === "down") return <ChevronDown className="inline h-4 w-4 text-red-500" />; return <Minus className="inline h-4 w-4 text-slate-400" />; }
function SeverityBadge({ severity }: { severity: string }) { const map: Record<string, string> = { critical: "bg-red-100 text-red-800", high: "bg-orange-100 text-orange-800", medium: "bg-amber-100 text-amber-700", low: "bg-slate-100 text-slate-600" }; return <span className={`rounded-full px-2.5 py-1 text-xs font-bold capitalize ${map[severity] ?? "bg-slate-100 text-slate-600"}`}>{severity}</span>; }
function SessionStatusBadge({ status }: { status: string }) { const map: Record<string, string> = { scheduled: "bg-blue-50 text-blue-700", completed: "bg-emerald-50 text-emerald-700", cancelled: "bg-rose-50 text-rose-700", rescheduled: "bg-amber-50 text-amber-700" }; return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${map[status] ?? "bg-slate-100 text-slate-600"}`}>{status}</span>; }

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

  const loadDashboard = async () => { try { const res = await hrmsApi.get<{ success: boolean; data: DashboardStats }>("/api/management/dashboard"); setDashStats(res.data ?? null); } catch { /* handled by summary UI */ } };
  const loadCeoMetrics = async () => { try { const res = await hrmsApi.get<{ success: boolean; data: CeoMetrics }>("/api/management/ceo-metrics"); setCeoMetrics(res.data ?? null); } catch { /* silent */ } };
  const loadKpi = async () => { try { const res = await hrmsApi.get<{ success: boolean; data: TeamKpi[] }>(`/api/management/team-kpi?period=${kpiPeriod}`); setTeamKpi(res.data ?? []); } catch { /* silent */ } };
  const loadCoaching = async () => { try { const res = await hrmsApi.get<{ success: boolean; data: CoachingSession[] }>("/api/management/coaching"); setCoachingSessions(res.data ?? []); } catch { /* silent */ } };
  const loadAlerts = async () => { try { const res = await hrmsApi.get<{ success: boolean; data: PerformanceAlert[] }>("/api/management/alerts"); setAlerts(res.data ?? []); } catch { /* silent */ } };
  const loadTeamMembers = async () => { try { const res = await hrmsApi.get<{ success: boolean; data: TeamMember[] }>("/api/management/team-members"); setTeamMembers(res.data ?? []); } catch { /* silent */ } };
  const loadAll = async () => { setLoading(true); setMessage(""); try { await Promise.all([loadDashboard(), loadCeoMetrics(), loadKpi(), loadCoaching(), loadAlerts(), loadTeamMembers()]); } catch (err: unknown) { setMessage(err instanceof Error ? err.message : "Unable to load data"); } finally { setLoading(false); } };
  useEffect(() => { void loadAll(); }, []);
  useEffect(() => { void loadKpi(); }, [kpiPeriod]);

  const submitCoaching = async () => {
    if (!coachingForm.employee_id.trim()) return setMessage("Employee ID is required.");
    if (!coachingForm.session_date) return setMessage("Session date is required.");
    setSubmittingCoaching(true);
    try { await hrmsApi.post("/api/management/coaching", coachingForm); setShowCoachingModal(false); setCoachingForm({ employee_id: "", session_date: "", session_type: "one_on_one", notes: "", action_items: "" }); setMessage("Coaching session scheduled."); await loadCoaching(); }
    catch (err: unknown) { setMessage(err instanceof Error ? err.message : "Failed to schedule session."); }
    finally { setSubmittingCoaching(false); }
  };
  const acknowledgeAlert = async (id: string) => { setAcknowledgingId(id); try { await hrmsApi.post(`/api/management/alerts/${id}/acknowledge`, {}); setAlerts((prev) => prev.map((a) => a.id === id ? { ...a, acknowledged: true } : a)); } catch (err: unknown) { setMessage(err instanceof Error ? err.message : "Acknowledge failed."); } finally { setAcknowledgingId(null); } };

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
    "People Alerts": "#", // Internal tab switch
    "Critical Risks": "#", // Internal tab switch
    "Coaching Open": "#", // Internal tab switch
    "Open Pipeline": "/ats/recruiter",
    "Offers Pending Join": "/ats/onboarding-bridge",
    "F&F Pending": "/full-final",
    "Low KPI": "#", // Internal tab switch
    "Headcount": "/employees",
    "Gross Payroll": "/payroll/run",
    "Net Payable": "/payroll/run",
    "Employer PF+ESIC": "/payroll/statutory",
    "Last Billing": "/erp/billing",
  };

  const handleCardClick = (title: string) => {
    const route = routingMap[title];
    if (!route) return; // Non-actionable card
    if (route === "#") {
      // Internal tab switches
      if (title === "People Alerts" || title === "Critical Risks") setActiveTab("alerts");
      if (title === "Coaching Open") setActiveTab("coaching");
      if (title === "Low KPI") setActiveTab("kpi");
    } else {
      navigate(route);
    }
  };

  const lensCards: Record<Lens, { title: string; value: string | number; sub: string }[]> = {
    CEO: [
      { title: "Workforce Health", value: `${healthScore}%`, sub: "blended attendance/KPI/risk" },
      { title: "Payroll Liability", value: ceoMetrics ? inrFmt(ceoMetrics.payroll_liability.total_gross) : "—", sub: ceoMetrics?.payroll_liability.run_month ?? "latest run" },
      { title: "Revenue at Risk", value: ceoMetrics ? inrFmt(ceoMetrics.revenue_at_risk.total_daily_estimate) : "—", sub: "daily est. from absenteeism" },
      { title: "HC Gap", value: ceoMetrics?.hc_gap.total_gap ?? 0, sub: `${ceoMetrics?.hc_gap.processes_understaffed ?? 0} process(es)` },
      { title: "Attrition Cost", value: ceoMetrics ? inrFmt(ceoMetrics.attrition_cost.replacement_cost_estimate) : "—", sub: `${ceoMetrics?.attrition_cost.exits_30d ?? 0} exits (30d)` },
      { title: "Critical Risks", value: criticalAlerts, sub: "unacknowledged high/critical" },
    ],
    HR: [
      { title: "Pending Leaves", value: dashStats?.pending_leaves ?? 0, sub: "approval backlog" },
      { title: "Coaching Open", value: pendingCoaching, sub: "sessions not closed" },
      { title: "People Alerts", value: unacknowledgedCount, sub: "pending acknowledgement" },
      { title: "Open Pipeline", value: ceoMetrics?.hiring_pipeline.open_candidates ?? 0, sub: "ATS candidates active" },
      { title: "Offers Pending Join", value: ceoMetrics?.hiring_pipeline.offers_pending_joining ?? 0, sub: "offer accepted stage" },
      { title: "F&F Pending", value: ceoMetrics?.ff_liability.pending_count ?? 0, sub: `${ceoMetrics ? inrFmt(ceoMetrics.ff_liability.pending_amount) : "—"} liability` },
    ],
    Finance: [
      { title: "Headcount", value: dashStats?.headcount ?? 0, sub: "payroll exposure base" },
      { title: "Gross Payroll", value: ceoMetrics ? inrFmt(ceoMetrics.payroll_liability.total_gross) : "—", sub: `${ceoMetrics?.payroll_liability.employee_count ?? 0} employees` },
      { title: "Net Payable", value: ceoMetrics ? inrFmt(ceoMetrics.payroll_liability.total_net) : "—", sub: ceoMetrics?.payroll_liability.run_month ?? "draft run" },
      { title: "Employer PF+ESIC", value: ceoMetrics ? inrFmt(ceoMetrics.payroll_liability.employer_statutory) : "—", sub: "statutory liability" },
      { title: "Last Billing", value: ceoMetrics ? inrFmt(ceoMetrics.billing.last_month_billed) : "—", sub: ceoMetrics?.billing.billing_month ?? "no billing data" },
      { title: "Open Tickets", value: dashStats?.open_tickets ?? 0, sub: "ops/payroll blockers" },
    ],
    Operations: [
      { title: "Attendance %", value: `${dashStats?.attendance_rate ?? 0}%`, sub: "floor availability" },
      { title: "Avg KPI", value: dashStats?.avg_kpi_score ?? 0, sub: "team productivity" },
      { title: "Low KPI", value: lowKpiCount, sub: "below 60 score" },
      { title: "Attrition Rate", value: `${dashStats?.attrition_rate ?? 0}%`, sub: "trailing 30d" },
      { title: "HC Shortfall", value: ceoMetrics?.hc_gap.total_gap ?? 0, sub: "vs required capacity" },
      { title: "Revenue at Risk", value: ceoMetrics ? inrFmt(ceoMetrics.revenue_at_risk.total_daily_estimate) : "—", sub: "shrinkage cost today" },
    ],
  };

  const TABS: { id: ActiveTab; label: string; badge?: number }[] = [
    { id: "overview", label: "Overview" }, { id: "kpi", label: "KPI" }, { id: "coaching", label: "Coaching", badge: coachingSessions.length }, { id: "alerts", label: "Alerts", badge: unacknowledgedCount || undefined },
  ];

  return <DashboardLayout><div className="space-y-6"><div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">Management</p><h1 className="mt-2 text-3xl font-black text-slate-950">Command Centre</h1><p className="mt-2 max-w-4xl text-slate-600">Executive overview of workforce health, team KPI, performance alerts and coaching pipeline.</p></div><button onClick={() => void loadAll()} disabled={loading} className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"><RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh</button></div><RoleInsightsPanel roles={roleKeys} title="Management command insights" />{message && <div className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800"><AlertTriangle className="h-4 w-4 flex-shrink-0" />{message}</div>}
    <div className="rounded-3xl border bg-white p-4 shadow-sm"><div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between"><div className="flex flex-wrap gap-2">{(["CEO", "HR", "Finance", "Operations"] as Lens[]).map((l) => <button key={l} onClick={() => setLens(l)} className={`rounded-xl px-4 py-2 text-sm font-black ${lens === l ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>{l} Lens</button>)}</div><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search employee, alert, coaching..." className="h-10 w-full rounded-xl border bg-white pl-9 pr-3 text-sm text-slate-900 outline-none focus:border-blue-400 xl:w-80" /></div></div></div>
    <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7"><StatCard title="Management Health" value={`${healthScore}%`} icon={<ShieldAlert className="h-5 w-5" />} tone={healthScore >= 85 ? "bg-emerald-50 text-emerald-700" : healthScore >= 65 ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700"} sub={healthScore >= 85 ? "green" : healthScore >= 65 ? "amber" : "red"} />{lensCards[lens].map((card) => <StatCard key={card.title} title={card.title} value={card.value} icon={<BarChart3 className="h-5 w-5" />} tone="bg-blue-50 text-blue-700" sub={card.sub} onClick={routingMap[card.title] ? () => handleCardClick(card.title) : undefined} />)}</div>
    <div className="grid gap-3 md:grid-cols-3">{criticalAlerts > 0 && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800">{criticalAlerts} critical/high alerts need acknowledgement.</div>}{lowKpiCount > 0 && <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-800">{lowKpiCount} employees are below KPI threshold.</div>}{pendingCoaching > 0 && <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-800">{pendingCoaching} coaching sessions are open.</div>}</div>
    <div className="flex w-fit items-center gap-1 rounded-2xl border bg-slate-50 p-1">{TABS.map((tab) => <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`relative inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${activeTab === tab.id ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>{tab.label}{tab.badge != null && tab.badge > 0 && <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-black leading-none text-white">{tab.badge}</span>}</button>)}</div>
    {loading ? <div className="flex items-center justify-center py-16"><Loader className="h-8 w-8 animate-spin text-slate-400" /></div> : <>
      {activeTab === "overview" && <div className="space-y-6"><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"><StatCard title="Headcount" value={dashStats?.headcount ?? 0} icon={<Users className="h-5 w-5" />} tone="bg-blue-50 text-blue-700" /><StatCard title="Attrition Rate" value={dashStats?.attrition_rate ?? 0} suffix="%" icon={<ChevronDown className="h-5 w-5" />} tone="bg-rose-50 text-rose-700" /><StatCard title="Avg KPI Score" value={dashStats?.avg_kpi_score ?? 0} icon={<BarChart3 className="h-5 w-5" />} tone="bg-emerald-50 text-emerald-700" /><StatCard title="Open Tickets" value={dashStats?.open_tickets ?? 0} icon={<AlertTriangle className="h-5 w-5" />} tone="bg-amber-50 text-amber-700" /><StatCard title="Pending Leaves" value={dashStats?.pending_leaves ?? 0} icon={<Clock className="h-5 w-5" />} tone="bg-violet-50 text-violet-700" /><StatCard title="Attendance %" value={dashStats?.attendance_rate ?? 0} suffix="%" icon={<CheckCircle2 className="h-5 w-5" />} tone="bg-cyan-50 text-cyan-700" /></div>{unacknowledgedCount > 0 && <div className="rounded-3xl border border-red-200 bg-red-50 p-5"><div className="flex items-center justify-between"><div className="flex items-center gap-3"><AlertTriangle className="h-5 w-5 text-red-600" /><p className="font-bold text-red-800">{unacknowledgedCount} unacknowledged performance alert{unacknowledgedCount !== 1 ? "s" : ""}</p></div><button onClick={() => setActiveTab("alerts")} className="text-sm font-semibold text-red-700 underline hover:text-red-900">View Alerts</button></div></div>}</div>}
      {activeTab === "kpi" && <div className="space-y-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><h2 className="text-xl font-black text-slate-950">Team KPI Leaderboard</h2><label className="text-sm font-semibold text-slate-600">Period <input type="month" value={kpiPeriod} onChange={(e) => setKpiPeriod(e.target.value)} className="ml-2 rounded-xl border bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-400" /></label></div><div className="overflow-hidden rounded-3xl border bg-white shadow-sm">{filteredKpi.length === 0 ? <div className="py-16 text-center text-slate-400"><BarChart3 className="mx-auto mb-3 h-10 w-10 opacity-30" /><p className="font-semibold">No KPI data for this period/filter.</p></div> : <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr>{["Rank", "Employee", "Period", "Score", "Trend"].map((h) => <th key={h} className="p-4 font-semibold">{h}</th>)}</tr></thead><tbody>{filteredKpi.map((row) => <tr key={row.employee_id} className="border-t transition-colors hover:bg-slate-50/80"><td className="p-4"><span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-xs font-black text-slate-700">{row.rank_position}</span></td><td className="p-4"><div className="font-bold text-slate-950">{row.employee_name}</div><div className="font-mono text-xs text-slate-400">{row.employee_code ?? row.employee_id}</div></td><td className="p-4 font-mono text-slate-500">{row.period}</td><td className="p-4"><ScoreBadge score={row.overall_score} /></td><td className="p-4"><TrendIcon trend={row.trend} /></td></tr>)}</tbody></table></div>}</div></div>}
      {activeTab === "coaching" && <div className="space-y-4"><div className="flex items-center justify-between"><h2 className="text-xl font-black text-slate-950">Coaching Sessions</h2><button onClick={() => setShowCoachingModal(true)} className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800"><Plus className="h-4 w-4" />Schedule Coaching</button></div><div className="overflow-hidden rounded-3xl border bg-white shadow-sm">{filteredCoaching.length === 0 ? <div className="py-16 text-center text-slate-400"><BookOpen className="mx-auto mb-3 h-10 w-10 opacity-30" /><p className="font-semibold">No coaching sessions found.</p></div> : <div className="overflow-x-auto"><table className="w-full min-w-[800px] text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr>{["Employee", "Date", "Type", "Notes", "Action Items", "Status"].map((h) => <th key={h} className="p-4 font-semibold">{h}</th>)}</tr></thead><tbody>{filteredCoaching.map((s) => <tr key={s.id} className="border-t transition-colors hover:bg-slate-50/80"><td className="p-4"><div className="font-bold text-slate-950">{s.employee_name}</div><div className="font-mono text-xs text-slate-400">{s.employee_id}</div></td><td className="p-4 font-mono text-xs text-slate-500">{s.session_date?.slice(0, 10)}</td><td className="p-4 capitalize text-slate-600">{s.session_type?.replace(/_/g, " ")}</td><td className="max-w-[180px] truncate p-4 text-slate-600">{s.notes || "–"}</td><td className="max-w-[180px] truncate p-4 text-slate-500">{s.action_items || "–"}</td><td className="p-4"><SessionStatusBadge status={s.status} /></td></tr>)}</tbody></table></div>}</div></div>}
      {activeTab === "alerts" && <div className="space-y-4"><div className="flex items-center justify-between"><h2 className="text-xl font-black text-slate-950">Performance Alerts</h2><p className="text-sm text-slate-500">{unacknowledgedCount} pending</p></div><div className="flex flex-wrap gap-2">{SEVERITY_TABS.map((sv) => <button key={sv} onClick={() => setSeverityFilter(sv)} className={`rounded-xl px-3 py-1.5 text-xs font-semibold capitalize transition-colors ${severityFilter === sv ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{sv}</button>)}</div><div className="overflow-hidden rounded-3xl border bg-white shadow-sm">{filteredAlerts.length === 0 ? <div className="py-16 text-center text-slate-400"><CheckCircle2 className="mx-auto mb-3 h-10 w-10 opacity-30" /><p className="font-semibold">No alerts in this category/filter.</p></div> : <div className="divide-y">{filteredAlerts.map((alert) => <div key={alert.id} className={`flex items-start gap-4 p-5 transition-colors ${alert.acknowledged ? "bg-slate-50 opacity-50" : "hover:bg-slate-50/80"}`}><div className="min-w-0 flex-1"><div className="mb-1 flex flex-wrap items-center gap-2"><span className="font-bold text-slate-950">{alert.employee_name}</span><SeverityBadge severity={alert.severity} />{alert.acknowledged && <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">Acknowledged</span>}</div><p className="text-sm font-semibold capitalize text-slate-600">{alert.alert_type.replace(/_/g, " ")}</p><p className="mt-1 text-sm text-slate-500">{alert.message}</p></div>{!alert.acknowledged && <button onClick={() => acknowledgeAlert(alert.id)} disabled={acknowledgingId === alert.id} className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-50">{acknowledgingId === alert.id ? "..." : "Acknowledge"}</button>}</div>)}</div>}</div></div>}
    </>}
    {showCoachingModal && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"><div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl"><div className="flex items-center justify-between border-b p-6"><h2 className="text-lg font-black text-slate-950">Schedule Coaching</h2><button onClick={() => setShowCoachingModal(false)} className="text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button></div><div className="space-y-4 p-6">{teamMembers.length > 0 ? (<select value={coachingForm.employee_id} onChange={(e) => setCoachingForm({ ...coachingForm, employee_id: e.target.value })} className="w-full rounded-2xl border bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-blue-400"><option value="">— Select team member —</option>{teamMembers.map((m) => <option key={m.id} value={m.id}>{m.full_name} ({m.employee_code})</option>)}</select>) : (<input placeholder="Employee ID" value={coachingForm.employee_id} onChange={(e) => setCoachingForm({ ...coachingForm, employee_id: e.target.value })} className="w-full rounded-2xl border bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-blue-400" />)}<input type="date" value={coachingForm.session_date} onChange={(e) => setCoachingForm({ ...coachingForm, session_date: e.target.value })} className="w-full rounded-2xl border bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-blue-400" /><select value={coachingForm.session_type} onChange={(e) => setCoachingForm({ ...coachingForm, session_type: e.target.value })} className="w-full rounded-2xl border bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-blue-400">{SESSION_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}</select><textarea placeholder="Notes" value={coachingForm.notes} onChange={(e) => setCoachingForm({ ...coachingForm, notes: e.target.value })} rows={3} className="w-full resize-none rounded-2xl border bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-blue-400" /><textarea placeholder="Action items" value={coachingForm.action_items} onChange={(e) => setCoachingForm({ ...coachingForm, action_items: e.target.value })} rows={3} className="w-full resize-none rounded-2xl border bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-blue-400" /></div><div className="flex gap-3 border-t p-6"><button onClick={() => setShowCoachingModal(false)} className="flex-1 rounded-2xl border py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button><button onClick={submitCoaching} disabled={submittingCoaching} className="flex-1 rounded-2xl bg-slate-950 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50">{submittingCoaching ? "Saving..." : "Schedule"}</button></div></div></div>}
  </div></DashboardLayout>;
}
