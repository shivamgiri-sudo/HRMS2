import { useQuery } from "@tanstack/react-query";
import { Users, UserPlus, AlertTriangle, FileCheck, UserX, MessageSquare } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { HeroBanner } from "../widgets/HeroBanner";
import { KpiRow } from "../widgets/KpiRow";
import { AiBriefingPanel } from "../widgets/AiBriefingPanel";
import { WorkInboxPanel } from "../widgets/WorkInboxPanel";
import { RecruitmentFunnelWidget } from "../widgets/RecruitmentFunnelWidget";
import { AttendanceDonutChart } from "../widgets/AttendanceDonutChart";
import { UpcomingCelebrations } from "../UpcomingCelebrations";
import { useDashboardUser } from "../widgets/useDashboardUser";

export function HrAdminLayout() {
  const { firstName } = useDashboardUser();

  const { data: summaryData } = useQuery<any>({
    queryKey: ["dashboard-summary-hr"],
    queryFn: () => hrmsApi.get("/api/dashboards/hr/summary"),
    staleTime: 1000 * 60 * 3,
  });

  const { data: atsData } = useQuery<any>({
    queryKey: ["dashboard-ats-stats"],
    queryFn: () => hrmsApi.get("/api/ats/stats"),
    staleTime: 1000 * 60 * 5,
  });

  const metrics = summaryData?.data?.metrics ?? {};
  const pipeline: any[] = atsData?.data?.pipeline ?? [];
  const selected = pipeline.find((p: any) => p.stage === "selected")?.value ?? 0;
  const onbPending = metrics.onb?.detail?.pending ?? metrics.onb?.value ?? 0;
  const onbStuck = metrics.onb?.detail?.stuck ?? 0;
  const onbSubmitted = metrics.onb?.detail?.submitted ?? 0;
  const bgvPending = metrics.bgv?.value ?? 0;

  const kpiTiles = [
    { label: "Selected Candidates", value: selected, helper: "vs Last 30 Days", icon: <Users className="w-4 h-4" />, accent: "#1B6AB5", trend: "up" as const, variancePct: 21.1 },
    { label: "Onboarding Submitted", value: onbSubmitted, helper: "vs Last 30 Days", icon: <FileCheck className="w-4 h-4" />, accent: "#3BAD49", trend: "up" as const, variancePct: 23.1 },
    { label: "Onboarding Pending", value: onbPending, helper: "vs Last 30 Days", icon: <UserPlus className="w-4 h-4" />, accent: "#F59E0B", trend: "up" as const, variancePct: 54.8 },
    { label: "Onboarding Stuck", value: onbStuck, helper: "vs Last 30 Days", icon: <AlertTriangle className="w-4 h-4" />, accent: "#E8231A" },
    { label: "BGV Pending", value: bgvPending, helper: "Awaiting verification", icon: <FileCheck className="w-4 h-4" />, accent: "#8B5CF6", trend: "up" as const, variancePct: 54.2 },
    { label: "Resignation Risk", value: metrics.resignations?.value ?? 0, helper: "Pending discussions", icon: <UserX className="w-4 h-4" />, accent: "#E8231A", trend: "up" as const, variancePct: 66.7 },
  ];

  const workItems = [
    { icon: <UserPlus className="w-4 h-4" />, title: "Onboarding Review", subtitle: "Review pending onboarding submissions", count: onbPending, href: "/onboarding", color: "bg-amber-100 text-amber-700", timestamp: "2h ago" },
    { icon: <AlertTriangle className="w-4 h-4" />, title: "BGV Follow-up", subtitle: "Pending BGV verifications", count: bgvPending, href: "/employees", color: "bg-red-100 text-red-700", timestamp: "3h ago" },
    { icon: <MessageSquare className="w-4 h-4" />, title: "Resignation Discussions", subtitle: "Pending discussions with managers", count: metrics.resignations?.value ?? 0, href: "/employees", color: "bg-red-100 text-red-700", timestamp: "4h ago" },
    { icon: <AlertTriangle className="w-4 h-4" />, title: "Onboarding Stuck", subtitle: "Document pending / manager approval", count: onbStuck, href: "/onboarding", color: "bg-red-100 text-red-700", timestamp: "5h ago" },
  ].filter((i) => i.count > 0);

  return (
    <div className="space-y-6">
      <HeroBanner
        title="HR Dashboard"
        subtitle="Recruitment, onboarding, BGV and exit management"
        roleChip="HR View"
        chipColor="bg-blue-50 text-blue-700 border-blue-200"
        updatedAt="Updated just now"
      />
      <KpiRow tiles={kpiTiles} />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <AiBriefingPanel dashboardCode="hr" title="HR Operations AI Briefing" subtitle="Summary of recruitment and onboarding operations based on live data" />
        </div>
        <WorkInboxPanel items={workItems} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <RecruitmentFunnelWidget />
        <AttendanceDonutChart />
        <UpcomingCelebrations />
      </div>
    </div>
  );
}
