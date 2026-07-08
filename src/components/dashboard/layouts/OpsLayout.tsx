import { useQuery } from "@tanstack/react-query";
import { Users, Activity, AlertTriangle, Target, Clock } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { HeroBanner } from "../widgets/HeroBanner";
import { KpiRow } from "../widgets/KpiRow";
import { AiBriefingPanel } from "../widgets/AiBriefingPanel";
import { WorkInboxPanel } from "../widgets/WorkInboxPanel";
import { AttendanceDonutChart } from "../widgets/AttendanceDonutChart";
import { useDashboardUser } from "../widgets/useDashboardUser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function OpsLayout() {
  const { firstName } = useDashboardUser();

  const { data: wfData } = useQuery<any>({
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
  const alerts: any[] = alertsData?.data ?? [];

  const kpiTiles = [
    { label: "Required HC", value: summary.active_headcount ?? 0, helper: "vs Yesterday +1.46%", icon: <Users className="w-4 h-4" />, accent: "#1B6AB5", trend: "up" as const, variancePct: 1.46 },
    { label: "Attendance %", value: summary.attendance_pct ? `${summary.attendance_pct.toFixed(1)}%` : "—", helper: "Today's rate", icon: <Activity className="w-4 h-4" />, accent: "#3BAD49", status: (summary.attendance_pct ?? 0) >= 90 ? ("ok" as const) : ("warn" as const) },
    { label: "Roster Adherence", value: summary.shrinkage_pct != null ? `${(100 - summary.shrinkage_pct).toFixed(1)}%` : "—", helper: "vs Yesterday", icon: <Target className="w-4 h-4" />, accent: "#8B5CF6", trend: "up" as const, variancePct: 1.98 },
    { label: "Missing Punch", value: 48, helper: "vs Yesterday -7.69%", icon: <Clock className="w-4 h-4" />, accent: "#E8231A", trend: "down" as const, variancePct: 7.69 },
  ];

  const workItems = [
    { icon: <Target className="w-4 h-4" />, title: "Roster Disputes", subtitle: "Requests pending review", count: 24, href: "/wfm/roster", color: "bg-blue-100 text-blue-700", timestamp: "12m ago" },
    { icon: <AlertTriangle className="w-4 h-4" />, title: "Attendance Exceptions", subtitle: "Early outs, late ins, OT approvals", count: 52, href: "/attendance", color: "bg-amber-100 text-amber-700", timestamp: "25m ago" },
    { icon: <Clock className="w-4 h-4" />, title: "Missing Punches", subtitle: "Employees with incomplete punches", count: 48, href: "/attendance", color: "bg-red-100 text-red-700", timestamp: "30m ago" },
    { icon: <Users className="w-4 h-4" />, title: "Staffing Gap Follow-ups", subtitle: "Open actions to close staffing gaps", count: 18, href: "/wfm/live", color: "bg-red-100 text-red-700", timestamp: "45m ago" },
  ];

  return (
    <div className="space-y-6">
      <HeroBanner
        title="WFM / Attendance Dashboard"
        subtitle="Monitor workforce attendance, schedules and compliance in real time"
        roleChip="WFM View"
        chipColor="bg-emerald-50 text-emerald-700 border-emerald-200"
        updatedAt="Updated just now"
      />
      <KpiRow tiles={kpiTiles} cols={4} />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
            <CardHeader className="flex flex-row items-center gap-2 border-b border-slate-100 pb-4 pt-5 px-5">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <CardTitle className="text-sm font-bold text-slate-900">Today's Operations Alerts</CardTitle>
              {alerts.length > 0 && <span className="w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center ml-1">{alerts.length}</span>}
            </CardHeader>
            <CardContent className="p-0">
              {alerts.length === 0 ? (
                <div className="py-8 text-center text-sm text-slate-400">No active alerts</div>
              ) : (
                alerts.slice(0, 5).map((alert: any, i: number) => (
                  <div key={i} className="flex items-center gap-4 px-5 py-3.5 border-b border-slate-50 last:border-0 hover:bg-slate-50">
                    <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                      <AlertTriangle className="w-4 h-4 text-slate-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800">{alert.title ?? alert.message ?? "Alert"}</p>
                      <p className="text-xs text-slate-500 truncate">{alert.description ?? ""}</p>
                    </div>
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${alert.severity === "high" ? "bg-red-100 text-red-700" : alert.severity === "medium" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>
                      {alert.severity ?? "Info"}
                    </span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
          <AiBriefingPanel dashboardCode="hr" title="Workforce AI Analysis" subtitle="Real-time workforce insights" />
        </div>
        <div className="space-y-6">
          <WorkInboxPanel items={workItems} />
          <AttendanceDonutChart />
        </div>
      </div>
    </div>
  );
}
