import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { hrmsApi } from "@/lib/hrmsApi";

export function LeaveBalanceTable() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["leave-balance"],
    queryFn: () => hrmsApi.get("/api/leave/balance"),
    staleTime: 1000 * 60 * 5,
  });
  const items: any[] = Array.isArray(data?.data) ? data.data : [];

  return (
    <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
      <CardHeader className="flex flex-row items-center justify-between border-b border-slate-100 pb-4 pt-5 px-5">
        <CardTitle className="text-sm font-bold text-slate-900">My Leave Balance</CardTitle>
        <Link to="/leaves" className="text-xs font-semibold text-[#1B6AB5] hover:underline">View Leave Policy →</Link>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? <div className="p-4"><Skeleton className="h-32 w-full rounded-xl" /></div> : (
          <div>
            <div className="grid grid-cols-[1fr_auto_1fr_auto] gap-x-4 px-5 py-2 border-b border-slate-50">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Leave Type</span>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Remaining</span>
              <span />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 text-right">Used / Entitled</span>
            </div>
            {items.map((lt, i) => {
              const pct = lt.allocated_days > 0 ? (lt.available_days / lt.allocated_days) * 100 : 0;
              const isLow = lt.available_days < 3;
              return (
                <div key={i} className="grid grid-cols-[1fr_auto_1fr_auto] gap-x-4 items-center px-5 py-3 border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors">
                  <span className="text-sm text-slate-700 font-medium">{lt.leave_name} ({lt.leave_code})</span>
                  <span className={`text-sm font-bold tabular-nums ${isLow ? "text-red-600" : "text-emerald-600"}`} style={{ fontFamily: "'Fira Code', monospace" }}>
                    {Number(lt.available_days).toFixed(1)} Days
                  </span>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${isLow ? "bg-red-400" : "bg-emerald-500"}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                  </div>
                  <span className="text-xs text-slate-500 text-right tabular-nums">{Number(lt.used_days).toFixed(1)} / {lt.allocated_days}</span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
