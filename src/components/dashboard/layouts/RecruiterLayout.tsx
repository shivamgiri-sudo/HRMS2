import { useQuery } from "@tanstack/react-query";
import { Briefcase, Users, CheckCircle2, UserCheck, Clock, TrendingUp, PlusCircle } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { HeroBanner } from "../widgets/HeroBanner";
import { KpiRow } from "../widgets/KpiRow";
import { RecruitmentFunnelWidget } from "../widgets/RecruitmentFunnelWidget";
import { WorkInboxPanel } from "../widgets/WorkInboxPanel";
import { QuickLinksGrid, QuickLink } from "../widgets/QuickLinksGrid";
import { useDashboardUser } from "../widgets/useDashboardUser";

export function RecruiterLayout() {
  const { firstName } = useDashboardUser();

  const { data: atsData } = useQuery<any>({
    queryKey: ["dashboard-ats-stats"],
    queryFn: () => hrmsApi.get("/api/ats/stats"),
    staleTime: 1000 * 60 * 5,
  });

  const { data: myData } = useQuery<any>({
    queryKey: ["recruiter-daily-stats"],
    queryFn: () => hrmsApi.get("/api/ats/recruiter/daily-stats"),
    staleTime: 1000 * 60 * 5,
  });

  const pipeline: any[] = atsData?.data?.pipeline ?? [];
  const daily = myData?.data ?? {};
  const inPipeline = pipeline.reduce((s: number, p: any) =>
    ["new", "screening", "interview", "assessment"].includes(p.stage) ? s + (p.value ?? 0) : s, 0);
  const offersPending = pipeline.find((p: any) => p.stage === "offer")?.value ?? 0;

  const kpiTiles = [
    { label: "Open Positions", value: atsData?.data?.open_positions ?? 0, helper: "Active requisitions", icon: <Briefcase className="w-4 h-4" />, accent: "#1B6AB5" },
    { label: "In Pipeline", value: inPipeline, helper: "Active candidates", icon: <Users className="w-4 h-4" />, accent: "#22D3EE" },
    { label: "Offers Pending", value: offersPending, helper: "Awaiting acceptance", icon: <CheckCircle2 className="w-4 h-4" />, accent: "#F59E0B", status: offersPending > 5 ? ("warn" as const) : ("ok" as const) },
    { label: "Joiners (MTD)", value: daily.joiners_mtd ?? 0, helper: "This month", icon: <UserCheck className="w-4 h-4" />, accent: "#3BAD49" },
    { label: "My Today", value: daily.submissions_today ?? 0, helper: "Today's submissions", icon: <Clock className="w-4 h-4" />, accent: "#8B5CF6" },
    { label: "Conversion %", value: daily.conversion_pct ? `${daily.conversion_pct.toFixed(1)}%` : "—", helper: "Pipeline to offer", icon: <TrendingUp className="w-4 h-4" />, accent: "#3BAD49" },
  ];

  const workItems = [
    { icon: <Users className="w-4 h-4" />, title: "My Pending Candidates", subtitle: "Candidates assigned to me", count: daily.pending_count ?? 0, href: "/ats/recruiter-workspace", color: "bg-blue-100 text-blue-700", timestamp: "Now" },
    { icon: <CheckCircle2 className="w-4 h-4" />, title: "Offers Pending", subtitle: "Awaiting candidate acceptance", count: offersPending, href: "/ats/command-center", color: "bg-amber-100 text-amber-700", timestamp: "1h ago" },
  ].filter((i) => i.count > 0);

  const quickLinks: QuickLink[] = [
    { label: "ATS Command Center", href: "/ats/command-center", icon: Briefcase, iconBg: "bg-cyan-100", iconColor: "text-cyan-600" },
    { label: "Recruiter Workspace", href: "/ats/recruiter-workspace", icon: Users, iconBg: "bg-blue-100", iconColor: "text-blue-600" },
    { label: "Hiring Entry", href: "/ats/hiring-entry", icon: PlusCircle, iconBg: "bg-emerald-100", iconColor: "text-emerald-600" },
    { label: "Candidate Master", href: "/ats/candidate-master", icon: UserCheck, iconBg: "bg-violet-100", iconColor: "text-violet-600" },
    { label: "Walk-in Queue", href: "/ats/recruiter-workspace", icon: Clock, iconBg: "bg-amber-100", iconColor: "text-amber-600" },
    { label: "Submission History", href: "/ats/recruiter-workspace", icon: TrendingUp, iconBg: "bg-slate-100", iconColor: "text-slate-600" },
  ];

  return (
    <div className="space-y-6">
      <HeroBanner
        title="Recruiter Dashboard"
        subtitle="ATS pipeline, candidates and daily performance"
        roleChip="ATS View"
        chipColor="bg-cyan-50 text-cyan-700 border-cyan-200"
        updatedAt="Updated just now"
      />
      <KpiRow tiles={kpiTiles} />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <RecruitmentFunnelWidget />
        </div>
        <WorkInboxPanel items={workItems} />
      </div>
      <QuickLinksGrid title="Quick ATS Links" links={quickLinks} cols={6} />
    </div>
  );
}
