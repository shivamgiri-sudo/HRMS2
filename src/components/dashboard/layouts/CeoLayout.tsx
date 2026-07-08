import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { Briefcase, DollarSign, TrendingUp, Users, UserPlus, AlertTriangle } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { HeroBanner } from "../widgets/HeroBanner";
import { KpiRow } from "../widgets/KpiRow";
import { NotificationsFeed } from "../widgets/NotificationsFeed";
import { MovementChart } from "../widgets/MovementChart";
import { PayrollSummaryWidget } from "../widgets/PayrollSummaryWidget";
import { RevenueAtRiskWidget } from "../widgets/RevenueAtRiskWidget";

export function CeoLayout() {
  const { user } = useAuth();
  const firstName = user?.name?.split(" ")[0] ?? "User";

  const { data: workInboxData } = useQuery({
    queryKey: ["work-inbox-count"],
    queryFn: () => hrmsApi.get("/api/dashboards/hr/summary"),
    staleTime: 1000 * 60 * 2,
  });

  const { data: ceoData } = useQuery({
    queryKey: ["ceo-dashboard"],
    queryFn: () => hrmsApi.get("/api/management/ceo-metrics"),
    staleTime: 1000 * 60 * 5,
  });

  const workInboxCount = workInboxData?.data?.workItems?.length ?? 0;
  const metrics = ceoData?.data;

  const kpiTiles = [
    {
      label: "Headcount",
      value: metrics?.headcount ?? 0,
      helper: "Active employees",
      icon: <Users className="h-4 w-4" />,
      accent: "#1B6AB5",
      trend: metrics?.headcount_trend as any,
      status: "ok" as const,
    },
    {
      label: "Attendance",
      value: `${(metrics?.attendance_pct ?? 0).toFixed(1)}%`,
      helper: "Today's attendance",
      icon: <Briefcase className="h-4 w-4" />,
      accent: "#3BAD49",
      status: (metrics?.attendance_pct ?? 0) >= 90 ? ("ok" as const) : ("warn" as const),
    },
    {
      label: "Attrition (30d)",
      value: `${(metrics?.attrition_30d ?? 0).toFixed(1)}%`,
      helper: "Last 30 days",
      icon: <TrendingUp className="h-4 w-4" />,
      accent: metrics?.attrition_30d > 10 ? "#E8231A" : "#F59E0B",
      status: metrics?.attrition_30d > 10 ? ("critical" as const) : ("warn" as const),
    },
    {
      label: "Revenue at Risk",
      value: `₹${((metrics?.revenue_at_risk?.revenue_at_risk_inr ?? 0) / 100000).toFixed(1)}L`,
      helper: "Shrinkage impact",
      icon: <AlertTriangle className="h-4 w-4" />,
      accent: "#E8231A",
      status: "critical" as const,
    },
    {
      label: "Payroll Liability",
      value: `₹${((metrics?.payroll_liability?.total_net ?? 0) / 10000000).toFixed(1)}Cr`,
      helper: metrics?.payroll_liability?.run_month ?? "Latest run",
      icon: <DollarSign className="h-4 w-4" />,
      accent: "#8B5CF6",
      status: "ok" as const,
    },
    {
      label: "Hiring Pipeline",
      value: metrics?.ats_pipeline_count ?? 0,
      helper: "Candidates in pipeline",
      icon: <UserPlus className="h-4 w-4" />,
      accent: "#22D3EE",
      status: "ok" as const,
    },
  ];

  const quickStats = [
    { label: "HC", value: metrics?.headcount ?? 0 },
    { label: "Attendance", value: `${(metrics?.attendance_pct ?? 0).toFixed(0)}%` },
    { label: "Payroll", value: `₹${((metrics?.payroll_liability?.total_net ?? 0) / 10000000).toFixed(1)}Cr` },
    { label: "Pipeline", value: metrics?.ats_pipeline_count ?? 0 },
  ];

  return (
    <div className="space-y-6 p-6 !bg-slate-50 min-h-screen">
      <HeroBanner
        userName={firstName}
        roleLabel="Chief Executive"
        roleBadgeColor="bg-purple-600"
        quickStats={quickStats}
      />

      <KpiRow tiles={kpiTiles} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <MovementChart />
        </div>
        <div>
          <NotificationsFeed />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <PayrollSummaryWidget />
        <RevenueAtRiskWidget />
      </div>

    </div>
  );
}
