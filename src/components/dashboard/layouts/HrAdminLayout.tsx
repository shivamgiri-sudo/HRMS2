import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { Users, Briefcase, Clock, UserPlus, FileCheck, TrendingDown } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { HeroBanner } from "../widgets/HeroBanner";
import { KpiRow } from "../widgets/KpiRow";
import { NotificationsFeed } from "../widgets/NotificationsFeed";
import { PendingActionsWidget } from "../widgets/PendingActionsWidget";
import { MovementChart } from "../widgets/MovementChart";
import { AttendanceDonutChart } from "../widgets/AttendanceDonutChart";
import { TrainingWidget } from "../widgets/TrainingWidget";
import { AtsPipelineChart } from "../widgets/AtsPipelineChart";
import { WhosOut } from "@/components/dashboard/WhosOut";
import { UpcomingCelebrations } from "@/components/dashboard/UpcomingCelebrations";

export function HrAdminLayout() {
  const { user } = useAuth();
  const firstName = user?.name?.split(" ")[0] ?? "User";

  const { data: summaryData } = useQuery({
    queryKey: ["hr-dashboard"],
    queryFn: () => hrmsApi.get("/api/dashboards/hr/summary"),
    staleTime: 1000 * 60 * 3,
  });

  const { data: wfData } = useQuery({
    queryKey: ["workforce-dashboard"],
    queryFn: () => hrmsApi.get("/api/management/workforce-dashboard"),
    staleTime: 1000 * 60 * 5,
  });

  const summary = summaryData?.data;
  const workforce = wfData?.data;

  const kpiTiles = [
    {
      label: "Active HC",
      value: workforce?.headcount?.active ?? 0,
      helper: "Current headcount",
      icon: <Users className="h-4 w-4" />,
      accent: "#1B6AB5",
      status: "ok" as const,
    },
    {
      label: "Attendance",
      value: `${(workforce?.attendance?.attendance_pct ?? 0).toFixed(1)}%`,
      helper: "Today's attendance",
      icon: <Briefcase className="h-4 w-4" />,
      accent: "#3BAD49",
      status: (workforce?.attendance?.attendance_pct ?? 0) >= 90 ? ("ok" as const) : ("warn" as const),
    },
    {
      label: "Pending Approvals",
      value: summary?.workItems?.length ?? 0,
      helper: "Requires action",
      icon: <Clock className="h-4 w-4" />,
      accent: "#F59E0B",
      status: (summary?.workItems?.length ?? 0) > 10 ? ("warn" as const) : ("ok" as const),
    },
    {
      label: "Onboarding",
      value: workforce?.training?.onboarding_in_progress ?? 0,
      helper: "In progress",
      icon: <UserPlus className="h-4 w-4" />,
      accent: "#22D3EE",
      status: "ok" as const,
    },
    {
      label: "BGV Pending",
      value: workforce?.bgv_pending ?? 0,
      helper: "Awaiting verification",
      icon: <FileCheck className="h-4 w-4" />,
      accent: "#8B5CF6",
      status: (workforce?.bgv_pending ?? 0) > 5 ? ("warn" as const) : ("ok" as const),
    },
    {
      label: "Attrition (30d)",
      value: `${(workforce?.attrition_30d ?? 0).toFixed(1)}%`,
      helper: "Last 30 days",
      icon: <TrendingDown className="h-4 w-4" />,
      accent: "#E8231A",
      status: (workforce?.attrition_30d ?? 0) > 10 ? ("critical" as const) : ("ok" as const),
    },
  ];

  const quickStats = [
    { label: "HC", value: workforce?.headcount?.active ?? 0 },
    { label: "Attendance", value: `${(workforce?.attendance?.attendance_pct ?? 0).toFixed(0)}%` },
    { label: "Pending", value: summary?.workItems?.length ?? 0 },
    { label: "Onboarding", value: workforce?.training?.onboarding_in_progress ?? 0 },
  ];

  return (
    <div className="space-y-6 p-6 !bg-slate-50 min-h-screen">
      <HeroBanner
        userName={firstName}
        roleLabel="HR Admin"
        roleBadgeColor="bg-blue-600"
        quickStats={quickStats}
      />

      <KpiRow tiles={kpiTiles} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <PendingActionsWidget />
        </div>
        <div>
          <NotificationsFeed />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <MovementChart />
        <AttendanceDonutChart />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <TrainingWidget />
        <AtsPipelineChart />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <WhosOut />
        <UpcomingCelebrations />
      </div>

    </div>
  );
}
