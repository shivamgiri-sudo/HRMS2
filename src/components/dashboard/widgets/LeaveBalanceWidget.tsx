import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Umbrella } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { hrmsApi } from "@/lib/hrmsApi";

export function LeaveBalanceWidget() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["dashboard-leave-balance"],
    queryFn: () => hrmsApi.get("/api/leave/balance"),
    staleTime: 1000 * 60 * 5,
  });

  // API returns array of leave type balances
  const items: any[] = Array.isArray(data?.data) ? data.data : [];
  const totalAvailable = items.reduce((s, x) => s + (x.available_days ?? 0), 0);
  const totalAllocated = items.reduce((s, x) => s + (x.allocated_days ?? 0), 0);
  const totalUsed = items.reduce((s, x) => s + (x.used_days ?? 0), 0);
  const balancePct = totalAllocated > 0 ? (totalAvailable / totalAllocated) * 100 : 0;
  const isLow = totalAvailable < 3;

  // Top leave types to show
  const topTypes = items.filter(x => x.available_days > 0).slice(0, 3);

  return (
    <div className="dashboard-card h-full">
      <div className="dashboard-card-header">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-cyan-50 border border-cyan-100 flex items-center justify-center text-cyan-600 flex-shrink-0">
            <Umbrella className="w-3.5 h-3.5" />
          </div>
          <div>
            <p className="dashboard-card-title">Leave Balance</p>
            <p className="dashboard-card-subtitle">Current cycle · {items.length} types</p>
          </div>
        </div>
        <Link to="/leaves" className="dash-link">Apply →</Link>
      </div>

      <div className="p-4 space-y-3">
        {isLoading ? (
          <Skeleton className="h-20 w-full rounded-lg" />
        ) : (
          <>
            <div className="flex items-end gap-2">
              <span className={`dash-metric text-[32px] ${isLow ? "text-red-500" : "text-slate-900"}`}>
                {totalAvailable.toFixed(1)}
              </span>
              <span className="text-sm text-slate-400 mb-1.5">/ {totalAllocated} days</span>
            </div>

            <div className="space-y-1">
              <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${isLow ? "bg-red-400" : "bg-emerald-500"}`}
                  style={{ width: `${Math.min(balancePct, 100)}%` }}
                />
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[11px] text-slate-400">Used: <span className="font-semibold text-slate-600">{totalUsed.toFixed(1)}d</span></span>
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${isLow ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-700"}`}>
                  {isLow ? "Low balance" : `${totalAvailable.toFixed(1)} avail.`}
                </span>
              </div>
            </div>

            {topTypes.length > 0 && (
              <div className="pt-1 space-y-1.5 border-t border-slate-100">
                {topTypes.map((lt) => (
                  <div key={lt.id} className="flex items-center justify-between">
                    <span className="text-[11px] text-slate-500 font-medium">{lt.leave_name}</span>
                    <span className="dash-metric text-[13px] text-slate-800">{lt.available_days}d</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
