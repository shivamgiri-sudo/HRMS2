import { Activity, AlertCircle, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useOperationsAnalytics } from "@/hooks/useRemainingDashboards";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function OperationsAnalyticsPanel() {
  const { data, isLoading, error } = useOperationsAnalytics();
  if (isLoading) return <Skeleton className="h-64 w-full rounded-2xl" />;
  if (error) return <Card className="rounded-2xl border-red-200 bg-red-50/50"><CardContent className="p-6"><p className="text-sm text-red-700">Unable to load operations analytics.</p></CardContent></Card>;

  const processHealth = data?.process_health ?? [];
  const escalations = data?.client_escalations ?? { open: 0, closed: 0, avg_resolution_hours: 0 };
  const capacity = data?.capacity_utilization ?? { seats_occupied: 0, seats_total: 1, utilization_pct: 0 };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        {[
          { label: "Escalations Open", value: escalations.open, icon: AlertCircle, color: "red" },
          { label: "Capacity %", value: capacity.utilization_pct, suffix: "%", icon: Activity, color: "blue" },
          { label: "Avg Resolution", value: escalations.avg_resolution_hours, suffix: "h", icon: TrendingUp, color: "green" },
        ].map((kpi) => (
          <Card key={kpi.label} className="rounded-2xl border-white/60 bg-white/95 backdrop-blur-sm shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="pb-2"><div className="flex items-center justify-between"><CardTitle className="text-xs font-bold uppercase text-slate-500">{kpi.label}</CardTitle><div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", kpi.color === "red" && "bg-red-50", kpi.color === "blue" && "bg-blue-50", kpi.color === "green" && "bg-green-50")}><kpi.icon className={cn("h-4 w-4", kpi.color === "red" && "text-red-600", kpi.color === "blue" && "text-blue-600", kpi.color === "green" && "text-green-600")} /></div></div></CardHeader>
            <CardContent><div className="text-2xl font-black text-slate-900">{kpi.value}{kpi.suffix}</div></CardContent>
          </Card>
        ))}
      </div>

      {processHealth.length > 0 && (
        <Card className="rounded-2xl border-white/60 bg-white/95 backdrop-blur-sm shadow-sm">
          <CardHeader className="bg-gradient-to-r from-cyan-600 to-blue-600 text-white rounded-t-2xl"><CardTitle className="text-base font-bold">Process Health Scores</CardTitle></CardHeader>
          <CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full"><thead><tr className="border-b bg-slate-50"><th className="text-left p-3 text-xs font-bold text-slate-600">Process</th><th className="text-right p-3 text-xs font-bold text-slate-600">Health</th><th className="text-right p-3 text-xs font-bold text-slate-600">Att%</th><th className="text-right p-3 text-xs font-bold text-slate-600">Qual%</th><th className="text-right p-3 text-xs font-bold text-slate-600">KPI%</th></tr></thead><tbody>{processHealth.slice(0, 10).map((p: any, i: number) => <tr key={i} className="border-b hover:bg-slate-50"><td className="p-3 text-sm font-semibold">{p.process_name}</td><td className="p-3 text-right"><span className={cn("font-bold", p.health_score >= 80 ? "text-emerald-600" : p.health_score >= 60 ? "text-amber-600" : "text-red-600")}>{p.health_score}</span></td><td className="p-3 text-right text-sm">{p.attendance_pct}%</td><td className="p-3 text-right text-sm">{p.quality_pct}%</td><td className="p-3 text-right text-sm">{p.kpi_pct}%</td></tr>)}</tbody></table></div></CardContent>
        </Card>
      )}
    </div>
  );
}
