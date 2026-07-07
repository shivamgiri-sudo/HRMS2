import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AlertCircle, ArrowRight, CheckCircle2, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { hrmsApi } from "@/lib/hrmsApi";

export function PendingActionsWidget() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["dashboard-pending-actions"],
    queryFn: () => hrmsApi.get("/api/dashboards/hr/summary"),
    staleTime: 1000 * 60 * 2,
  });

  const workItems = data?.data?.workItems ?? [];
  const actions = workItems.slice(0, 6);

  const overdue = actions.filter((a: any) => a.overdue).length;

  return (
    <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
      <CardHeader className="flex flex-row items-start justify-between border-b border-slate-100 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100 text-amber-600">
            <Clock className="h-4 w-4" />
          </div>
          <div>
            <CardTitle className="text-base font-bold text-slate-900">Pending Actions</CardTitle>
            <p className="mt-0.5 text-xs text-slate-500">Items requiring your attention</p>
          </div>
        </div>
        {overdue > 0 && (
          <Badge className="rounded-full bg-red-100 text-red-700 border-red-200 text-[10px] px-2">
            {overdue} overdue
          </Badge>
        )}
      </CardHeader>
      <CardContent className="p-4">
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : actions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-500 mb-2" />
            <p className="text-sm font-semibold text-slate-700">All caught up!</p>
            <p className="text-xs text-slate-400 mt-1">No pending actions right now</p>
          </div>
        ) : (
          <div className="space-y-2">
            {actions.map((action: any, i: number) => (
              <Link
                key={i}
                to={action.href ?? "#"}
                className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-100 hover:border-slate-200 transition group"
              >
                <div
                  className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${
                    action.overdue ? "bg-red-100 text-red-600" : "bg-blue-100 text-blue-600"
                  }`}
                >
                  {action.overdue ? <AlertCircle className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{action.title}</p>
                  <p className="text-xs text-slate-500 truncate">{action.subtitle ?? "—"}</p>
                </div>
                <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-slate-600 transition flex-shrink-0" />
              </Link>
            ))}
            {workItems.length > 6 && (
              <Link
                to="/work-inbox"
                className="flex items-center justify-center gap-2 text-xs font-semibold text-[#1B6AB5] hover:underline pt-2"
              >
                View all {workItems.length} items <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
