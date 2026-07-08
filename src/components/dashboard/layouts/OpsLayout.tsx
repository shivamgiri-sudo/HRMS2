import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { Users, Briefcase, Activity, Award, GraduationCap, UserX } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { HeroBanner } from "../widgets/HeroBanner";
import { KpiRow } from "../widgets/KpiRow";
import { NotificationsFeed } from "../widgets/NotificationsFeed";
import { TeamRosterWidget } from "../widgets/TeamRosterWidget";
import { AttendanceDonutChart } from "../widgets/AttendanceDonutChart";
import { PendingActionsWidget } from "../widgets/PendingActionsWidget";
import { TrainingWidget } from "../widgets/TrainingWidget";
import { QuickNavWidget } from "../widgets/QuickNavWidget";
import { WhosOut } from "@/components/dashboard/WhosOut";

export function OpsLayout() {
  const { user } = useAuth();
  const firstName = user?.name?.split(" ")[0] ?? "User";

  const { data: wfData } = useQuery({
    queryKey: ["workforce-dashboard"],
    queryFn: () => hrmsApi.get("/api/management/workforce-dashboard"),
    staleTime: 1000 * 60 * 5,
  });

  const workforce = wfData?.data;
  const att = workforce?.attendance;

  const kpiTiles = [
    {
      label: "Team HC",
      value: workforce?.headcount?.active ?? 0,
      helper: "Your team size",
      icon: <Users className="h-4 w-4" />,
      accent: "#1B6AB5",
      status: "ok" as const,
    },
    {
      label: "Attendance",
      value: `${(att?.attendance_pct ?? 0).toFixed(1)}%`,
      helper: "Today's attendance",
      icon: <Briefcase className="h-4 w-4" />,
      accent: "#3BAD49",
      status: (att?.attendance_pct ?? 0) >= 90 ? ("ok" as const) : ("warn" as const),
    },
    {
      label: "Shrinkage",
      value: `${(workforce?.shrinkage_pct ?? 0).toFixed(1)}%`,
      helper: "Capacity loss",
      icon: <Activity className="h-4 w-4" />,
      accent: "#F59E0B",
      status: (workforce?.shrinkage_pct ?? 0) > 15 ? ("critical" as const) : ("warn" as const),
    },
    {
      label: "Quality Score",
      value: `${(workforce?.quality_score ?? 0).toFixed(1)}`,
      helper: "Avg team score",
      icon: <Award className="h-4 w-4" />,
      accent: "#8B5CF6",
      status: "ok" as const,
    },
    {
      label: "In Training",
      value: workforce?.training?.analysts_in_training ?? 0,
      helper: "Active trainees",
      icon: <GraduationCap className="h-4 w-4" />,
      accent: "#22D3EE",
      status: "ok" as const,
    },
    {
      label: "Absent Today",
      value: att?.absent ?? 0,
      helper: "Not clocked in",
      icon: <UserX className="h-4 w-4" />,
      accent: "#E8231A",
      status: (att?.absent ?? 0) > 10 ? ("critical" as const) : ("ok" as const),
    },
  ];

  const quickStats = [
    { label: "Team", value: workforce?.headcount?.active ?? 0 },
    { label: "Attendance", value: `${(att?.attendance_pct ?? 0).toFixed(0)}%` },
    { label: "Shrinkage", value: `${(workforce?.shrinkage_pct ?? 0).toFixed(1)}%` },
    { label: "Training", value: workforce?.training?.analysts_in_training ?? 0 },
  ];

  const quickNavLinks = [
    {
      label: "WFM Dashboard",
      href: "/wfm/dashboard",
      icon: Users,
      color: "bg-blue-100 text-blue-600",
    },
    {
      label: "Live Tracker",
      href: "/wfm/live",
      icon: Activity,
      color: "bg-emerald-100 text-emerald-600",
    },
    {
      label: "Quality Dashboard",
      href: "/quality",
      icon: Award,
      color: "bg-violet-100 text-violet-600",
    },
    {
      label: "Operations",
      href: "/operations",
      icon: Briefcase,
      color: "bg-amber-100 text-amber-600",
    },
  ];

  return (
    <div className="space-y-6 p-6 !bg-slate-50 min-h-screen">
      <HeroBanner
        userName={firstName}
        roleLabel="Operations Manager"
        roleBadgeColor="bg-emerald-600"
        quickStats={quickStats}
      />

      <KpiRow tiles={kpiTiles} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <TeamRosterWidget />
        </div>
        <div>
          <NotificationsFeed />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <AttendanceDonutChart />
        <PendingActionsWidget />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <TrainingWidget />
        <QuickNavWidget title="Operations" links={quickNavLinks} />
      </div>

      <WhosOut />

    </div>
  );
}
