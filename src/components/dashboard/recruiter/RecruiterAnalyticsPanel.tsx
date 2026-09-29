import { Users, UserPlus, Calendar } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useRecruiterAnalytics } from "@/hooks/useRemainingDashboards";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function RecruiterAnalyticsPanel() {
  const { data, isLoading, error } = useRecruiterAnalytics();
  if (isLoading) return <Skeleton className="h-64 w-full rounded-2xl" />;
  if (error) return <Card className="rounded-2xl border-red-200 bg-red-50/50"><CardContent className="p-6"><p className="text-sm text-red-700">Unable to load recruiter analytics.</p></CardContent></Card>;

  const offers = data?.offer_to_join_ratio ?? { offers_extended: 0, offers_accepted: 0, joined: 0, acceptance_rate: 0, join_rate: 0 };
  const perf = data?.recruiter_performance ?? { hires_this_month: 0, avg_tat_days: 0 };
  const pipeline = data?.pipeline_summary ?? [];
  const sources = data?.source_effectiveness ?? [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {[
          { label: "Hires MTD", value: perf.hires_this_month, icon: UserPlus, color: "green" },
          { label: "Avg TAT", value: perf.avg_tat_days, suffix: "d", icon: Calendar, color: "blue" },
          { label: "Acceptance %", value: offers.acceptance_rate, suffix: "%", icon: Users, color: "purple" },
          { label: "Join Rate %", value: offers.join_rate, suffix: "%", icon: Users, color: "emerald" },
        ].map((kpi) => (
          <Card key={kpi.label} className="rounded-2xl border-white/60 bg-white/95 backdrop-blur-sm shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="pb-2"><div className="flex items-center justify-between"><CardTitle className="text-xs font-bold uppercase text-slate-500">{kpi.label}</CardTitle><div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", kpi.color === "green" && "bg-green-50", kpi.color === "blue" && "bg-blue-50", kpi.color === "purple" && "bg-purple-50", kpi.color === "emerald" && "bg-emerald-50")}><kpi.icon className={cn("h-4 w-4", kpi.color === "green" && "text-green-600", kpi.color === "blue" && "text-blue-600", kpi.color === "purple" && "text-purple-600", kpi.color === "emerald" && "text-emerald-600")} /></div></div></CardHeader>
            <CardContent><div className="text-2xl font-black text-slate-900">{kpi.value}{kpi.suffix}</div></CardContent>
          </Card>
        ))}
      </div>

      {sources.length > 0 && (
        <Card className="rounded-2xl border-white/60 bg-white/95 backdrop-blur-sm shadow-sm">
          <CardHeader className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-t-2xl"><CardTitle className="text-base font-bold">Source Effectiveness</CardTitle></CardHeader>
          <CardContent className="p-6"><div className="space-y-2">{sources.slice(0, 5).map((s: any, i: number) => <div key={i} className="flex justify-between text-sm"><span className="font-semibold">{s.source}</span><span className="font-bold text-indigo-700">{s.applications} apps ({s.conversion_pct}%)</span></div>)}</div></CardContent>
        </Card>
      )}
    </div>
  );
}
