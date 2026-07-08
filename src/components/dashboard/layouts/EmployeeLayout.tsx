import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { Calendar, Palmtree, CheckSquare, Award, TrendingUp, Medal } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { HeroBanner } from "../widgets/HeroBanner";
import { KpiRow } from "../widgets/KpiRow";
import { NotificationsFeed } from "../widgets/NotificationsFeed";
import { MyAttendanceWidget } from "../widgets/MyAttendanceWidget";
import { LeaveBalanceWidget } from "../widgets/LeaveBalanceWidget";
import { PendingActionsWidget } from "../widgets/PendingActionsWidget";
import { WhosOut } from "@/components/dashboard/WhosOut";
import { UpcomingCelebrations } from "@/components/dashboard/UpcomingCelebrations";

export function EmployeeLayout() {
  const { user } = useAuth();
  const firstName = user?.name?.split(" ")[0] ?? "User";

  const { data: attData } = useQuery({
    queryKey: ["my-attendance"],
    queryFn: () => hrmsApi.get("/api/attendance/my-summary"),
    staleTime: 1000 * 60 * 5,
  });

  const { data: leaveData } = useQuery({
    queryKey: ["my-leave-balance"],
    queryFn: () => hrmsApi.get("/api/leave/balance"),
    staleTime: 1000 * 60 * 5,
  });

  const { data: engagementData } = useQuery({
    queryKey: ["my-engagement"],
    queryFn: () => hrmsApi.get("/api/engagement/me"),
    staleTime: 1000 * 60 * 5,
  });

  const attSummary = attData?.data;
  const leaveBalance = leaveData?.data?.balance ?? 0;
  const engagement = engagementData?.data;

  const attendancePct = attSummary?.attendance_pct ?? 0;

  const kpiTiles = [
    {
      label: "My Attendance",
      value: `${attendancePct.toFixed(0)}%`,
      helper: "This month",
      icon: <Calendar className="h-4 w-4" />,
      accent: "#3BAD49",
      status: attendancePct >= 90 ? ("ok" as const) : ("warn" as const),
    },
    {
      label: "Leave Balance",
      value: leaveBalance,
      helper: `of ${leaveData?.data?.total ?? 25} days`,
      icon: <Palmtree className="h-4 w-4" />,
      accent: "#22D3EE",
      status: leaveBalance < 3 ? ("warn" as const) : ("ok" as const),
    },
    {
      label: "Open Tasks",
      value: engagement?.open_tasks ?? 0,
      helper: "Pending items",
      icon: <CheckSquare className="h-4 w-4" />,
      accent: "#F59E0B",
      status: (engagement?.open_tasks ?? 0) > 5 ? ("warn" as const) : ("ok" as const),
    },
    {
      label: "My Points",
      value: engagement?.points ?? 0,
      helper: "Total earned",
      icon: <Award className="h-4 w-4" />,
      accent: "#8B5CF6",
      status: "ok" as const,
    },
    {
      label: "Current Tier",
      value: engagement?.tier ?? "Bronze",
      helper: "Engagement level",
      icon: <TrendingUp className="h-4 w-4" />,
      accent: "#1B6AB5",
      status: "ok" as const,
    },
    {
      label: "Badges",
      value: engagement?.badges ?? 0,
      helper: "Achievements",
      icon: <Medal className="h-4 w-4" />,
      accent: "#F59E0B",
      status: "ok" as const,
    },
  ];

  const quickStats = [
    { label: "Attendance", value: `${attendancePct.toFixed(0)}%` },
    { label: "Leave", value: leaveBalance },
    { label: "Tasks", value: engagement?.open_tasks ?? 0 },
    { label: "Points", value: engagement?.points ?? 0 },
  ];

  return (
    <div className="space-y-6 p-6 !bg-slate-50 min-h-screen">
      <HeroBanner
        userName={firstName}
        roleLabel="Employee"
        roleBadgeColor="bg-slate-600"
        quickStats={quickStats}
      />

      <KpiRow tiles={kpiTiles} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <MyAttendanceWidget />
        </div>
        <div>
          <NotificationsFeed />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <LeaveBalanceWidget />
        <PendingActionsWidget />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <WhosOut />
        <UpcomingCelebrations />
      </div>

    </div>
  );
}
