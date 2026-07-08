import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { DollarSign, Wallet, FileText, TrendingUp, Award, CheckCircle2 } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { HeroBanner } from "../widgets/HeroBanner";
import { KpiRow } from "../widgets/KpiRow";
import { NotificationsFeed } from "../widgets/NotificationsFeed";
import { PayrollSummaryWidget } from "../widgets/PayrollSummaryWidget";
import { PendingActionsWidget } from "../widgets/PendingActionsWidget";
import { QuickNavWidget } from "../widgets/QuickNavWidget";

export function FinanceLayout() {
  const { user } = useAuth();
  const firstName = user?.name?.split(" ")[0] ?? "User";

  const { data: ceoData } = useQuery({
    queryKey: ["ceo-metrics"],
    queryFn: () => hrmsApi.get("/api/management/ceo-metrics"),
    staleTime: 1000 * 60 * 5,
  });

  const payroll = ceoData?.data?.payroll_liability;
  const statutory = ceoData?.data?.statutory_summary;

  const kpiTiles = [
    {
      label: "Gross Liability",
      value: `₹${((payroll?.total_gross ?? 0) / 10000000).toFixed(1)}Cr`,
      helper: payroll?.run_month ?? "Latest run",
      icon: <DollarSign className="h-4 w-4" />,
      accent: "#8B5CF6",
      status: "ok" as const,
    },
    {
      label: "Net Payout",
      value: `₹${((payroll?.total_net ?? 0) / 10000000).toFixed(1)}Cr`,
      helper: "To be disbursed",
      icon: <Wallet className="h-4 w-4" />,
      accent: "#3BAD49",
      status: "ok" as const,
    },
    {
      label: "Statutory Dues",
      value: `₹${((statutory?.total_due ?? 0) / 100000).toFixed(1)}L`,
      helper: "PF/ESI/PT",
      icon: <FileText className="h-4 w-4" />,
      accent: "#F59E0B",
      status: (statutory?.overdue_count ?? 0) > 0 ? ("critical" as const) : ("ok" as const),
    },
    {
      label: "F&F Pending",
      value: statutory?.ff_pending ?? 0,
      helper: "Final settlements",
      icon: <TrendingUp className="h-4 w-4" />,
      accent: "#E8231A",
      status: (statutory?.ff_pending ?? 0) > 5 ? ("warn" as const) : ("ok" as const),
    },
    {
      label: "Incentives Due",
      value: `₹${((payroll?.incentives_due ?? 0) / 100000).toFixed(1)}L`,
      helper: "This cycle",
      icon: <Award className="h-4 w-4" />,
      accent: "#22D3EE",
      status: "ok" as const,
    },
    {
      label: "Readiness",
      value: `${(payroll?.readiness_pct ?? 0).toFixed(0)}%`,
      helper: "Payroll completion",
      icon: <CheckCircle2 className="h-4 w-4" />,
      accent: (payroll?.readiness_pct ?? 0) >= 90 ? "#3BAD49" : "#F59E0B",
      status: (payroll?.readiness_pct ?? 0) >= 90 ? ("ok" as const) : ("warn" as const),
    },
  ];

  const quickStats = [
    { label: "Gross", value: `₹${((payroll?.total_gross ?? 0) / 10000000).toFixed(1)}Cr` },
    { label: "Net", value: `₹${((payroll?.total_net ?? 0) / 10000000).toFixed(1)}Cr` },
    { label: "Statutory", value: `₹${((statutory?.total_due ?? 0) / 100000).toFixed(1)}L` },
    { label: "F&F", value: statutory?.ff_pending ?? 0 },
  ];

  const quickNavLinks = [
    {
      label: "Payroll",
      href: "/payroll",
      icon: DollarSign,
      color: "bg-violet-100 text-violet-600",
    },
    {
      label: "Statutory Compliance",
      href: "/statutory-compliance",
      icon: FileText,
      color: "bg-amber-100 text-amber-600",
    },
    {
      label: "F&F Settlement",
      href: "/payroll/final-settlement",
      icon: TrendingUp,
      color: "bg-red-100 text-red-600",
    },
    {
      label: "Payroll Masters",
      href: "/payroll-masters",
      icon: CheckCircle2,
      color: "bg-emerald-100 text-emerald-600",
    },
  ];

  return (
    <div className="space-y-6 p-6 !bg-slate-50 min-h-screen">
      <HeroBanner
        userName={firstName}
        roleLabel="Finance / Payroll"
        roleBadgeColor="bg-violet-600"
        quickStats={quickStats}
      />

      <KpiRow tiles={kpiTiles} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <PayrollSummaryWidget />
        </div>
        <div>
          <NotificationsFeed />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <PendingActionsWidget />
        <QuickNavWidget title="Payroll & Finance" links={quickNavLinks} />
      </div>

    </div>
  );
}
