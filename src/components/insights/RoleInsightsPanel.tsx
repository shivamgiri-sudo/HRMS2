import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Info, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { insightsForRoles, type InsightSeverity } from "@/lib/roleInsightsCatalog";
import { cn } from "@/lib/utils";

const iconBySeverity: Record<InsightSeverity, React.ElementType> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  critical: ShieldAlert,
};

const toneBySeverity: Record<InsightSeverity, string> = {
  info: "border-blue-100 bg-blue-50 text-blue-700",
  success: "border-emerald-100 bg-emerald-50 text-emerald-700",
  warning: "border-amber-100 bg-amber-50 text-amber-700",
  critical: "border-red-100 bg-red-50 text-red-700",
};

export function RoleInsightsPanel({
  roles,
  title = "Critical insights",
  limit = 6,
  className,
}: {
  roles?: string[];
  title?: string;
  limit?: number;
  className?: string;
}) {
  const insights = insightsForRoles(roles ?? []).slice(0, limit);
  if (!insights.length) return null;

  return (
    <Card className={cn("border-slate-200 bg-white shadow-sm", className)}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-black text-slate-900">{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {insights.map((insight) => {
          const Icon = iconBySeverity[insight.severity];
          return (
            <Link
              key={insight.id}
              to={insight.actionPath}
              className={cn(
                "block rounded-2xl border p-4 transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-300",
                toneBySeverity[insight.severity],
              )}
            >
              <div className="flex items-start gap-3">
                <div className="rounded-xl bg-white/70 p-2">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-black leading-5">{insight.title}</h3>
                  <p className="mt-1 text-xs leading-5 opacity-80">{insight.description}</p>
                  <span className="mt-3 inline-flex h-8 items-center rounded-xl bg-white/80 px-3 text-xs font-bold text-slate-800 hover:bg-white">
                    {insight.actionLabel}
                  </span>
                </div>
              </div>
            </Link>
          );
        })}
      </CardContent>
    </Card>
  );
}
