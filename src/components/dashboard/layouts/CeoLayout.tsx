import { useQuery } from "@tanstack/react-query";
import {
  Users,
  Activity,
  AlertTriangle,
  DollarSign,
  UserPlus,
  Target,
  TrendingDown,
  Zap,
  Star,
  ShieldAlert,
  TrendingUp,
} from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { HeroBanner } from "../widgets/HeroBanner";
import { KpiRow } from "../widgets/KpiRow";
import { ImmediateActionsBar } from "../widgets/ImmediateActionsBar";
import { AiBriefingPanel } from "../widgets/AiBriefingPanel";
import { WorkInboxPanel } from "../widgets/WorkInboxPanel";
import { MovementChart } from "../widgets/MovementChart";
import { AttendanceDonutChart } from "../widgets/AttendanceDonutChart";
import { useDashboardUser } from "../widgets/useDashboardUser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function CeoLayout() {
  const { firstName } = useDashboardUser();

  const { data: wfData } = useQuery<any>({
    queryKey: ["workforce-dashboard"],
    queryFn: () => hrmsApi.get("/api/management/workforce-dashboard"),
    staleTime: 1000 * 60 * 5,
  });

  const { data: ceoData } = useQuery<any>({
    queryKey: ["ceo-metrics"],
    queryFn: () => hrmsApi.get("/api/management/ceo-metrics"),
    staleTime: 1000 * 60 * 5,
  });

  const { data: summaryData } = useQuery<any>({
    queryKey: ["dashboard-summary-hr"],
    queryFn: () => hrmsApi.get("/api/dashboards/hr/summary"),
    staleTime: 1000 * 60 * 3,
  });

  // Quality / KPI data sources
  const { data: agentPerfData, isLoading: agentPerfLoading } = useQuery<any>({
    queryKey: ["agent-performance-ceo"],
    queryFn: () => hrmsApi.get("/api/management/agent-performance"),
    staleTime: 1000 * 60 * 5,
  });

  const { data: teamKpiData, isLoading: teamKpiLoading } = useQuery<any>({
    queryKey: ["team-kpi-ceo"],
    queryFn: () => hrmsApi.get("/api/management/team-kpi"),
    staleTime: 1000 * 60 * 5,
  });

  const summary = wfData?.data?.summary ?? {};
  const metrics = summaryData?.data?.metrics ?? {};
  const ceo = ceoData?.data ?? {};

  // Agent performance data
  const agentPerf: any[] = Array.isArray(agentPerfData?.data) ? agentPerfData.data : [];
  const teamKpi = teamKpiData?.data ?? {};

  // Derive quality overview from agent-performance
  const avgScore =
    agentPerf.length > 0
      ? agentPerf.reduce((sum: number, a: any) => sum + (a.quality_score ?? a.avg_score ?? 0), 0) /
        agentPerf.length
      : 0;
  const qualityTarget = 85;
  const riskAgents = agentPerf.filter(
    (a: any) => (a.quality_score ?? a.avg_score ?? 0) < 70
  ).length;

  // Group agent perf by process for scorecard
  const processScorecardMap: Record<string, { scores: number[]; agents: number; calls: number }> =
    {};
  agentPerf.forEach((a: any) => {
    const proc = a.process ?? a.lob ?? a.department ?? "Unassigned";
    if (!processScorecardMap[proc]) {
      processScorecardMap[proc] = { scores: [], agents: 0, calls: 0 };
    }
    processScorecardMap[proc].scores.push(a.quality_score ?? a.avg_score ?? 0);
    processScorecardMap[proc].agents += 1;
    processScorecardMap[proc].calls += a.total_calls ?? a.calls_handled ?? 0;
  });
  const processScorecardRows = Object.entries(processScorecardMap).map(([proc, d]) => ({
    process: proc,
    avgScore: d.scores.length > 0 ? d.scores.reduce((a, b) => a + b, 0) / d.scores.length : 0,
    agents: d.agents,
    calls: d.calls,
  }));

  // KPI summary
  const orgAvgKpi = teamKpi.org_avg_kpi ?? teamKpi.avg_kpi ?? 0;
  const bestProcess = teamKpi.best_process ?? teamKpi.top_process ?? "—";
  const needsAttentionProcess = teamKpi.needs_attention ?? teamKpi.worst_process ?? "—";

  const immediateActions = [
    { label: "TAT Breached", count: metrics.tat?.value ?? 0, href: "/work-inbox", urgency: "critical" as const, subtitle: "Tickets waiting beyond SLA" },
    { label: "BGV Pending", count: metrics.bgv?.value ?? 0, href: "/employees", urgency: "warning" as const, subtitle: "Approvals pending" },
    { label: "Name Mismatch", count: metrics.name_mismatch?.value ?? 0, href: "/employees", urgency: "critical" as const, subtitle: "Blocking payroll" },
    { label: "Incentive Pending", count: metrics.incentive?.value ?? 0, href: "/payroll", urgency: "warning" as const, subtitle: "Approvals pending" },
    { label: "Payroll Readiness", count: metrics.payroll?.value ? `${metrics.payroll.value}%` : "—", href: "/payroll", urgency: "warning" as const, subtitle: "Complete pending items" },
  ].filter((a) => a.count !== 0 && a.count !== "—");

  const kpiTiles = [
    { label: "Login Adherence", value: summary.attendance_pct ? `${summary.attendance_pct.toFixed(1)}%` : "—", helper: "vs Yesterday", icon: <Activity className="w-4 h-4" />, accent: "#1B6AB5", trend: "up" as const, variancePct: 1.3 },
    { label: "Avg Shrinkage", value: summary.shrinkage_pct ? `${summary.shrinkage_pct.toFixed(2)}%` : "—", helper: "vs Last 30 Days", icon: <TrendingDown className="w-4 h-4" />, accent: "#F59E0B", trend: "up" as const, variancePct: 0.31 },
    { label: "Revenue Gap MTD", value: ceo.revenue_at_risk?.revenue_at_risk_inr ? `₹${(ceo.revenue_at_risk.revenue_at_risk_inr / 100000).toFixed(1)}L` : "—", helper: "vs Last Month", icon: <DollarSign className="w-4 h-4" />, accent: "#E8231A", trend: "up" as const, variancePct: 22.41 },
    { label: "Certified Learners", value: summary.analysts_in_training ?? 0, helper: "vs Last 30 Days", icon: <Zap className="w-4 h-4" />, accent: "#3BAD49", trend: "up" as const, variancePct: 13.25 },
  ];

  const metricTiles = [
    { label: "Active Headcount", value: summary.active_headcount ?? 0, helper: `+${summary.new_joiners_30d ?? 0} this month`, icon: <Users className="w-4 h-4" />, accent: "#1B6AB5", trend: "up" as const, variancePct: 1.06 },
    { label: "Onboarding Pending", value: metrics.onb?.value ?? 0, helper: "vs Yesterday", icon: <UserPlus className="w-4 h-4" />, accent: "#F59E0B", trend: "down" as const, variancePct: 11.27 },
    { label: "BGV Pending", value: metrics.bgv?.value ?? 0, helper: "vs Yesterday", icon: <AlertTriangle className="w-4 h-4" />, accent: "#8B5CF6", trend: "down" as const, variancePct: 11.11 },
    { label: "Name Mismatch", value: metrics.name_mismatch?.value ?? 0, helper: "Blocking payroll", icon: <AlertTriangle className="w-4 h-4" />, accent: "#E8231A", trend: "down" as const, variancePct: 12.90 },
    { label: "TAT Breached", value: metrics.tat?.value ?? 0, helper: "vs Yesterday", icon: <Target className="w-4 h-4" />, accent: "#E8231A", trend: "down" as const, variancePct: 21.95 },
    { label: "Incentive Pending", value: metrics.incentive?.value ?? 0, helper: "vs Last 7 Days", icon: <DollarSign className="w-4 h-4" />, accent: "#F59E0B", trend: "down" as const, variancePct: 12.50 },
    { label: "Payroll Readiness", value: metrics.payroll?.value ? `${metrics.payroll.value}%` : "—", helper: "vs Yesterday", icon: <Activity className="w-4 h-4" />, accent: "#3BAD49", trend: "up" as const, variancePct: 3.00 },
    { label: "Resignation Risk", value: metrics.resignations?.value ?? 0, helper: "Pending discussion", icon: <TrendingDown className="w-4 h-4" />, accent: "#E8231A", trend: "down" as const, variancePct: 10.34 },
  ];

  const workItems = [
    { icon: <AlertTriangle className="w-4 h-4" />, title: "BGV Approvals", subtitle: "Pending background verifications", count: metrics.bgv?.value ?? 0, href: "/employees", color: "bg-amber-100 text-amber-700", timestamp: "2h ago" },
    { icon: <AlertTriangle className="w-4 h-4" />, title: "Name Mismatch (Blocking)", subtitle: "Requires employee data correction", count: metrics.name_mismatch?.value ?? 0, href: "/employees", color: "bg-red-100 text-red-700", timestamp: "3h ago" },
    { icon: <Target className="w-4 h-4" />, title: "TAT Breaches", subtitle: "Tickets breached SLA", count: metrics.tat?.value ?? 0, href: "/work-inbox", color: "bg-red-100 text-red-700", timestamp: "4h ago" },
    { icon: <DollarSign className="w-4 h-4" />, title: "Incentive Approvals", subtitle: "Pending incentive approvals", count: metrics.incentive?.value ?? 0, href: "/payroll", color: "bg-amber-100 text-amber-700", timestamp: "5h ago" },
  ].filter((i) => i.count > 0);

  return (
    <div className="space-y-6">
      {/* ── Existing structure (unchanged) ── */}
      <HeroBanner
        title="CEO Dashboard"
        subtitle="Organisation-wide summary"
        roleChip="CEO View"
        chipColor="bg-purple-50 text-purple-700 border-purple-200"
        updatedAt="Updated just now"
      />
      {immediateActions.length > 0 && <ImmediateActionsBar items={immediateActions} />}
      <KpiRow tiles={kpiTiles} cols={4} />
      <KpiRow tiles={metricTiles} />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <AiBriefingPanel dashboardCode="hr" title="Executive AI Briefing" subtitle="AI-analyzed live workforce data" />
          <MovementChart />
        </div>
        <div className="space-y-6">
          <WorkInboxPanel items={workItems} />
          <AttendanceDonutChart />
        </div>
      </div>

      {/* ── NEW: Quality Overview section ── */}
      <div className="pt-2">
        <h3 className="text-base font-bold text-slate-800 mb-4 flex items-center gap-2">
          <Star className="w-4 h-4 text-amber-500" />
          Quality Performance Overview
        </h3>

        {/* Quality KPI cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
            <CardContent className="p-5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                Org Quality Score
              </p>
              {agentPerfLoading ? (
                <Skeleton className="h-8 w-24 rounded" />
              ) : (
                <>
                  <p
                    className={`text-3xl font-black ${
                      avgScore >= qualityTarget ? "text-emerald-600" : "text-amber-600"
                    }`}
                    style={{ fontFamily: "'Fira Code', monospace" }}
                  >
                    {avgScore > 0 ? avgScore.toFixed(1) : "—"}
                    <span className="text-lg font-semibold text-slate-400">
                      {avgScore > 0 ? "%" : ""}
                    </span>
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    {avgScore >= qualityTarget ? "Above target" : `Target: ${qualityTarget}%`}
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
            <CardContent className="p-5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                Quality vs Target
              </p>
              {agentPerfLoading ? (
                <Skeleton className="h-8 w-24 rounded" />
              ) : (
                <>
                  <p
                    className={`text-3xl font-black ${
                      avgScore - qualityTarget >= 0 ? "text-emerald-600" : "text-red-600"
                    }`}
                    style={{ fontFamily: "'Fira Code', monospace" }}
                  >
                    {avgScore > 0
                      ? `${avgScore - qualityTarget >= 0 ? "+" : ""}${(avgScore - qualityTarget).toFixed(1)}`
                      : "—"}
                    <span className="text-lg font-semibold text-slate-400">
                      {avgScore > 0 ? "pp" : ""}
                    </span>
                  </p>
                  <p className="text-xs text-slate-400 mt-1">vs {qualityTarget}% benchmark</p>
                </>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-2xl border border-red-100 shadow-sm bg-red-50">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                    Risk Agents
                  </p>
                  {agentPerfLoading ? (
                    <Skeleton className="h-8 w-16 rounded" />
                  ) : (
                    <>
                      <p
                        className="text-3xl font-black text-red-600"
                        style={{ fontFamily: "'Fira Code', monospace" }}
                      >
                        {riskAgents}
                      </p>
                      <p className="text-xs text-red-400 mt-1">Score below 70%</p>
                    </>
                  )}
                </div>
                <ShieldAlert className="w-6 h-6 text-red-400 mt-1" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* NEW: Process Quality Scorecard table */}
        <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white mb-6">
          <CardHeader className="border-b border-slate-100 pb-4 pt-5 px-5">
            <CardTitle className="text-sm font-bold text-slate-900">
              Process Quality Scorecard
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {agentPerfLoading ? (
              <div className="p-4"><Skeleton className="h-28 w-full rounded-xl" /></div>
            ) : processScorecardRows.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-400">No quality data available</div>
            ) : (
              <>
                <div className="grid grid-cols-5 border-b border-slate-100 px-5 py-2">
                  {["Process / LOB", "Avg Score", "Agents", "Calls", "Status"].map((h) => (
                    <span key={h} className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      {h}
                    </span>
                  ))}
                </div>
                {processScorecardRows.map((row, i) => {
                  const status =
                    row.avgScore >= 90
                      ? { label: "Excellent", color: "bg-emerald-100 text-emerald-700" }
                      : row.avgScore >= 80
                      ? { label: "On Track", color: "bg-blue-100 text-blue-700" }
                      : row.avgScore >= 70
                      ? { label: "Watch", color: "bg-amber-100 text-amber-700" }
                      : { label: "At Risk", color: "bg-red-100 text-red-700" };
                  return (
                    <div
                      key={i}
                      className="grid grid-cols-5 items-center px-5 py-3.5 border-b border-slate-50 last:border-0 hover:bg-slate-50"
                    >
                      <span className="text-sm font-medium text-slate-800 truncate pr-2">
                        {row.process}
                      </span>
                      <span
                        className={`text-sm font-bold tabular-nums ${
                          row.avgScore >= 85 ? "text-emerald-600" : row.avgScore >= 70 ? "text-amber-600" : "text-red-600"
                        }`}
                        style={{ fontFamily: "'Fira Code', monospace" }}
                      >
                        {row.avgScore.toFixed(1)}%
                      </span>
                      <span
                        className="text-sm text-slate-600 tabular-nums"
                        style={{ fontFamily: "'Fira Code', monospace" }}
                      >
                        {row.agents}
                      </span>
                      <span
                        className="text-sm text-slate-600 tabular-nums"
                        style={{ fontFamily: "'Fira Code', monospace" }}
                      >
                        {row.calls.toLocaleString("en-IN")}
                      </span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full w-fit ${status.color}`}
                      >
                        {status.label}
                      </span>
                    </div>
                  );
                })}
              </>
            )}
          </CardContent>
        </Card>

        {/* NEW: KPI Performance card */}
        <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
          <CardHeader className="border-b border-slate-100 pb-4 pt-5 px-5">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-[#1B6AB5]" />
              <CardTitle className="text-sm font-bold text-slate-900">
                KPI Performance Summary
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-5">
            {teamKpiLoading ? (
              <Skeleton className="h-20 w-full rounded-xl" />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* Org Avg */}
                <div className="flex flex-col gap-1 p-4 rounded-xl bg-slate-50 border border-slate-100">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Org Average KPI
                  </span>
                  <span
                    className="text-2xl font-black text-slate-900"
                    style={{ fontFamily: "'Fira Code', monospace" }}
                  >
                    {orgAvgKpi > 0 ? `${orgAvgKpi.toFixed(1)}%` : "—"}
                  </span>
                  <span className="text-xs text-slate-400">Overall organisation KPI</span>
                </div>

                {/* Best Process */}
                <div className="flex flex-col gap-1 p-4 rounded-xl bg-emerald-50 border border-emerald-100">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Best Process
                  </span>
                  <span
                    className="text-lg font-black text-emerald-700 truncate"
                    style={{ fontFamily: "'Fira Code', monospace" }}
                  >
                    {bestProcess}
                  </span>
                  {teamKpi.best_score != null && (
                    <span className="text-xs text-emerald-500">
                      Score: {teamKpi.best_score.toFixed(1)}%
                    </span>
                  )}
                </div>

                {/* Needs Attention */}
                <div className="flex flex-col gap-1 p-4 rounded-xl bg-red-50 border border-red-100">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    Needs Attention
                  </span>
                  <span
                    className="text-lg font-black text-red-600 truncate"
                    style={{ fontFamily: "'Fira Code', monospace" }}
                  >
                    {needsAttentionProcess}
                  </span>
                  {teamKpi.worst_score != null && (
                    <span className="text-xs text-red-400">
                      Score: {teamKpi.worst_score.toFixed(1)}%
                    </span>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
