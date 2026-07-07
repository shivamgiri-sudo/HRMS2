import { useQuery } from "@tanstack/react-query";
import { Palmtree } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { hrmsApi } from "@/lib/hrmsApi";

export function LeaveBalanceWidget() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["dashboard-leave-balance"],
    queryFn: () => hrmsApi.get("/api/leave/balance"),
    staleTime: 1000 * 60 * 5,
  });

  const balance = data?.data?.balance ?? 0;
  const total = data?.data?.total ?? 25;
  const used = total - balance;
  const balancePct = (balance / total) * 100;

  return (
    <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
      <CardHeader className="border-b border-slate-100 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-100 text-cyan-600">
            <Palmtree className="h-4 w-4" />
          </div>
          <div>
            <CardTitle className="text-sm font-bold text-slate-900">Leave Balance</CardTitle>
            <p className="text-[10px] text-slate-500">Current cycle</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4 space-y-3">
        {isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black text-slate-900 tabular-nums" style={{ fontFamily: "'Fira Code', monospace" }}>
                {balance}
              </span>
              <span className="text-sm text-slate-500">/ {total} days</span>
            </div>
            <div className="relative h-3 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all"
                style={{ width: `${balancePct}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">Used: {used} days</span>
              <span className={`font-semibold ${balance < 3 ? "text-red-600" : "text-emerald-600"}`}>
                {balance < 3 ? "Low balance" : "Available"}
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
