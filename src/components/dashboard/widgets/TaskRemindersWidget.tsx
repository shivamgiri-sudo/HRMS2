import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CheckSquare, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { hrmsApi } from "@/lib/hrmsApi";

const PRIORITY_STYLE: Record<string, string> = {
  high:   "text-red-600 bg-red-50",
  medium: "text-amber-600 bg-amber-50",
  low:    "text-slate-500 bg-slate-100",
};

function formatDue(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const today = new Date();
  const diff = Math.ceil((d.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return "Due today";
  if (diff === 1) return "Due in 1 day";
  if (diff < 0) return `${Math.abs(diff)}d overdue`;
  return `Due in ${diff} days`;
}

export function TaskRemindersWidget() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["engagement-actions"],
    queryFn: () => hrmsApi.get("/api/engagement-intelligence/actions"),
    staleTime: 1000 * 60 * 5,
  });
  const actions: any[] = Array.isArray(data?.data) ? data.data.filter((a: any) => a.status !== "completed").slice(0, 4) : [];

  return (
    <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
      <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 pb-4 pt-5 px-5">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-amber-50 border border-amber-100 flex items-center justify-center">
            <CheckSquare className="w-3.5 h-3.5 text-amber-600" />
          </div>
          <CardTitle className="text-sm font-bold text-slate-900">Task Reminders</CardTitle>
        </div>
        <Link to="/work-inbox" className="text-xs font-semibold text-[#1B6AB5] hover:underline">View All Tasks →</Link>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? <div className="p-4"><Skeleton className="h-20 w-full rounded-xl" /></div> : actions.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-400">No pending tasks</div>
        ) : (
          actions.map((action, i) => (
            <div key={i} className="flex items-center gap-3 px-5 py-3 border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors">
              <div className="w-4 h-4 rounded border-2 border-slate-300 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">{(action.action_type ?? "Task").replace(/_/g," ").replace(/\b\w/g, (c: string) => c.toUpperCase())}</p>
                {action.notes && <p className="text-[11px] text-slate-500 truncate">{action.notes}</p>}
              </div>
              <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                {action.due_date && (
                  <span className="text-[10px] text-slate-400 flex items-center gap-0.5">
                    <Clock className="w-2.5 h-2.5" /> {formatDue(action.due_date)}
                  </span>
                )}
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${PRIORITY_STYLE[action.priority ?? "low"] ?? PRIORITY_STYLE.low}`}>
                  {(action.priority ?? "Low").charAt(0).toUpperCase() + (action.priority ?? "low").slice(1)}
                </span>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
