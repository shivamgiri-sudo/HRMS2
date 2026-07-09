import { useQuery } from "@tanstack/react-query";
import { Users, Activity, AlertTriangle, Target, Clock, UserCheck, UserX, Home } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { HeroBanner } from "../widgets/HeroBanner";
import { KpiRow } from "../widgets/KpiRow";
import { AiBriefingPanel } from "../widgets/AiBriefingPanel";
import { WorkInboxPanel } from "../widgets/WorkInboxPanel";
import { LiveAttendanceDonut } from "../widgets/LiveAttendanceDonut";
import { useDashboardUser } from "../widgets/useDashboardUser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function OpsLayout() {
  const { firstName } = useDashboardUser();

  const { data: wfData, isLoading: wfLoading } = useQuery<any>({
    queryKey: ["workforce-dashboard"],
    queryFn: () => hrmsApi.get("/api/management/workforce-dashboard"),
    staleTime: 1000 * 60 * 5,
  });

  const { data: summaryData } = useQuery<any>({
    queryKey: ["dashboard-summary-hr"],
    queryFn: () => hrmsApi.get("/api/dashboards/hr/summary"),
    staleTime: 1000 * 60 * 3,
  });

  const { data: alertsData } = useQuery<any>({
    queryKey: ["management-alerts"],
    queryFn: () => hrmsApi.get("/api/management/alerts"),
    staleTime: 1000 * 60 * 2,
  });

  const summary = wfData?.data?.summary ?? {};
  const metrics = summaryData?.data?.metrics ?? {};
  const alerts: any[] = Array.isArray(alertsData?.data) ? alertsData.data : [];

  const total = summary.active_headcount ?? 0;
  const attPct = summary.attendance_pct ?? 0;
  const presentCount = Math.round((attPct / 100) * total);
  // TODO: Replace fixed percentages with real WFM live data from /api/rta/live-summary or /api/wfm/attendance/today-live
  // Current values are derived from fixed assumptions; should reflect actual daily breakdown
  const lateCount = Math.round(total * 0.078);      // Placeholder: 7.8% of headcount
  const absentCount = Math.round(total * 0.189);    // Placeholder: 18.9% of headcount
  const onLeaveCount = Math.round(total * 0.018);   // Placeholder: 1.8% of headcount
  const wfhCount = Math.round(total * 0.028);       // Placeholder: 2.8% of headcount

  const kpiTiles = [
    {
      label: "Total Employees",
      value: total,
      helper: "Active headcount",
      icon: <Users className="w-4 h-4" />,
      accent: "#1B6AB5",
    },
    {
      label: "Present Today",
      value: presentCount,
      helper: `${attPct.toFixed(1)}% of headcount`,
      icon: <UserCheck className="w-4 h-4" />,
      accent: "#3BAD49",
      trend: "up" as const,
      variancePct: 1.46,
    },
    {
      label: "Late Arrivals",
      value: lateCount,
      helper: "vs Yesterday -5%",
      icon: <Clock className="w-4 h-4" />,
      accent: "#F59E0B",
      trend: "down" as const,
      variancePct: 5.0,
    },
    {
      label: "Absent Today",
      value: absentCount,
      helper: "Unplanned absences",
      icon: <UserX className="w-4 h-4" />,
      accent: "#E8231A",
      trend: "down" as const,
      variancePct: 7.69,
    },
    {
      label: "On Leave",
      value: onLeaveCount,
      helper: "Approved leave",
      icon: <AlertTriangle className="w-4 h-4" />,
      accent: "#8B5CF6",
    },
    {
      label: "Working Remotely",
      value: wfhCount,
      helper: "WFH today",
      icon: <Home className="w-4 h-4" />,
      accent: "#14B8A6",
    },
  ];

  const workItems = [
    {
      icon: <Target className="w-4 h-4" />,
      title: "Roster Disputes",
      subtitle: "Requests pending review",
      count: 24,
      href: "/wfm/roster",
      color: "bg-blue-100 text-blue-700",
      timestamp: "12m ago",
    },
    {
      icon: <AlertTriangle className="w-4 h-4" />,
      title: "Attendance Exceptions",
      subtitle: "Early outs, late ins, OT approvals",
      count: 52,
      href: "/attendance",
      color: "bg-amber-100 text-amber-700",
      timestamp: "25m ago",
    },
    {
      icon: <Clock className="w-4 h-4" />,
      title: "Missing Punches",
      subtitle: "Employees with incomplete punches",
      count: 48,
      href: "/attendance",
      color: "bg-red-100 text-red-700",
      timestamp: "30m ago",
    },
    {
      icon: <Users className="w-4 h-4" />,
      title: "Staffing Gap Follow-ups",
      subtitle: "Open actions to close staffing gaps",
      count: 18,
      href: "/wfm/live-tracker",
      color: "bg-red-100 text-red-700",
      timestamp: "45m ago",
    },
  ];

  // TODO: Shift summary should come from /api/wfm/shifts/summary or similar endpoint for real adherence data
  // Current values use fixed percentages; need backend integration for actual scheduled vs actual coverage
  const shifts = [
    { name: "Morning (06:00–14:00)", scheduled: Math.round(total * 0.38), actual: Math.round(total * 0.36), adherence: 94.7 },
    { name: "Afternoon (14:00–22:00)", scheduled: Math.round(total * 0.41), actual: Math.round(total * 0.39), adherence: 95.1 },
    { name: "Night (22:00–06:00)", scheduled: Math.round(total * 0.21), actual: Math.round(total * 0.19), adherence: 90.5 },
  ];

  // TODO: Regularization requests should come from /api/wfm/regularization/requests if endpoint exists
  // Currently static placeholder — need real pending regularization counts from backend
  const regularizationRows = [
    { reason: "Missing Punch-In", count: 18, status: "Pending", color: "bg-red-100 text-red-700" },
    { reason: "Missing Punch-Out", count: 12, status: "Pending", color: "bg-amber-100 text-amber-700" },
    { reason: "Early Out Request", count: 7, status: "Pending", color: "bg-blue-100 text-blue-700" },
    { reason: "OT Regularization", count: 11, status: "Pending", color: "bg-violet-100 text-violet-700" },
  ];

  return (
    <div className="space-y-6">
      {/* Hero */}
      <HeroBanner
        title="WFM / Attendance Dashboard"
        subtitle="Monitor workforce attendance, schedules and compliance in real time"
        roleChip="WFM View"
        chipColor="bg-emerald-50 text-emerald-700 border-emerald-200"
        updatedAt="Updated just now"
      />

      {/* Row 1: KPI tiles */}
      <KpiRow tiles={kpiTiles} />

      {/* Row 2 (3-col): LiveAttendanceDonut | Operations Alerts | WorkInboxPanel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Live Attendance Donut */}
        <LiveAttendanceDonut />

        {/* Operations Alerts */}
        <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
          <CardHeader className="flex flex-row items-center gap-2 border-b border-slate-100 pb-4 pt-5 px-5">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <CardTitle className="text-sm font-bold text-slate-900">
              Today's Operations Alerts
            </CardTitle>
            {alerts.length > 0 && (
              <span className="w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center ml-1">
                {alerts.length}
              </span>
            )}
          </CardHeader>
          <CardContent className="p-0">
            {alerts.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-400">No active alerts</div>
            ) : (
              alerts.slice(0, 5).map((alert: any, i: number) => (
                <div
                  key={i}
                  className="flex items-center gap-4 px-5 py-3.5 border-b border-slate-50 last:border-0 hover:bg-slate-50"
                >
                  <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                    <AlertTriangle className="w-4 h-4 text-slate-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800">
                      {alert.title ?? alert.message ?? "Alert"}
                    </p>
                    <p className="text-xs text-slate-500 truncate">{alert.description ?? ""}</p>
                  </div>
                  <span
                    className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                      alert.severity === "high"
                        ? "bg-red-100 text-red-700"
                        : alert.severity === "medium"
                        ? "bg-amber-100 text-amber-700"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {alert.severity ?? "Info"}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Work Inbox */}
        <WorkInboxPanel items={workItems} />
      </div>

      {/* Row 3 (3-col): ShiftSummaryTable | Regularization Requests | AiBriefingPanel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Shift Summary Table */}
        <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
          <CardHeader className="border-b border-slate-100 pb-4 pt-5 px-5">
            <CardTitle className="text-sm font-bold text-slate-900">Shift Coverage Summary</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {wfLoading ? (
              <div className="p-4"><Skeleton className="h-24 w-full rounded-xl" /></div>
            ) : (
              <>
                <div className="grid grid-cols-4 border-b border-slate-100 px-5 py-2">
                  {["Shift", "Sched.", "Actual", "Adhr."].map((h) => (
                    <span key={h} className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      {h}
                    </span>
                  ))}
                </div>
                {shifts.map((s, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-4 items-center px-5 py-3.5 border-b border-slate-50 last:border-0 hover:bg-slate-50"
                  >
                    <span className="text-xs text-slate-700 col-span-1 truncate pr-2">{s.name}</span>
                    <span
                      className="text-xs font-bold text-slate-800 tabular-nums"
                      style={{ fontFamily: "'Fira Code', monospace" }}
                    >
                      {s.scheduled}
                    </span>
                    <span
                      className="text-xs font-bold text-slate-800 tabular-nums"
                      style={{ fontFamily: "'Fira Code', monospace" }}
                    >
                      {s.actual}
                    </span>
                    <span
                      className={`text-xs font-bold tabular-nums ${
                        s.adherence >= 95
                          ? "text-emerald-600"
                          : s.adherence >= 90
                          ? "text-amber-600"
                          : "text-red-600"
                      }`}
                      style={{ fontFamily: "'Fira Code', monospace" }}
                    >
                      {s.adherence}%
                    </span>
                  </div>
                ))}
                <div className="grid grid-cols-4 items-center px-5 py-3 bg-slate-50 rounded-b-2xl">
                  <span className="text-xs font-bold text-slate-700">Total</span>
                  <span
                    className="text-xs font-bold text-slate-800 tabular-nums"
                    style={{ fontFamily: "'Fira Code', monospace" }}
                  >
                    {shifts.reduce((a, s) => a + s.scheduled, 0)}
                  </span>
                  <span
                    className="text-xs font-bold text-slate-800 tabular-nums"
                    style={{ fontFamily: "'Fira Code', monospace" }}
                  >
                    {shifts.reduce((a, s) => a + s.actual, 0)}
                  </span>
                  <span
                    className="text-xs font-bold text-[#1B6AB5] tabular-nums"
                    style={{ fontFamily: "'Fira Code', monospace" }}
                  >
                    {(shifts.reduce((a, s) => a + s.adherence, 0) / shifts.length).toFixed(1)}%
                  </span>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Regularization Requests */}
        <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
          <CardHeader className="border-b border-slate-100 pb-4 pt-5 px-5">
            <CardTitle className="text-sm font-bold text-slate-900">Regularization Requests</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {regularizationRows.map((row, i) => (
              <div
                key={i}
                className="flex items-center justify-between px-5 py-3.5 border-b border-slate-50 last:border-0 hover:bg-slate-50"
              >
                <span className="text-sm text-slate-700">{row.reason}</span>
                <div className="flex items-center gap-3">
                  <span
                    className="text-sm font-bold text-slate-800 tabular-nums"
                    style={{ fontFamily: "'Fira Code', monospace" }}
                  >
                    {row.count}
                  </span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${row.color}`}>
                    {row.status}
                  </span>
                </div>
              </div>
            ))}
            <div className="px-5 py-3 bg-slate-50 rounded-b-2xl flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-600">Total Pending</span>
              <span
                className="text-sm font-black text-slate-900 tabular-nums"
                style={{ fontFamily: "'Fira Code', monospace" }}
              >
                {regularizationRows.reduce((a, r) => a + r.count, 0)}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* AI Briefing */}
        <AiBriefingPanel
          dashboardCode="hr"
          title="Workforce AI Analysis"
          subtitle="Real-time workforce insights and anomalies"
        />
      </div>
    </div>
  );
}
