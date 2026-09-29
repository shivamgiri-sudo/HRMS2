import { Award, TrendingUp, Users, Target } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useQualityAnalytics } from "@/hooks/useRemainingDashboards";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function QualityAnalyticsPanel() {
  const { data, isLoading, error } = useQualityAnalytics();
  if (isLoading) return <Skeleton className="h-64 w-full rounded-2xl" />;
  if (error) return <Card className="rounded-2xl border-red-200 bg-red-50/50"><CardContent className="p-6"><p className="text-sm text-red-700">Unable to load quality analytics.</p></CardContent></Card>;

  const defects = data?.defect_breakdown ?? [];
  const calibration = data?.calibration_status ?? { scheduled: 0, held: 0, irr_score: 0 };
  const bands = data?.agent_bands ?? { s: 0, a: 0, b: 0, c: 0, d: 0 };
  const tni = data?.tni_summary ?? [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {[
          { label: "S Rating", value: bands.s, icon: Award, color: "emerald" },
          { label: "A Rating", value: bands.a, icon: Users, color: "green" },
          { label: "Calibration Rate", value: calibration.scheduled > 0 ? Math.round((calibration.held / calibration.scheduled) * 100) : 0, suffix: "%", icon: Target, color: "purple" },
          { label: "IRR Score", value: calibration.irr_score, icon: TrendingUp, color: "blue" },
        ].map((kpi) => (
          <Card key={kpi.label} className="rounded-2xl border-white/60 bg-white/95 backdrop-blur-sm shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="pb-2"><div className="flex items-center justify-between"><CardTitle className="text-xs font-bold uppercase text-slate-500">{kpi.label}</CardTitle><div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", kpi.color === "emerald" && "bg-emerald-50", kpi.color === "green" && "bg-green-50", kpi.color === "purple" && "bg-purple-50", kpi.color === "blue" && "bg-blue-50")}><kpi.icon className={cn("h-4 w-4", kpi.color === "emerald" && "text-emerald-600", kpi.color === "green" && "text-green-600", kpi.color === "purple" && "text-purple-600", kpi.color === "blue" && "text-blue-600")} /></div></div></CardHeader>
            <CardContent><div className="text-2xl font-black text-slate-900">{kpi.value}{kpi.suffix}</div></CardContent>
          </Card>
        ))}
      </div>

      <Card className="rounded-2xl border-white/60 bg-white/95 backdrop-blur-sm shadow-sm">
        <CardHeader className="bg-gradient-to-r from-purple-600 to-violet-600 text-white rounded-t-2xl"><CardTitle className="text-base font-bold">Top Defect Categories</CardTitle></CardHeader>
        <CardContent className="p-6">{defects.length === 0 ? <p className="text-sm text-slate-500">No defects</p> : <div className="space-y-2">{defects.map((d: any, i: number) => <div key={i} className="flex justify-between text-sm"><span className="font-semibold">{d.category}</span><span className="font-bold text-purple-700">{d.count} ({d.pct}%)</span></div>)}</div>}</CardContent>
      </Card>

      {tni.length > 0 && (
        <Card className="rounded-2xl border-white/60 bg-white/95 backdrop-blur-sm shadow-sm">
          <CardHeader className="bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-t-2xl"><CardTitle className="text-base font-bold">Training Needs (TNI)</CardTitle></CardHeader>
          <CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full"><thead><tr className="border-b bg-slate-50"><th className="text-left p-3 text-xs font-bold text-slate-600">Employee</th><th className="text-left p-3 text-xs font-bold text-slate-600">Pattern</th><th className="text-right p-3 text-xs font-bold text-slate-600">Count</th></tr></thead><tbody>{tni.slice(0, 5).map((t: any, i: number) => <tr key={i} className="border-b hover:bg-slate-50"><td className="p-3 text-sm font-semibold">{t.employee_name}</td><td className="p-3 text-sm text-slate-700">{t.defect_pattern}</td><td className="p-3 text-right font-bold text-amber-700">{t.tni_count}</td></tr>)}</tbody></table></div></CardContent>
        </Card>
      )}
    </div>
  );
}
