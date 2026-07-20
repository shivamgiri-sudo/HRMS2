import { useQuery } from "@tanstack/react-query";
import { Users, Activity, AlertTriangle, Target, Clock, UserCheck, UserX } from "lucide-react";
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
  const todayIST = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

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

  const { data: liveData } = useQuery<any>({
    queryKey: ["rta-live-summary", todayIST],
    queryFn: () => hrmsApi.get(`/api/rta/live-summary?date=${todayIST}`),
    staleTime: 1000 * 60 * 2,
    refetchInterval: 1000 * 60 * 2,
  });

  const summary = wfData?.data?.summary ?? {};
  const metrics = summaryData?.data?.metrics ?? {};
  const alerts: any[] = Array.isArray(alertsData?.data) ? alertsData.data : [];
  const live = liveData?.data ?? liveData ?? {};

  const total        = summary.active_headcount ?? 0;
  const attPct       = summary.attendance_pct ?? 0;
  const presentCount = Number(live.logged_in  ?? Math.round((attPct / 100) * total));
  const lateCount    = Number(live.late_count ?? 0);
  const absentCount  = Number(live.absent     ?? 0);
  const onLeaveCount: number | null = summary.on_leave ?? null;

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
    },
    {
      label: "Late Arrivals",
      value: lateCount,
      helper: "Attendance exceptions today",
      icon: <Clock className="w-4 h-4" />,
      accent: "#F59E0B",
    },
    {
      label: "Absent Today",
      value: absentCount,
      helper: "Unplanned absences",
      icon: <UserX className="w-4 h-4" />,
      accent: "#E8231A",
    },
    {
      label: "On Leave",
      value: onLeaveCount,
      helper: onLeaveCount === null ? "Not yet available" : "Approved leave",
      icon: <AlertTriangle className="w-4 h-4" />,
      accent: "#8B5CF6",
    },
  ];

  // Work inbox items: sourced from live API (AlertsData / work inbox)
  const inboxAlerts: any[] = Array.isArray(alertsData?.data?.items) ? alertsData.data.items
    : Array.isArray(alertsData?.data) ? alertsData.data : [];
  const workItems = inboxAlerts.length > 0 ? inboxAlerts.map((item: any) => ({
    icon: <Activity className="w-4 h-4" />,
    title: item.title ?? item.type ?? "Action",
    subtitle: item.description ?? item.subtitle ?? "",
    count: item.count ?? 1,
    href: item.href ?? "/work-inbox",
    color: "bg-blue-100 text-blue-700",
    timestamp: "",
  })) : [];

  // Shift coverage: from API if available, otherwise empty (no fabricated ratios)
  const shiftsRaw: any[] = Array.isArray(wfData?.data?.shifts) ? wfData.data.shifts : [];
  const shifts = shiftsRaw.map((s: any) => ({
    name: s.shift_name ?? s.name ?? "Shift",
    scheduled: s.scheduled ?? s.required ?? 0,
    actual: s.actual ?? s.present ?? 0,
    adherence: s.adherence_pct ?? s.adherence ?? null,
  }));

  // Regularization: from API if available, otherwise empty (no fabricated counts)
  const regRaw: any[] = Array.isArray(metrics?.regularization?.rows) ? metrics.regularization.rows
    : Array.isArray(wfData?.data?.regularization) ? wfData.data.regularization : [];
  const regularizationRows = regRaw.map((r: any) => ({
    reason: r.reason ?? r.type ?? "Request",
    count: r.count ?? 0,
    status: r.status ?? "Pending",
    color: "bg-amber-100 text-amber-700",
  }));

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
