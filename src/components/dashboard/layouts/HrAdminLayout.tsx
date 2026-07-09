import { useQuery } from "@tanstack/react-query";
import {
  Users,
  UserPlus,
  Briefcase,
  Clock,
  TrendingDown,
  Star,
  Activity,
  CheckCircle2,
  AlertTriangle,
  FileText,
  BarChart2,
  Upload,
  Headphones,
} from "lucide-react";
import { Link } from "react-router-dom";
import {
  Line,
  LineChart,
  CartesianGrid,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { hrmsApi } from "@/lib/hrmsApi";
import { useDashboardUser } from "../widgets/useDashboardUser";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function HrAdminLayout() {
  const { user } = useDashboardUser();

  const { data: wfData } = useQuery({
    queryKey: ["workforce-dashboard"],
    queryFn: () => hrmsApi.get("/api/management/workforce-dashboard"),
  });

  const { data: summaryData } = useQuery({
    queryKey: ["dashboard-summary-hr"],
    queryFn: () => hrmsApi.get("/api/dashboards/hr/summary"),
  });

  const { data: atsData } = useQuery({
    queryKey: ["ats-stats"],
    queryFn: () => hrmsApi.get("/api/ats/stats"),
  });

  const { data: leaveReqs } = useQuery({
    queryKey: ["leave-requests-all"],
    queryFn: () => hrmsApi.get("/api/leave/requests"),
  });

  const { data: leaderboard } = useQuery({
    queryKey: ["engagement-leaderboard"],
    queryFn: () => hrmsApi.get("/api/engagement/leaderboard"),
  });

  const { data: kudosData } = useQuery({
    queryKey: ["kudos-wall"],
    queryFn: () => hrmsApi.get("/api/engagement/kudos/wall"),
  });

  const { data: teamKpi } = useQuery({
    queryKey: ["team-kpi-hr"],
    queryFn: () => hrmsApi.get("/api/management/team-kpi"),
  });

  const summary = wfData?.data?.summary ?? {};
  const movement: any[] = wfData?.data?.movement ?? [];
  const metrics = summaryData?.data?.metrics ?? {};
  // ATS returns by_stage object not pipeline array
  const byStage: Record<string, number> = atsData?.data?.by_stage ?? {};
  const totalCandidates: number = atsData?.data?.total_candidates ?? 0;
  const requests: any[] = Array.isArray(leaveReqs?.data) ? leaveReqs.data : [];
  const board: any[] = Array.isArray(leaderboard?.data) ? leaderboard.data : [];
  const kudos: any[] = Array.isArray(kudosData?.data) ? kudosData.data : [];
  const kpiList: any[] = Array.isArray(teamKpi?.data) ? teamKpi.data : [];

  const pendingLeave = requests.filter((r: any) => r.status === "pending").length;
  const onbPending = metrics.onb?.detail?.pending ?? metrics.onb?.value ?? 0;
  const onbSubmitted = metrics.onb?.detail?.submitted ?? 0;
  const bgvPending = metrics.bgv?.value ?? 0;

  // Open positions = active ATS stages (not Applied/converted/Onboarded)
  const closedStages = ["Applied", "converted", "Onboarded", "Hold"];
  const openPositions = Object.entries(byStage)
    .filter(([stage]) => !closedStages.includes(stage))
    .reduce((s, [, v]) => s + v, 0);

  // Use correct field names from API
  const newJoiners30d = summary.new_joiners_30d ?? 0;
  const attritionRate = summary.attrition_rate_30d ?? 0;
  const presentCount = summary.attendance_pct
    ? Math.round((summary.attendance_pct / 100) * (summary.active_headcount ?? 0))
    : 0;

  // KPI score — not available for this scope, show as N/A clearly
  const avgScore = kpiList.length > 0
    ? (kpiList.reduce((s: number, k: any) => s + (k.overall_score ?? 0), 0) / kpiList.length).toFixed(1)
    : "N/A";
  const topPerformers = kpiList.slice(0, 3);
  const topLeaders = board.slice(0, 3);
  const today = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const dateLabel = new Date().toLocaleString("default", { month: "long", year: "numeric" });

  // Funnel — aggregate all real ATS stage variants per logical step
  const sumStages = (...keys: string[]) => keys.reduce((s, k) => s + (byStage[k] ?? 0), 0);
  const funnelData = [
    {
      label: "Applied",
      value: sumStages("Applied", "New"),
      color: "#1B6AB5",
    },
    {
      label: "Screening",
      // HR Screening (R1) + Ops screening (R2) + generic Screening + Arrival/Arrived (walk-ins)
      value: sumStages("Round 1- HR Screening", "Screening", "Arrival", "Arrived"),
      color: "#3BAD49",
    },
    {
      label: "Interview",
      // All interview-type stages
      value: sumStages("Interview", "Interview - Skill Test", "Round 2- Op's", "Round 3- Client"),
      color: "#8B5CF6",
    },
    {
      label: "Selected",
      // Selection discussion + confirmed selected
      value: sumStages("selected", "Selection Discussion", "Offered"),
      color: "#F59E0B",
    },
    {
      label: "Onboarded",
      value: sumStages("Onboarded", "converted"),
      color: "#22D3EE",
    },
  ];
  const funnelMax = Math.max(...funnelData.map((f) => f.value), 1);

  const tooltipStyle = {
    backgroundColor: "#0f172a",
    border: "none",
    borderRadius: "8px",
    color: "#f1f5f9",
    fontSize: 11,
  };

  const kpiStrip = [
    {
      label: "Total Employees",
      value: (summary.active_headcount ?? 0).toLocaleString(),
      sub: "active headcount",
      icon: <Users className="w-4 h-4 text-[#1B6AB5]" />,
      bg: "bg-blue-50",
    },
    {
      label: "Present Today",
      value: presentCount > 0 ? presentCount.toLocaleString() : "—",
      sub: summary.attendance_pct ? `${summary.attendance_pct.toFixed(1)}% of total` : "Not marked yet",
      icon: <CheckCircle2 className="w-4 h-4 text-[#3BAD49]" />,
      bg: "bg-green-50",
    },
    {
      label: "Open Positions",
      value: openPositions.toLocaleString(),
      sub: `${Object.keys(byStage).filter(k => !closedStages.includes(k)).length} active stages`,
      icon: <Briefcase className="w-4 h-4 text-[#8B5CF6]" />,
      bg: "bg-purple-50",
    },
    {
      label: "Pending Approvals",
      value: pendingLeave.toLocaleString(),
      sub: `${pendingLeave} leave requests`,
      icon: <Clock className="w-4 h-4 text-[#F59E0B]" />,
      bg: "bg-amber-50",
    },
    {
      label: "New Joiners",
      value: newJoiners30d.toLocaleString(),
      sub: "Last 30 days",
      icon: <UserPlus className="w-4 h-4 text-[#22D3EE]" />,
      bg: "bg-cyan-50",
    },
    {
      label: "Attrition Rate",
      value: `${attritionRate.toFixed(2)}%`,
      sub: "Last 30 days",
      icon: <TrendingDown className="w-4 h-4 text-[#E8231A]" />,
      bg: "bg-red-50",
    },
    {
      label: "Avg KPI Score",
      value: avgScore,
      sub: "team average",
      icon: <Star className="w-4 h-4 text-[#F59E0B]" />,
      bg: "bg-yellow-50",
    },
    {
      label: "BGV Pending",
      value: (bgvPending ?? 0).toLocaleString(),
      sub: "verification queue",
      icon: <AlertTriangle className="w-4 h-4 text-[#E8231A]" />,
      bg: "bg-rose-50",
    },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">HRMS2 Dashboard</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Unified view across people, process and performance
          </p>
        </div>
        <span className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500">
          {today}
        </span>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
        {kpiStrip.map((tile) => (
          <div
            key={tile.label}
            className="bg-white rounded-xl border border-slate-200 shadow-sm p-3 flex flex-col gap-2"
          >
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${tile.bg}`}>
              {tile.icon}
            </div>
            <div>
              <div
                className="text-xl font-black text-slate-900 leading-tight"
                style={{ fontFamily: "Fira Code, monospace" }}
              >
                {tile.value}
              </div>
              <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mt-0.5">
                {tile.label}
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">{tile.sub}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Row 2: Attendance Trend + Recruitment Funnel */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Attendance Trend */}
        <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
          <CardHeader className="pb-2 pt-4 px-5">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold text-slate-700">
                Attendance Trend
              </CardTitle>
              <Link to="/attendance" className="text-xs font-semibold text-[#1B6AB5] hover:underline">
                View All
              </Link>
            </div>
          </CardHeader>
          <CardContent className="px-3 pb-4">
            {movement.length > 0 ? (
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={movement} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: "#94a3b8" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "#94a3b8" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Line
                    type="monotone"
                    dataKey="headcount"
                    stroke="#1B6AB5"
                    strokeWidth={2}
                    dot={false}
                    name="Headcount"
                  />
                  <Line
                    type="monotone"
                    dataKey="joins"
                    stroke="#3BAD49"
                    strokeWidth={2}
                    dot={false}
                    name="Joins"
                  />
                  <Line
                    type="monotone"
                    dataKey="exits"
                    stroke="#E8231A"
                    strokeWidth={2}
                    dot={false}
                    name="Exits"
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[180px] flex items-center justify-center text-sm text-slate-400">
                No trend data available
              </div>
            )}
            <div className="flex gap-4 mt-2 px-2">
              {[
                { color: "#1B6AB5", label: "Headcount" },
                { color: "#3BAD49", label: "Joins" },
                { color: "#E8231A", label: "Exits" },
              ].map((l) => (
                <div key={l.label} className="flex items-center gap-1.5">
                  <span
                    className="w-2.5 h-2.5 rounded-full inline-block"
                    style={{ background: l.color }}
                  />
                  <span className="text-[10px] text-slate-500">{l.label}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Recruitment Funnel */}
        <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
          <CardHeader className="pb-2 pt-4 px-5">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold text-slate-700">
                Recruitment Funnel
              </CardTitle>
              <Link to="/ats/command-center" className="text-xs font-semibold text-[#1B6AB5] hover:underline">
                View Pipeline
              </Link>
            </div>
          </CardHeader>
          <CardContent className="px-5 pb-4">
            <div className="space-y-2.5 mt-1">
              {funnelData.map((stage, idx) => {
                const pct = funnelMax > 0 ? Math.round((stage.value / funnelMax) * 100) : 0;
                const prev = idx > 0 ? funnelData[idx - 1].value : stage.value;
                const conv =
                  prev > 0 ? Math.round((stage.value / prev) * 100) : 100;
                return (
                  <div key={stage.label} className="flex items-center gap-3">
                    <span className="w-16 text-[11px] font-medium text-slate-500 text-right shrink-0">
                      {stage.label}
                    </span>
                    <div className="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden">
                      <div
                        className="h-5 rounded-full flex items-center pl-2 transition-all duration-500"
                        style={{
                          width: `${Math.max(pct, 4)}%`,
                          background: stage.color,
                        }}
                      >
                        <span
                          className="text-white text-[10px] font-bold"
                          style={{ fontFamily: "Fira Code, monospace" }}
                        >
                          {stage.value}
                        </span>
                      </div>
                    </div>
                    <span className="w-12 text-[10px] text-slate-400 text-right shrink-0">
                      {idx === 0 ? "—" : `${conv}%`}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-end mt-2">
              <span className="text-[10px] text-slate-400">Conv. rate →</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Row 3: 5-column section */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-5">
        {/* Onboarding Status */}
        <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
          <CardHeader className="pb-2 pt-4 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
                Onboarding Status
              </CardTitle>
              <Link to="/onboarding" className="text-xs font-semibold text-[#1B6AB5] hover:underline">
                View
              </Link>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            {[
              {
                label: "Docs Pending",
                value: onbPending,
                color: "text-amber-600",
                bg: "bg-amber-50",
              },
              {
                label: "BGV Queue",
                value: bgvPending,
                color: "text-red-600",
                bg: "bg-red-50",
              },
              {
                label: "In Progress",
                value: onbSubmitted,
                color: "text-blue-600",
                bg: "bg-blue-50",
              },
              {
                label: "Completed",
                value: metrics.onb?.detail?.completed ?? 0,
                color: "text-green-600",
                bg: "bg-green-50",
              },
            ].map((row) => (
              <div
                key={row.label}
                className={`flex items-center justify-between rounded-lg px-3 py-2 ${row.bg}`}
              >
                <span className="text-xs text-slate-600">{row.label}</span>
                <span
                  className={`text-sm font-black ${row.color}`}
                  style={{ fontFamily: "Fira Code, monospace" }}
                >
                  {(row.value ?? 0).toLocaleString()}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Leave & Attendance Today */}
        <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
          <CardHeader className="pb-2 pt-4 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
                Leave & Attendance
              </CardTitle>
              <Link to="/attendance" className="text-xs font-semibold text-[#1B6AB5] hover:underline">
                View
              </Link>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            <div className="grid grid-cols-3 gap-2">
              {[
                {
                  label: "Absenteeism",
                  value: summary.attendance_pct ? `${(100 - summary.attendance_pct).toFixed(1)}%` : "—",
                  color: "text-red-600",
                },
                {
                  label: "Late Marks",
                  value: "—", // Late marks not in API yet
                  color: "text-amber-600",
                },
                {
                  label: "Short Att.",
                  value: (summary.short_attendance ?? 0).toLocaleString(),
                  color: "text-orange-600",
                },
              ].map((m) => (
                <div key={m.label} className="text-center">
                  <div
                    className={`text-lg font-black ${m.color}`}
                    style={{ fontFamily: "Fira Code, monospace" }}
                  >
                    {m.value}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">{m.label}</div>
                </div>
              ))}
            </div>
            <div className="space-y-1.5 pt-1">
              {[
                { label: "APR / App", pct: summary.apr_pct ?? 62, color: "#1B6AB5" },
                { label: "Biometric", pct: summary.biometric_pct ?? 38, color: "#3BAD49" },
              ].map((src) => (
                <div key={src.label}>
                  <div className="flex justify-between text-[10px] text-slate-500 mb-0.5">
                    <span>{src.label}</span>
                    <span style={{ fontFamily: "Fira Code, monospace" }}>{src.pct}%</span>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-1.5 rounded-full"
                      style={{ width: `${src.pct}%`, background: src.color }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Roster / WFM Overview */}
        <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
          <CardHeader className="pb-2 pt-4 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
                Roster / WFM
              </CardTitle>
              <Link to="/wfm/dashboard" className="text-xs font-semibold text-[#1B6AB5] hover:underline">
                View
              </Link>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            <div className="space-y-2">
              {[
                {
                  label: "Rostered",
                  pct: summary.rostered_pct ?? 88,
                  color: "#1B6AB5",
                },
                {
                  label: "Utilisation",
                  pct: summary.utilisation_pct ?? 74,
                  color: "#8B5CF6",
                },
                {
                  label: "Shrinkage",
                  pct: summary.shrinkage_pct ?? 12,
                  color: "#E8231A",
                },
              ].map((bar) => (
                <div key={bar.label}>
                  <div className="flex justify-between text-[10px] text-slate-500 mb-0.5">
                    <span>{bar.label}</span>
                    <span style={{ fontFamily: "Fira Code, monospace" }}>{bar.pct}%</span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-2 rounded-full"
                      style={{ width: `${bar.pct}%`, background: bar.color }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-1.5 pt-1">
              {[
                { label: "Night Shift", value: (summary.night_shift ?? 0).toLocaleString() },
                { label: "OT Hours", value: (summary.ot_hours ?? 0).toLocaleString() },
                { label: "WFH", value: "—" },
              ].map((s) => (
                <div key={s.label} className="bg-slate-50 rounded-lg p-2 text-center">
                  <div
                    className="text-sm font-black text-slate-800"
                    style={{ fontFamily: "Fira Code, monospace" }}
                  >
                    {s.value}
                  </div>
                  <div className="text-[9px] text-slate-400 mt-0.5">{s.label}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Performance & Quality */}
        <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
          <CardHeader className="pb-2 pt-4 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
                Performance
              </CardTitle>
              <Link to="/performance" className="text-xs font-semibold text-[#1B6AB5] hover:underline">
                View
              </Link>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            <div className="grid grid-cols-3 gap-2">
              {[
                {
                  label: "Avg Score",
                  value: avgScore,
                  color: "text-[#1B6AB5]",
                },
                {
                  label: "Top 10%",
                  value: kpiList.filter((k: any) => (k.overall_score ?? 0) >= 90).length.toLocaleString(),
                  color: "text-green-600",
                },
                {
                  label: "PIP",
                  value: kpiList.filter((k: any) => (k.overall_score ?? 0) < 60).length.toLocaleString(),
                  color: "text-red-600",
                },
              ].map((m) => (
                <div key={m.label} className="text-center">
                  <div
                    className={`text-lg font-black ${m.color}`}
                    style={{ fontFamily: "Fira Code, monospace" }}
                  >
                    {m.value}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">{m.label}</div>
                </div>
              ))}
            </div>
            <div className="space-y-1.5">
              <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
                Top Performers
              </div>
              {topPerformers.length > 0 ? (
                topPerformers.map((p: any, i: number) => (
                  <div key={i} className="flex items-center justify-between">
                    <span className="text-xs text-slate-600 truncate max-w-[100px]">
                      {p.name ?? `Employee ${i + 1}`}
                    </span>
                    <span
                      className="text-xs font-bold text-[#1B6AB5]"
                      style={{ fontFamily: "Fira Code, monospace" }}
                    >
                      {p.overall_score ?? 0}
                    </span>
                  </div>
                ))
              ) : (
                <div className="text-xs text-slate-400">No data</div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Engagement */}
        <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
          <CardHeader className="pb-2 pt-4 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
                Engagement
              </CardTitle>
              <Link to="/engagement" className="text-xs font-semibold text-[#1B6AB5] hover:underline">
                View
              </Link>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            <div className="grid grid-cols-3 gap-2">
              {[
                {
                  label: "Badges Issued",
                  value: board.reduce((s: number, b: any) => s + (b.badges_earned ?? 0), 0).toLocaleString(),
                  color: "text-[#F59E0B]",
                },
                {
                  label: "Kudos Given",
                  value: kudos.length.toLocaleString(),
                  color: "text-pink-600",
                },
                {
                  label: "Leaderboard",
                  value: `Top ${board.length}`,
                  color: "text-purple-600",
                },
              ].map((m) => (
                <div key={m.label} className="text-center">
                  <div
                    className={`text-lg font-black ${m.color}`}
                    style={{ fontFamily: "Fira Code, monospace" }}
                  >
                    {m.value}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">{m.label}</div>
                </div>
              ))}
            </div>
            <div className="space-y-1.5">
              <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
                Top Kudos
              </div>
              {topLeaders.length > 0 ? (
                topLeaders.map((l: any, i: number) => (
                  <div key={i} className="flex items-center justify-between">
                    <span className="text-xs text-slate-600 truncate max-w-[100px]">
                      {l.employee_name ?? `Employee ${i + 1}`}
                    </span>
                    <span
                      className="text-xs font-bold text-pink-500"
                      style={{ fontFamily: "Fira Code, monospace" }}
                    >
                      {l.total_points ?? 0}
                    </span>
                  </div>
                ))
              ) : (
                <div className="text-xs text-slate-400">No data</div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Row 4: 3-column grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Compliance & Alerts */}
        <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
          <CardHeader className="pb-2 pt-4 px-5">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold text-slate-700">
                Compliance & Alerts
              </CardTitle>
              <Link to="/compliance/statutory" className="text-xs font-semibold text-[#1B6AB5] hover:underline">
                View All
              </Link>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="grid grid-cols-2 gap-3">
              {[
                {
                  label: "PF/UAN Issues",
                  value: bgvPending > 0 ? bgvPending.toLocaleString() : "—",
                  bg: "bg-red-50 border-red-200",
                  color: "text-red-700",
                  icon: <AlertTriangle className="w-3.5 h-3.5 text-red-500" />,
                },
                {
                  label: "Expiring Docs",
                  value: bgvPending > 0 ? bgvPending.toLocaleString() : "—",
                  bg: "bg-amber-50 border-amber-200",
                  color: "text-amber-700",
                  icon: <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />,
                },
                {
                  label: "Pending Approvals",
                  value: (pendingLeave + onbPending).toLocaleString(),
                  bg: "bg-orange-50 border-orange-200",
                  color: "text-orange-700",
                  icon: <FileText className="w-3.5 h-3.5 text-orange-500" />,
                },
                {
                  label: "Statutory Updates",
                  value: "—",
                  bg: "bg-purple-50 border-purple-200",
                  color: "text-purple-700",
                  icon: <Activity className="w-3.5 h-3.5 text-purple-500" />,
                },
              ].map((alert) => (
                <div
                  key={alert.label}
                  className={`rounded-xl border p-3 ${alert.bg} flex flex-col gap-1`}
                >
                  <div className="flex items-center gap-1.5">
                    {alert.icon}
                    <span className="text-[10px] font-semibold text-slate-600">{alert.label}</span>
                  </div>
                  <span
                    className={`text-xl font-black ${alert.color}`}
                    style={{ fontFamily: "Fira Code, monospace" }}
                  >
                    {alert.value}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
          <CardHeader className="pb-2 pt-4 px-5">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold text-slate-700">
                Recent Activity
              </CardTitle>
              <Link to="/leaves" className="text-xs font-semibold text-[#1B6AB5] hover:underline">
                View All
              </Link>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="space-y-2.5">
              {requests.length > 0 ? (
                requests.slice(0, 6).map((r: any, i: number) => (
                  <div key={i} className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-slate-700 truncate">
                        {r.employee_name ?? `Employee #${r.employee_id ?? i + 1}`}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {r.leave_type ?? "Leave"} &middot;{" "}
                        {r.from_date
                          ? new Date(r.from_date).toLocaleDateString("en-IN", {
                              day: "numeric",
                              month: "short",
                            })
                          : "—"}
                      </div>
                    </div>
                    <span
                      className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                        r.status === "pending"
                          ? "bg-amber-100 text-amber-700"
                          : r.status === "approved"
                          ? "bg-green-100 text-green-700"
                          : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {r.status === "pending"
                        ? "Pending"
                        : r.status === "approved"
                        ? "Completed"
                        : (r.status ?? "Unknown")}
                    </span>
                  </div>
                ))
              ) : (
                <div className="text-sm text-slate-400 py-4 text-center">
                  No recent leave requests
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
          <CardHeader className="pb-2 pt-4 px-5">
            <CardTitle className="text-sm font-semibold text-slate-700">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="grid grid-cols-4 gap-2">
              {[
                {
                  label: "Add Employee",
                  icon: <UserPlus className="w-4 h-4" />,
                  to: "/employees",
                  color: "text-[#1B6AB5] bg-blue-50 hover:bg-blue-100",
                },
                {
                  label: "Process Payroll",
                  icon: <BarChart2 className="w-4 h-4" />,
                  to: "/payroll",
                  color: "text-green-700 bg-green-50 hover:bg-green-100",
                },
                {
                  label: "Approve Leave",
                  icon: <CheckCircle2 className="w-4 h-4" />,
                  to: "/leaves",
                  color: "text-amber-700 bg-amber-50 hover:bg-amber-100",
                },
                {
                  label: "Create Vacancy",
                  icon: <Briefcase className="w-4 h-4" />,
                  to: "/ats/command-center",
                  color: "text-purple-700 bg-purple-50 hover:bg-purple-100",
                },
                {
                  label: "Generate Report",
                  icon: <FileText className="w-4 h-4" />,
                  to: "/reports",
                  color: "text-slate-700 bg-slate-50 hover:bg-slate-100",
                },
                {
                  label: "Upload Document",
                  icon: <Upload className="w-4 h-4" />,
                  to: "/profile",
                  color: "text-cyan-700 bg-cyan-50 hover:bg-cyan-100",
                },
                {
                  label: "Bulk Attendance",
                  icon: <Clock className="w-4 h-4" />,
                  to: "/bulk-upload",
                  color: "text-orange-700 bg-orange-50 hover:bg-orange-100",
                },
                {
                  label: "Helpdesk Ticket",
                  icon: <Headphones className="w-4 h-4" />,
                  to: "/helpdesk",
                  color: "text-pink-700 bg-pink-50 hover:bg-pink-100",
                },
              ].map((action) => (
                <Link
                  key={action.label}
                  to={action.to}
                  className={`flex flex-col items-center justify-center gap-1.5 rounded-xl p-2.5 transition-colors ${action.color}`}
                >
                  {action.icon}
                  <span className="text-[9px] font-semibold text-center leading-tight">
                    {action.label}
                  </span>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
