import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { Briefcase, Users, CheckCircle2, UserCheck, Clock, TrendingUp } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { HeroBanner } from "../widgets/HeroBanner";
import { KpiRow } from "../widgets/KpiRow";
import { NotificationsFeed } from "../widgets/NotificationsFeed";
import { AtsPipelineChart } from "../widgets/AtsPipelineChart";
import { PendingActionsWidget } from "../widgets/PendingActionsWidget";
import { QuickNavWidget } from "../widgets/QuickNavWidget";

export function RecruiterLayout() {
  const { user } = useAuth();
  const firstName = user?.name?.split(" ")[0] ?? "User";

  const { data: wfData } = useQuery({
    queryKey: ["workforce-dashboard"],
    queryFn: () => hrmsApi.get("/api/management/workforce-dashboard"),
    staleTime: 1000 * 60 * 5,
  });

  const ats = wfData?.data?.ats_summary;

  const kpiTiles = [
    {
      label: "Open Positions",
      value: ats?.open_positions ?? 0,
      helper: "Active requisitions",
      icon: <Briefcase className="h-4 w-4" />,
      accent: "#1B6AB5",
      status: "ok" as const,
    },
    {
      label: "In Pipeline",
      value: ats?.in_pipeline ?? 0,
      helper: "Active candidates",
      icon: <Users className="h-4 w-4" />,
      accent: "#22D3EE",
      status: "ok" as const,
    },
    {
      label: "Offers Pending",
      value: ats?.offers_pending ?? 0,
      helper: "Awaiting acceptance",
      icon: <CheckCircle2 className="h-4 w-4" />,
      accent: "#F59E0B",
      status: (ats?.offers_pending ?? 0) > 5 ? ("warn" as const) : ("ok" as const),
    },
    {
      label: "Joiners (MTD)",
      value: ats?.joiners_mtd ?? 0,
      helper: "This month",
      icon: <UserCheck className="h-4 w-4" />,
      accent: "#3BAD49",
      status: "ok" as const,
    },
    {
      label: "Avg TAT",
      value: `${ats?.avg_tat_days ?? 0}d`,
      helper: "Days to hire",
      icon: <Clock className="h-4 w-4" />,
      accent: "#8B5CF6",
      status: (ats?.avg_tat_days ?? 0) > 30 ? ("warn" as const) : ("ok" as const),
    },
    {
      label: "Conversion",
      value: `${(ats?.conversion_pct ?? 0).toFixed(1)}%`,
      helper: "Pipeline to offer",
      icon: <TrendingUp className="h-4 w-4" />,
      accent: "#3BAD49",
      status: "ok" as const,
    },
  ];

  const quickStats = [
    { label: "Open", value: ats?.open_positions ?? 0 },
    { label: "Pipeline", value: ats?.in_pipeline ?? 0 },
    { label: "Offers", value: ats?.offers_pending ?? 0 },
    { label: "Joiners", value: ats?.joiners_mtd ?? 0 },
  ];

  const quickNavLinks = [
    {
      label: "ATS Command Center",
      href: "/ats/command-center",
      icon: Briefcase,
      color: "bg-cyan-100 text-cyan-600",
    },
    {
      label: "Recruiter Workspace",
      href: "/ats/recruiter-workspace",
      icon: Users,
      color: "bg-blue-100 text-blue-600",
    },
    {
      label: "Hiring Entry",
      href: "/ats/hiring-entry",
      icon: UserCheck,
      color: "bg-emerald-100 text-emerald-600",
    },
    {
      label: "Candidate Master",
      href: "/ats/candidate-master",
      icon: CheckCircle2,
      color: "bg-violet-100 text-violet-600",
    },
  ];

  return (
    <div className="space-y-6 p-6 !bg-slate-50 min-h-screen">
      <HeroBanner
        userName={firstName}
        roleLabel="Recruiter"
        roleBadgeColor="bg-cyan-600"
        quickStats={quickStats}
      />

      <KpiRow tiles={kpiTiles} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <AtsPipelineChart />
        </div>
        <div>
          <NotificationsFeed />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <PendingActionsWidget />
        <QuickNavWidget title="ATS Quick Links" links={quickNavLinks} />
      </div>

    </div>
  );
}
