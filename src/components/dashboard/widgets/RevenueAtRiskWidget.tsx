import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { hrmsApi } from "@/lib/hrmsApi";

export function RevenueAtRiskWidget() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["dashboard-ceo-revenue"],
    queryFn: () => hrmsApi.get("/api/management/ceo-metrics"),
    staleTime: 1000 * 60 * 5,
  });

  const rar = data?.data?.revenue_at_risk;
  const shrinkage = rar?.shrinkage_pct ?? 0;
  const atRisk = rar?.revenue_at_risk_inr ?? 0;

  const shrinkageColor = shrinkage > 15 ? "bg-red-500" : shrinkage > 10 ? "bg-amber-500" : "bg-emerald-500";

  return (
    <Card className="rounded-2xl border border-slate-200 shadow-sm bg-white">
      <CardHeader className="border-b border-slate-100 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-100 text-red-600">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div>
            <CardTitle className="text-sm font-bold text-slate-900">Revenue at Risk</CardTitle>
            <p className="text-[10px] text-slate-500">Shrinkage impact</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4 space-y-3">
        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <>
            <div className="flex items-end justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">Shrinkage</p>
                <p className="text-2xl font-black text-slate-900 tabular-nums" style={{ fontFamily: "'Fira Code', monospace" }}>
                  {shrinkage.toFixed(1)}%
                </p>
              </div>
              <div className="h-2 w-24 bg-slate-100 rounded-full overflow-hidden">
                <div className={`h-full ${shrinkageColor} transition-all`} style={{ width: `${Math.min(shrinkage, 100)}%` }} />
              </div>
            </div>
            <div className="pt-2 border-t border-slate-100">
              <p className="text-[10px] text-slate-400">Estimated Revenue Impact</p>
              <p className="text-lg font-black text-red-600 tabular-nums" style={{ fontFamily: "'Fira Code', monospace" }}>
                ₹{(atRisk / 100000).toFixed(1)}L
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
