import { useQuery } from "@tanstack/react-query";
import { Users, UserCheck, Umbrella, UserX, UserPlus, Briefcase, BarChart2, Calendar, Clock, AlertTriangle, CheckSquare, Activity } from "lucide-react";
import { Link } from "react-router-dom";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip, Line, LineChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { hrmsApi } from "@/lib/hrmsApi";
import { HeroBanner } from "../widgets/HeroBanner";
import { KpiRow } from "../widgets/KpiRow";
import { QuickLinksGrid, QuickLink } from "../widgets/QuickLinksGrid";
import { useDashboardUser } from "../widgets/useDashboardUser";

function initials(name: string) {
  return name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
}

const PRIORITY: Record<string, string> = {
  high:   "text-red-600 bg-red-50",
  medium: "text-amber-600 bg-amber-50",
  low:    "text-slate-500 bg-slate-100",
};

export function ManagerLayout() {
  const { firstName } = useDashboardUser();

  const { data: wfData } = useQuery<any>({ queryKey: ["workforce-dashboard"], queryFn: () => hrmsApi.get("/api/management/workforce-dashboard"), staleTime: 60000 * 5 });
  const { data: teamData } = useQuery<any>({ queryKey: ["team-members"], queryFn: () => hrmsApi.get("/api/management/team-members"), staleTime: 60000 * 5 });
  const { data: kpiData } = useQuery<any>({ queryKey: ["team-kpi"], queryFn: () => hrmsApi.get("/api/management/team-kpi"), staleTime: 60000 * 5 });
  const { data: coachData } = useQuery<any>({ queryKey: ["coaching"], queryFn: () => hrmsApi.get("/api/management/coaching"), staleTime: 60000 * 5 });
  const { data: alertsData } = useQuery<any>({ queryKey: ["mgr-alerts"], queryFn: () => hrmsApi.get("/api/management/alerts"), staleTime: 60000 * 2 });
  const { data: summaryData } = useQuery<any>({ queryKey: ["dashboard-summary-hr"], queryFn: () => hrmsApi.get("/api/dashboards/hr/summary"), staleTime: 60000 * 3 });
  const { data: leaveReqs } = useQuery<any>({ queryKey: ["leave-requests-all"], queryFn: () => hrmsApi.get("/api/leave/requests"), staleTime: 60000 * 5 });
  const { data: atsData } = useQuery<any>({ queryKey: ["ats-stats"], queryFn: () => hrmsApi.get("/api/ats/stats"), staleTime: 60000 * 5 });
  const { data: actionsData } = useQuery<any>({ queryKey: ["my-actions"], queryFn: () => hrmsApi.get("/api/engagement-intelligence/actions"), staleTime: 60000 * 5 });

  const summary = wfData?.data?.summary ?? {};
  const members: any[] = Array.isArray(teamData?.data) ? teamData.data : [];
  const kpiList: any[] = Array.isArray(kpiData?.data) ? kpiData.data : [];
  const coaching: any[] = Array.isArray(coachData?.data) ? coachData.data.slice(0, 3) : [];
  const alerts: any[] = Array.isArray(alertsData?.data) ? alertsData.data.slice(0, 3) : [];
  const requests: any[] = Array.isArray(leaveReqs?.data) ? leaveReqs.data : [];
  const actions: any[] = Array.isArray(actionsData?.data) ? actionsData.data.filter((a: any) => a.status !== "completed").slice(0, 5) : [];

  const pendingLeave = requests.filter((r: any) => r.status === "pending").length;
  const approvedLeave = requests.filter((r: any) => r.status === "approved").length;
  const rejectedLeave = requests.filter((r: any) => r.status === "rejected").length;

  const attPct = summary.attendance_pct ?? 0;
  const presentCount = summary.present_count ?? Math.round((attPct / 100) * members.length);
  const absentCount = summary.absent_count ?? Math.max(members.length - presentCount, 0);

  const kpiTiles = [
    { label: "Team Members", value: members.length, helper: "Total", icon: <Users className="w-4 h-4" />, accent: "#1B6AB5" },
    { label: "Present Today", value: presentCount, helper: `${attPct.toFixed(0)}%`, icon: <UserCheck className="w-4 h-4" />, accent: "#3BAD49", status: attPct >= 80 ? "ok" as const : "warn" as const },
    { label: "On Leave", value: pendingLeave + approvedLeave, helper: `${members.length > 0 ? (((pendingLeave + approvedLeave) / members.length) * 100).toFixed(1) : 0}%`, icon: <Umbrella className="w-4 h-4" />, accent: "#F59E0B" },
    { label: "Absent", value: absentCount > 0 ? absentCount : 0, helper: `${members.length > 0 ? ((absentCount / members.length) * 100).toFixed(1) : 0}%`, icon: <UserX className="w-4 h-4" />, accent: "#E8231A" },
    { label: "New Joiners", value: summary.new_joiners_30d ?? 0, helper: "+this month", icon: <UserPlus className="w-4 h-4" />, accent: "#22D3EE" },
    { label: "Open Positions", value: Object.values(atsData?.data?.by_stage ?? {}).reduce((s: number, p: any) => s + (p.value ?? 0), 0), helper: "View jobs", icon: <Briefcase className="w-4 h-4" />, accent: "#8B5CF6", href: "/ats/command-center" },
  ];

  const attDonut = [
    { name: "Present", value: presentCount, fill: "#3BAD49" },
    { name: "On Leave", value: pendingLeave + approvedLeave, fill: "#F59E0B" },
    { name: "Absent", value: Math.max(absentCount, 0), fill: "#E8231A" },
  ].filter(d => d.value > 0);

  const trendData = kpiList.slice(-14).map((k: any) => ({
    date: k.period ?? "",
    score: k.overall_score ?? 0,
  }));

  const quickLinks: QuickLink[] = [
    { label: "Team Directory", href: "/employees", icon: Users, iconBg: "bg-blue-100", iconColor: "text-blue-600" },
    { label: "Attendance Report", href: "/attendance", icon: Activity, iconBg: "bg-emerald-100", iconColor: "text-emerald-600" },
    { label: "Leave Calendar", href: "/leaves", icon: Calendar, iconBg: "bg-amber-100", iconColor: "text-amber-600" },
    { label: "Performance Report", href: "/performance", icon: BarChart2, iconBg: "bg-violet-100", iconColor: "text-violet-600" },
    { label: "Team Timesheets", href: "/work-inbox", icon: Clock, iconBg: "bg-cyan-100", iconColor: "text-cyan-600" },
    { label: "Announcements", href: "/notifications", icon: AlertTriangle, iconBg: "bg-slate-100", iconColor: "text-slate-600" },
  ];

  // Suppress unused warning; firstName may be used in the future or by parent
  void firstName;

  return (
    <div className="space-y-6">
      <HeroBanner
        title="Manager Dashboard"
        subtitle="Overview of your team and key management insights."
        roleChip="Manager View"
        chipColor="bg-emerald-50 text-emerald-700 border-emerald-200"
        updatedAt="Updated just now"
      />

      <KpiRow tiles={kpiTiles} />

      {/* Row 2: Team Attendance | Leave Requests | Team Members */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Team Attendance donut */}
        <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
          <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 pb-4 pt-5 px-5">
            <CardTitle className="text-sm font-bold text-slate-900">Team Attendance</CardTitle>
            <Link to="/attendance" className="text-xs font-semibold text-[#1B6AB5] hover:underline">View Details →</Link>
          </CardHeader>
          <CardContent className="p-5">
            <div className="flex items-center gap-4">
              <div className="relative">
                <ResponsiveContainer width={110} height={110}>
                  <PieChart>
                    <Pie data={attDonut} dataKey="value" cx="50%" cy="50%" innerRadius={30} outerRadius={50} paddingAngle={2}>
                      {attDonut.map((e, i) => <Cell key={i} fill={e.fill} />)}
                    </Pie>
                    <Tooltip contentStyle={{ backgroundColor: "#0f172a", border: "none", borderRadius: "8px", color: "#f1f5f9", fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-base font-black text-slate-900" style={{ fontFamily: "'Fira Code', monospace" }}>{attPct.toFixed(0)}%</span>
                  <span className="text-[8px] text-slate-500">Present</span>
                </div>
              </div>
              <div className="space-y-1.5">
                {attDonut.map((d, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.fill }} />
                    <span className="text-xs text-slate-600">{d.name}</span>
                    <span className="text-xs font-bold text-slate-800 ml-auto" style={{ fontFamily: "'Fira Code', monospace" }}>{d.value}</span>
                  </div>
                ))}
                <p className="text-[10px] text-slate-400 mt-1">Based on {members.length} team members</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Leave Requests Summary */}
        <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
          <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 pb-4 pt-5 px-5">
            <CardTitle className="text-sm font-bold text-slate-900">Leave Requests Summary</CardTitle>
            <Link to="/leaves" className="text-xs font-semibold text-[#1B6AB5] hover:underline">View All →</Link>
          </CardHeader>
          <CardContent className="p-5 space-y-3">
            {[
              { label: "Pending Approval", count: pendingLeave, icon: <Clock className="w-4 h-4 text-amber-500" />, color: "text-amber-600" },
              { label: "Approved", count: approvedLeave, icon: <UserCheck className="w-4 h-4 text-emerald-500" />, color: "text-emerald-600" },
              { label: "Rejected", count: rejectedLeave, icon: <UserX className="w-4 h-4 text-red-500" />, color: "text-red-600" },
            ].map((row, i) => (
              <div key={i} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer">
                <div className="flex items-center gap-2.5">
                  {row.icon}
                  <span className="text-sm text-slate-700">{row.label}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-lg font-black ${row.color}`} style={{ fontFamily: "'Fira Code', monospace" }}>{row.count}</span>
                  <span className="text-xs text-[#1B6AB5] font-semibold">View →</span>
                </div>
              </div>
            ))}
            <p className="text-xs text-slate-500 text-center">Total Requests: <span className="font-bold">{requests.length}</span></p>
          </CardContent>
        </Card>

        {/* Team Member Status */}
        <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
          <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 pb-4 pt-5 px-5">
            <CardTitle className="text-sm font-bold text-slate-900">Team Member Status</CardTitle>
            <Link to="/employees" className="text-xs font-semibold text-[#1B6AB5] hover:underline">View All →</Link>
          </CardHeader>
          <CardContent className="p-0">
            {members.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-400">No team members</div>
            ) : (
              members.slice(0, 5).map((m: any, i: number) => (
                <div key={i} className="flex items-center gap-3 px-5 py-3 border-b border-slate-50 last:border-0 hover:bg-slate-50">
                  <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-700 flex-shrink-0">
                    {initials(m.full_name ?? "?")}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{m.full_name}</p>
                    <p className="text-[11px] text-slate-500">{m.employee_code}</p>
                  </div>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Present</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Row 3: Performance Trend | My Tasks */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
            <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 pb-4 pt-5 px-5">
              <CardTitle className="text-sm font-bold text-slate-900">Team Performance Trend</CardTitle>
              <span className="text-xs text-slate-400">This Month</span>
            </CardHeader>
            <CardContent className="p-4">
              {kpiData == null ? <Skeleton className="h-48 w-full rounded-xl" /> : trendData.length === 0 ? (
                <div className="flex items-center justify-center h-48 text-sm text-slate-400">No performance data</div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis domain={[0, 100]} tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ backgroundColor: "#0f172a", border: "none", borderRadius: "8px", color: "#f1f5f9", fontSize: 11 }} />
                    <Line type="monotone" dataKey="score" stroke="#1B6AB5" strokeWidth={2} dot={{ fill: "#1B6AB5", r: 3 }} activeDot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              )}
              <p className="text-[10px] text-slate-400 mt-1">Performance Score (%)</p>
            </CardContent>
          </Card>
        </div>

        <div>
          <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
            <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 pb-4 pt-5 px-5">
              <CardTitle className="text-sm font-bold text-slate-900">My Tasks</CardTitle>
              <Link to="/work-inbox" className="text-xs font-semibold text-[#1B6AB5] hover:underline">View All →</Link>
            </CardHeader>
            <CardContent className="p-0">
              {actions.length === 0 ? (
                <div className="py-6 text-center text-sm text-slate-400">No pending tasks</div>
              ) : (
                actions.map((a: any, i: number) => (
                  <div key={i} className="flex items-center gap-3 px-5 py-3 border-b border-slate-50 last:border-0 hover:bg-slate-50">
                    <CheckSquare className="w-4 h-4 text-slate-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-800 truncate">
                        {(a.action_type ?? "Task").replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}
                      </p>
                      {a.due_date && (
                        <p className="text-[10px] text-slate-400">
                          {new Date(a.due_date).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })}
                        </p>
                      )}
                    </div>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${PRIORITY[a.priority ?? "low"] ?? PRIORITY.low}`}>
                      {(a.priority ?? "Low").charAt(0).toUpperCase() + (a.priority ?? "low").slice(1)}
                    </span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Quick Links */}
      <QuickLinksGrid title="Quick Links" links={quickLinks} cols={6} />

      {/* Row 4: Pending Approvals | Coaching Follow-ups | Escalation Alerts */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Pending Approvals */}
        <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
          <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 pb-4 pt-5 px-5">
            <CardTitle className="text-sm font-bold text-slate-900">Pending Approvals</CardTitle>
            <Link to="/work-inbox" className="text-xs font-semibold text-[#1B6AB5] hover:underline">View All Approvals →</Link>
          </CardHeader>
          <CardContent className="p-4 space-y-2">
            {[
              { label: "Leave Requests", count: pendingLeave, icon: <Umbrella className="w-4 h-4 text-amber-500" />, href: "/leaves" },
              { label: "Timesheets", count: summaryData?.data?.workItems?.pending_count ?? 0, icon: <Clock className="w-4 h-4 text-blue-500" />, href: "/work-inbox" },
              { label: "Expense Claims", count: 0, icon: <Briefcase className="w-4 h-4 text-slate-500" />, href: "/work-inbox" },
            ].map((row, i) => (
              <Link key={i} to={row.href} className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors">
                {row.icon}
                <span className="flex-1 text-sm text-slate-700">{row.label}</span>
                <span className="w-7 h-6 flex items-center justify-center rounded-full bg-amber-100 text-amber-700 text-xs font-bold">{row.count}</span>
                <span className="text-slate-400 text-xs">›</span>
              </Link>
            ))}
          </CardContent>
        </Card>

        {/* Coaching Follow-ups */}
        <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
          <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 pb-4 pt-5 px-5">
            <CardTitle className="text-sm font-bold text-slate-900">Coaching Follow-ups</CardTitle>
            <Link to="/performance" className="text-xs font-semibold text-[#1B6AB5] hover:underline">View All →</Link>
          </CardHeader>
          <CardContent className="p-0">
            {coaching.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-400">No coaching sessions</div>
            ) : (
              coaching.map((c: any, i: number) => (
                <div key={i} className="flex items-start gap-3 px-5 py-3.5 border-b border-slate-50 last:border-0 hover:bg-slate-50">
                  <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-700 flex-shrink-0">
                    {initials(c.employee_name ?? "?")}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800">{c.employee_name}</p>
                    <p className="text-[11px] text-slate-500 truncate">{c.notes ?? c.session_type ?? "Session"}</p>
                  </div>
                  <span className="text-[10px] text-slate-400 flex-shrink-0">
                    {c.session_date ? new Date(c.session_date).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }) : ""}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Escalation Alerts */}
        <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
          <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 pb-4 pt-5 px-5">
            <CardTitle className="text-sm font-bold text-slate-900">Escalation Alerts</CardTitle>
            <Link to="/work-inbox" className="text-xs font-semibold text-[#1B6AB5] hover:underline">View All →</Link>
          </CardHeader>
          <CardContent className="p-0">
            {alerts.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-400">No escalations</div>
            ) : (
              alerts.map((a: any, i: number) => (
                <div key={i} className="flex items-start gap-3 px-5 py-3.5 border-b border-slate-50 last:border-0 hover:bg-slate-50">
                  <AlertTriangle className={`w-4 h-4 flex-shrink-0 mt-0.5 ${a.severity === "high" ? "text-red-500" : "text-amber-500"}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{a.title ?? "Alert"}</p>
                    <p className="text-[11px] text-slate-500 truncate">{a.description ?? ""}</p>
                  </div>
                  <button className="text-xs font-semibold text-[#1B6AB5] hover:underline flex-shrink-0">View</button>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
