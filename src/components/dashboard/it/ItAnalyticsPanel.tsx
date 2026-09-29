import { Laptop, Clock, Shield, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useItAnalytics } from "@/hooks/useRemainingDashboards";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function ItAnalyticsPanel() {
  const { data, isLoading, error } = useItAnalytics();
  if (isLoading) return <Skeleton className="h-64 w-full rounded-2xl" />;
  if (error) return <Card className="rounded-2xl border-red-200 bg-red-50/50"><CardContent className="p-6"><p className="text-sm text-red-700">Unable to load IT analytics.</p></CardContent></Card>;

  const assets = data?.asset_lifecycle ?? { total_assets: 0, in_use: 0, idle: 0, faulty: 0, depreciation_value: 0 };
  const incidents = data?.incident_resolution ?? { open_tickets: 0, p1_count: 0, p2_count: 0, avg_resolution_hours: 0 };
  const security = data?.security_posture ?? { devices_pending_updates: 0, antivirus_inactive: 0, vulnerabilities: 0 };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {[
          { label: "Total Assets", value: assets.total_assets, icon: Laptop, color: "blue" },
          { label: "Open Tickets", value: incidents.open_tickets, icon: AlertTriangle, color: "amber" },
          { label: "Avg Resolution", value: incidents.avg_resolution_hours, suffix: "h", icon: Clock, color: "green" },
          { label: "Security Issues", value: security.vulnerabilities, icon: Shield, color: "red" },
        ].map((kpi) => (
          <Card key={kpi.label} className="rounded-2xl border-white/60 bg-white/95 backdrop-blur-sm shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="pb-2"><div className="flex items-center justify-between"><CardTitle className="text-xs font-bold uppercase text-slate-500">{kpi.label}</CardTitle><div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", kpi.color === "blue" && "bg-blue-50", kpi.color === "amber" && "bg-amber-50", kpi.color === "green" && "bg-green-50", kpi.color === "red" && "bg-red-50")}><kpi.icon className={cn("h-4 w-4", kpi.color === "blue" && "text-blue-600", kpi.color === "amber" && "text-amber-600", kpi.color === "green" && "text-green-600", kpi.color === "red" && "text-red-600")} /></div></div></CardHeader>
            <CardContent><div className="text-2xl font-black text-slate-900">{kpi.value}{kpi.suffix}</div></CardContent>
          </Card>
        ))}
      </div>

      <Card className="rounded-2xl border-white/60 bg-white/95 backdrop-blur-sm shadow-sm">
        <CardHeader className="bg-gradient-to-r from-slate-600 to-slate-800 text-white rounded-t-2xl"><CardTitle className="text-base font-bold">Asset Status</CardTitle></CardHeader>
        <CardContent className="p-6"><div className="grid grid-cols-3 gap-4 text-center"><div><div className="text-3xl font-black text-emerald-600">{assets.in_use}</div><p className="text-sm text-slate-600 mt-1">In Use</p></div><div><div className="text-3xl font-black text-amber-600">{assets.idle}</div><p className="text-sm text-slate-600 mt-1">Idle</p></div><div><div className="text-3xl font-black text-red-600">{assets.faulty}</div><p className="text-sm text-slate-600 mt-1">Faulty</p></div></div></CardContent>
      </Card>
    </div>
  );
}
