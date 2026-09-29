import { Server, Shield, Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSuperAdminAnalytics } from "@/hooks/useRemainingDashboards";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function SuperAdminAnalyticsPanel() {
  const { data, isLoading, error } = useSuperAdminAnalytics();
  if (isLoading) return <Skeleton className="h-64 w-full rounded-2xl" />;
  if (error) return <Card className="rounded-2xl border-red-200 bg-red-50/50"><CardContent className="p-6"><p className="text-sm text-red-700">Unable to load super admin analytics.</p></CardContent></Card>;

  const health = data?.system_health ?? { db_connections: 0, api_p95_ms: 0, error_rate_pct: 0 };
  const security = data?.security_alerts ?? { failed_logins_24h: 0, suspicious_activity: 0, blocked_ips: 0 };
  const jobs = data?.background_jobs ?? { running: 0, failed: 0, queued: 0 };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {[
          { label: "DB Connections", value: health.db_connections, icon: Server, color: "blue" },
          { label: "API P95", value: health.api_p95_ms, suffix: "ms", icon: Activity, color: "cyan" },
          { label: "Failed Logins", value: security.failed_logins_24h, icon: Shield, color: "red" },
          { label: "Jobs Failed", value: jobs.failed, icon: Activity, color: "amber" },
        ].map((kpi) => (
          <Card key={kpi.label} className="rounded-2xl border-white/60 bg-white/95 backdrop-blur-sm shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="pb-2"><div className="flex items-center justify-between"><CardTitle className="text-xs font-bold uppercase text-slate-500">{kpi.label}</CardTitle><div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", kpi.color === "blue" && "bg-blue-50", kpi.color === "cyan" && "bg-cyan-50", kpi.color === "red" && "bg-red-50", kpi.color === "amber" && "bg-amber-50")}><kpi.icon className={cn("h-4 w-4", kpi.color === "blue" && "text-blue-600", kpi.color === "cyan" && "text-cyan-600", kpi.color === "red" && "text-red-600", kpi.color === "amber" && "text-amber-600")} /></div></div></CardHeader>
            <CardContent><div className="text-2xl font-black text-slate-900">{kpi.value}{kpi.suffix}</div></CardContent>
          </Card>
        ))}
      </div>

      <Card className="rounded-2xl border-white/60 bg-white/95 backdrop-blur-sm shadow-sm">
        <CardHeader className="bg-gradient-to-r from-slate-700 to-slate-900 text-white rounded-t-2xl"><CardTitle className="text-base font-bold">System Health</CardTitle></CardHeader>
        <CardContent className="p-6"><div className="grid grid-cols-3 gap-4 text-center"><div><div className={cn("text-3xl font-black", health.error_rate_pct < 1 ? "text-emerald-600" : "text-red-600")}>{health.error_rate_pct.toFixed(2)}%</div><p className="text-sm text-slate-600 mt-1">Error Rate</p></div><div><div className="text-3xl font-black text-blue-600">{jobs.running}</div><p className="text-sm text-slate-600 mt-1">Running Jobs</p></div><div><div className="text-3xl font-black text-amber-600">{jobs.queued}</div><p className="text-sm text-slate-600 mt-1">Queued Jobs</p></div></div></CardContent>
      </Card>
    </div>
  );
}
