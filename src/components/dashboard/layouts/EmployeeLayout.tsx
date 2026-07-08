import { useQuery } from "@tanstack/react-query";
import { CalendarCheck, Umbrella, Clock, TrendingUp, FileText, BookOpen, Headphones, FolderOpen } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { useEmployeeProfile } from "@/hooks/useEmployeeProfile";
import { HeroBanner } from "../widgets/HeroBanner";
import { KpiRow } from "../widgets/KpiRow";
import { NotificationsFeed } from "../widgets/NotificationsFeed";
import { LeaveDonutChart } from "../widgets/LeaveDonutChart";
import { WorkInboxPanel } from "../widgets/WorkInboxPanel";
import { QuickLinksGrid, QuickLink } from "../widgets/QuickLinksGrid";
import { UpcomingCelebrations } from "../UpcomingCelebrations";
import { useDashboardUser } from "../widgets/useDashboardUser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function EmployeeLayout() {
  const { firstName } = useDashboardUser();
  const { data: profile } = useEmployeeProfile();
  const employeeId = profile?.id;

  // Current month for attendance query
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  // Real attendance data from WFM endpoint
  const { data: attData } = useQuery<any>({
    queryKey: ["employee-attendance-monthly", employeeId, currentMonth],
    queryFn: () => hrmsApi.get(`/api/wfm/attendance/daily?employeeId=${employeeId}&month=${currentMonth}`),
    enabled: !!employeeId,
    staleTime: 1000 * 60 * 5,
  });

  const { data: empSummary } = useQuery<any>({
    queryKey: ["dashboard-employee-summary"],
    queryFn: () => hrmsApi.get("/api/dashboards/employee/summary"),
    staleTime: 1000 * 60 * 5,
  });

  const { data: leaveData } = useQuery<any>({
    queryKey: ["dashboard-leave-balance"],
    queryFn: () => hrmsApi.get("/api/leave/balance"),
    staleTime: 1000 * 60 * 5,
  });

  const { data: leaveReqs } = useQuery<any>({
    queryKey: ["my-leave-requests"],
    queryFn: () => hrmsApi.get("/api/leave/requests"),
    staleTime: 1000 * 60 * 5,
  });

  const { data: engData } = useQuery<any>({
    queryKey: ["dashboard-engagement-me"],
    queryFn: () => hrmsApi.get("/api/engagement/me"),
    staleTime: 1000 * 60 * 5,
  });

  // Filter to current month only (API returns all records regardless of month param)
  const allRecords: any[] = Array.isArray(attData?.data) ? attData.data : [];
  const attRecords = allRecords.filter(r => (r.date ?? "").startsWith(currentMonth));
  const present = attRecords.filter(r => r.status === "present").length;
  const absent = attRecords.filter(r => r.status === "absent").length;
  const late = attRecords.filter(r => r.status === "late").length;
  const attTotal = present + absent + late;
  const attPct = attTotal > 0 ? (present / attTotal) * 100 : 0;

  const leaveItems: any[] = Array.isArray(leaveData?.data) ? leaveData.data : [];
  const totalAvailable = leaveItems.reduce((s: number, x: any) => s + (x.available_days ?? 0), 0);

  const eng = engData?.data ?? {};
  const points = eng.total_points ?? 0;
  const tierName: string = eng.current_tier?.tier_name ?? "Bronze";
  const badgeCount: number = Array.isArray(eng.badges_earned) ? eng.badges_earned.length : 0;

  const pendingCount = empSummary?.data?.workItems?.pending_count ?? 0;

  const attendanceTiles = [
    { label: "Present Days", value: present > 0 ? present : "—", helper: "This month", icon: <CalendarCheck className="w-4 h-4" />, accent: "#3BAD49", status: "ok" as const },
    { label: "Absent Days", value: absent, helper: "This month", icon: <CalendarCheck className="w-4 h-4" />, accent: absent > 2 ? "#E8231A" : "#F59E0B" },
    { label: "Late Days", value: late, helper: "This month", icon: <Clock className="w-4 h-4" />, accent: "#F59E0B" },
    { label: "Attendance %", value: attPct > 0 ? `${attPct.toFixed(1)}%` : "—", helper: "This month", icon: <TrendingUp className="w-4 h-4" />, accent: attPct >= 90 ? "#3BAD49" : "#F59E0B", status: attPct >= 90 ? ("ok" as const) : ("warn" as const) },
  ];

  const requests: any[] = Array.isArray(leaveReqs?.data) ? leaveReqs.data.slice(0, 3) : [];

  const workItems = [
    ...(pendingCount > 0 ? [{ icon: <Clock className="w-4 h-4" />, title: "Leave Request – Pending Approval", subtitle: "Awaiting manager approval", count: pendingCount, href: "/leaves", color: "bg-amber-100 text-amber-700", timestamp: "2h ago" }] : []),
    { icon: <BookOpen className="w-4 h-4" />, title: "Training Assignment", subtitle: "New module assigned", count: 1, href: "/lms", color: "bg-blue-100 text-blue-700", timestamp: "1d ago" },
    { icon: <FileText className="w-4 h-4" />, title: "Document Acknowledgement", subtitle: "Policy doc pending acknowledgement", count: 1, href: "/documents", color: "bg-slate-100 text-slate-700", timestamp: "2d ago" },
  ];

  const quickLinks: QuickLink[] = [
    { label: "Apply Leave", href: "/leaves", icon: Umbrella, iconBg: "bg-cyan-100", iconColor: "text-cyan-600", subtitle: "Request time off" },
    { label: "View Payslip", href: "/payslip", icon: FileText, iconBg: "bg-emerald-100", iconColor: "text-emerald-600", subtitle: "Check salary details" },
    { label: "Raise Helpdesk", href: "/helpdesk", icon: Headphones, iconBg: "bg-amber-100", iconColor: "text-amber-600", subtitle: "Get support" },
    { label: "My Documents", href: "/documents", icon: FolderOpen, iconBg: "bg-violet-100", iconColor: "text-violet-600", subtitle: "Access your docs" },
  ];

  return (
    <div className="space-y-6">
      <HeroBanner
        title={`Welcome, ${firstName}`}
        subtitle="Your personal dashboard"
        roleChip="Self Service"
        chipColor="bg-blue-50 text-blue-700 border-blue-200"
        quickStats={[
          { label: "Attendance", value: attPct > 0 ? `${attPct.toFixed(0)}%` : "—" },
          { label: "Leave Left", value: `${totalAvailable.toFixed(1)}d` },
          { label: "Points", value: points.toLocaleString() },
          { label: "Tier", value: tierName },
        ]}
      />

      <div>
        <p className="text-sm font-bold text-slate-700 mb-3">My Attendance This Month</p>
        <KpiRow tiles={attendanceTiles} cols={4} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <LeaveDonutChart title="Leave Balance by Type" />
        </div>

        <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
          <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 pb-4 pt-5 px-5">
            <CardTitle className="text-sm font-bold text-slate-900">My Requests</CardTitle>
            <a href="/leaves" className="text-xs font-semibold text-[#1B6AB5] hover:underline">View All</a>
          </CardHeader>
          <CardContent className="p-0">
            {requests.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">No recent requests</p>
            ) : (
              requests.map((req: any, i: number) => (
                <div key={i} className="flex items-center gap-3 px-5 py-3.5 border-b border-slate-50 last:border-0">
                  <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                    <Umbrella className="w-4 h-4 text-slate-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800">{req.leave_name ?? "Leave Request"}</p>
                    <p className="text-xs text-slate-500">{req.from_date} – {req.to_date}</p>
                  </div>
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                    req.status === "approved" ? "bg-emerald-100 text-emerald-700" :
                    req.status === "pending" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"
                  }`}>
                    {(req.status ?? "pending").charAt(0).toUpperCase() + (req.status ?? "pending").slice(1)}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <WorkInboxPanel items={workItems} />
        <NotificationsFeed title="Company Announcements" />
        <UpcomingCelebrations />
      </div>

      <QuickLinksGrid title="Quick Links" links={quickLinks} cols={4} />
    </div>
  );
}
