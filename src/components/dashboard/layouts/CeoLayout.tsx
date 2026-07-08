import { useQuery } from "@tanstack/react-query";
import {
  Users,
  Activity,
  AlertTriangle,
  DollarSign,
  UserPlus,
  Target,
  TrendingDown,
  Zap,
} from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { HeroBanner } from "../widgets/HeroBanner";
import { KpiRow } from "../widgets/KpiRow";
import { ImmediateActionsBar } from "../widgets/ImmediateActionsBar";
import { AiBriefingPanel } from "../widgets/AiBriefingPanel";
import { WorkInboxPanel } from "../widgets/WorkInboxPanel";
import { MovementChart } from "../widgets/MovementChart";
import { AttendanceDonutChart } from "../widgets/AttendanceDonutChart";
import { useDashboardUser } from "../widgets/useDashboardUser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function CeoLayout() {
  const { firstName } = useDashboardUser();

  const { data: wfData } = useQuery<any>({
    queryKey: ["workforce-dashboard"],
    queryFn: () => hrmsApi.get("/api/management/workforce-dashboard"),
    staleTime: 1000 * 60 * 5,
  });

  const { data: ceoData } = useQuery<any>({
    queryKey: ["ceo-metrics"],
    queryFn: () => hrmsApi.get("/api/management/ceo-metrics"),
    staleTime: 1000 * 60 * 5,
  });

  const { data: summaryData } = useQuery<any>({
    queryKey: ["dashboard-summary-hr"],
    queryFn: () => hrmsApi.get("/api/dashboards/hr/summary"),
    staleTime: 1000 * 60 * 3,
  });

  const summary = wfData?.data?.summary ?? {};
  const metrics = summaryData?.data?.metrics ?? {};
  const ceo = ceoData?.data ?? {};

  const immediateActions = [
    { label: "TAT Breached", count: metrics.tat?.value ?? 0, href: "/work-inbox", urgency: "critical" as const, subtitle: "Tickets waiting beyond SLA" },
    { label: "BGV Pending", count: metrics.bgv?.value ?? 0, href: "/employees", urgency: "warning" as const, subtitle: "Approvals pending" },
    { label: "Name Mismatch", count: metrics.name_mismatch?.value ?? 0, href: "/employees", urgency: "critical" as const, subtitle: "Blocking payroll" },
    { label: "Incentive Pending", count: metrics.incentive?.value ?? 0, href: "/payroll", urgency: "warning" as const, subtitle: "Approvals pending" },
    { label: "Payroll Readiness", count: metrics.payroll?.value ? `${metrics.payroll.value}%` : "—", href: "/payroll", urgency: "warning" as const, subtitle: "Complete pending items" },
  ].filter((a) => a.count !== 0 && a.count !== "—");

  const kpiTiles = [
    { label: "Login Adherence", value: summary.attendance_pct ? `${summary.attendance_pct.toFixed(1)}%` : "—", helper: "vs Yesterday", icon: <Activity className="w-4 h-4" />, accent: "#1B6AB5", trend: "up" as const, variancePct: 1.3 },
    { label: "Avg Shrinkage", value: summary.shrinkage_pct ? `${summary.shrinkage_pct.toFixed(2)}%` : "—", helper: "vs Last 30 Days", icon: <TrendingDown className="w-4 h-4" />, accent: "#F59E0B", trend: "up" as const, variancePct: 0.31 },
    { label: "Revenue Gap MTD", value: ceo.revenue_at_risk?.revenue_at_risk_inr ? `₹${(ceo.revenue_at_risk.revenue_at_risk_inr / 100000).toFixed(1)}L` : "—", helper: "vs Last Month", icon: <DollarSign className="w-4 h-4" />, accent: "#E8231A", trend: "up" as const, variancePct: 22.41 },
    { label: "Certified Learners", value: summary.analysts_in_training ?? 0, helper: "vs Last 30 Days", icon: <Zap className="w-4 h-4" />, accent: "#3BAD49", trend: "up" as const, variancePct: 13.25 },
  ];

  const metricTiles = [
    { label: "Active Headcount", value: summary.active_headcount ?? 0, helper: `+${summary.new_joiners_30d ?? 0} this month`, icon: <Users className="w-4 h-4" />, accent: "#1B6AB5", trend: "up" as const, variancePct: 1.06 },
    { label: "Onboarding Pending", value: metrics.onb?.value ?? 0, helper: "vs Yesterday", icon: <UserPlus className="w-4 h-4" />, accent: "#F59E0B", trend: "down" as const, variancePct: 11.27 },
    { label: "BGV Pending", value: metrics.bgv?.value ?? 0, helper: "vs Yesterday", icon: <AlertTriangle className="w-4 h-4" />, accent: "#8B5CF6", trend: "down" as const, variancePct: 11.11 },
    { label: "Name Mismatch", value: metrics.name_mismatch?.value ?? 0, helper: "Blocking payroll", icon: <AlertTriangle className="w-4 h-4" />, accent: "#E8231A", trend: "down" as const, variancePct: 12.90 },
    { label: "TAT Breached", value: metrics.tat?.value ?? 0, helper: "vs Yesterday", icon: <Target className="w-4 h-4" />, accent: "#E8231A", trend: "down" as const, variancePct: 21.95 },
    { label: "Incentive Pending", value: metrics.incentive?.value ?? 0, helper: "vs Last 7 Days", icon: <DollarSign className="w-4 h-4" />, accent: "#F59E0B", trend: "down" as const, variancePct: 12.50 },
    { label: "Payroll Readiness", value: metrics.payroll?.value ? `${metrics.payroll.value}%` : "—", helper: "vs Yesterday", icon: <Activity className="w-4 h-4" />, accent: "#3BAD49", trend: "up" as const, variancePct: 3.00 },
    { label: "Resignation Risk", value: metrics.resignations?.value ?? 0, helper: "Pending discussion", icon: <TrendingDown className="w-4 h-4" />, accent: "#E8231A", trend: "down" as const, variancePct: 10.34 },
  ];

  const workItems = [
    { icon: <AlertTriangle className="w-4 h-4" />, title: "BGV Approvals", subtitle: "Pending background verifications", count: metrics.bgv?.value ?? 0, href: "/employees", color: "bg-amber-100 text-amber-700", timestamp: "2h ago" },
    { icon: <AlertTriangle className="w-4 h-4" />, title: "Name Mismatch (Blocking)", subtitle: "Requires employee data correction", count: metrics.name_mismatch?.value ?? 0, href: "/employees", color: "bg-red-100 text-red-700", timestamp: "3h ago" },
    { icon: <Target className="w-4 h-4" />, title: "TAT Breaches", subtitle: "Tickets breached SLA", count: metrics.tat?.value ?? 0, href: "/work-inbox", color: "bg-red-100 text-red-700", timestamp: "4h ago" },
    { icon: <DollarSign className="w-4 h-4" />, title: "Incentive Approvals", subtitle: "Pending incentive approvals", count: metrics.incentive?.value ?? 0, href: "/payroll", color: "bg-amber-100 text-amber-700", timestamp: "5h ago" },
  ].filter((i) => i.count > 0);

  return (
    <div className="space-y-6">
      {/* ── Existing structure (unchanged) ── */}
      <HeroBanner
        title="CEO Dashboard"
        subtitle="Organisation-wide summary"
        roleChip="CEO View"
        chipColor="bg-purple-50 text-purple-700 border-purple-200"
        updatedAt="Updated just now"
      />
      {immediateActions.length > 0 && <ImmediateActionsBar items={immediateActions} />}
      <KpiRow tiles={kpiTiles} cols={4} />
      <KpiRow tiles={metricTiles} />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <AiBriefingPanel dashboardCode="hr" title="Executive AI Briefing" subtitle="AI-analyzed live workforce data" />
          <MovementChart />
        </div>
        <div className="space-y-6">
          <WorkInboxPanel items={workItems} />
          <AttendanceDonutChart />
        </div>
      </div>
    </div>
  );
}
