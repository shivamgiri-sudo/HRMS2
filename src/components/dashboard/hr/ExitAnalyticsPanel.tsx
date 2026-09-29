import { TrendingUp, UserX, Clock, AlertCircle, Calendar, FileCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useExitAnalytics } from "@/hooks/useHrDashboardMetrics";
import { Skeleton } from "@/components/ui/skeleton";

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-IN").format(value);
}

export function ExitAnalyticsPanel() {
  const { data, isLoading, error } = useExitAnalytics();

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="rounded-2xl border border-red-200 bg-red-50/50 backdrop-blur-sm">
        <CardContent className="p-6">
          <p className="text-sm font-medium text-red-700">
            Unable to load exit analytics. {error instanceof Error ? error.message : "Please try again."}
          </p>
        </CardContent>
      </Card>
    );
  }

  const resignationsThisMonth = data?.resignations_this_month ?? 0;
  const resignationsYtd = data?.resignations_ytd ?? 0;
  const avgNoticeDays = data?.avg_notice_period_days ?? 0;
  const ffPending = data?.ff_pending_count ?? 0;
  const ffOverdue = data?.ff_pending_over_45_days ?? 0;
  const avgClearanceTat = data?.avg_clearance_tat_days ?? 0;
  const ffAging = data?.ff_aging_buckets ?? { under_30: 0, "30_to_45": 0, over_45: 0 };
  const exitsByMonth = data?.exits_by_month ?? [];

  return (
    <div className="space-y-4">
      {/* KPI Tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Resignations This Month */}
        <Card className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Resignations (MTD)
              </CardTitle>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-amber-50">
                <UserX className="h-4 w-4 text-amber-600" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black text-slate-900">{formatNumber(resignationsThisMonth)}</div>
            <p className="text-xs font-medium text-slate-500 mt-1">
              {formatNumber(resignationsYtd)} YTD
            </p>
          </CardContent>
        </Card>

        {/* Avg Notice Period */}
        <Card className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Avg Notice Period
              </CardTitle>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-blue-50">
                <Calendar className="h-4 w-4 text-blue-600" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black text-slate-900">{avgNoticeDays}</div>
            <p className="text-xs font-medium text-slate-500 mt-1">Days (Avg YTD)</p>
          </CardContent>
        </Card>

        {/* F&F Pending */}
        <Card className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-bold uppercase tracking-wide text-slate-500">
                F&F Pending
              </CardTitle>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-purple-50">
                <Clock className="h-4 w-4 text-purple-600" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <div className="text-2xl font-black text-slate-900">{formatNumber(ffPending)}</div>
              {ffOverdue > 0 && (
                <div className="flex items-center gap-1 text-sm font-bold text-red-600">
                  <AlertCircle className="h-3.5 w-3.5" />
                  <span>{ffOverdue} overdue</span>
                </div>
              )}
            </div>
            <p className="text-xs font-medium text-slate-500 mt-1">Post-LWD Settlement</p>
          </CardContent>
        </Card>

        {/* Clearance TAT */}
        <Card className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Avg Clearance TAT
              </CardTitle>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-emerald-50">
                <FileCheck className="h-4 w-4 text-emerald-600" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black text-slate-900">{avgClearanceTat}</div>
            <p className="text-xs font-medium text-slate-500 mt-1">Days (LWD → Clearance)</p>
          </CardContent>
        </Card>
      </div>

      {/* F&F Aging Breakdown */}
      <Card className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm">
        <CardHeader className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-t-2xl">
          <CardTitle className="text-base font-bold">F&F Settlement Aging</CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="text-center">
              <div className="text-3xl font-black text-emerald-600">{ffAging.under_30}</div>
              <p className="text-sm font-semibold text-slate-600 mt-1">&lt; 30 Days</p>
            </div>
            <div className="text-center">
              <div className="text-3xl font-black text-amber-600">{ffAging["30_to_45"]}</div>
              <p className="text-sm font-semibold text-slate-600 mt-1">30-45 Days</p>
            </div>
            <div className="text-center">
              <div className="text-3xl font-black text-red-600">{ffAging.over_45}</div>
              <p className="text-sm font-semibold text-slate-600 mt-1">&gt; 45 Days</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Exits by Month Trend */}
      <Card className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm">
        <CardHeader className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-t-2xl">
          <CardTitle className="text-base font-bold">Exit Trend (Last 12 Months)</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {exitsByMonth.length === 0 ? (
            <div className="p-6 text-center text-sm text-slate-500">No exit data available</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="text-left p-3 text-xs font-bold uppercase tracking-wide text-slate-600">
                      Month
                    </th>
                    <th className="text-right p-3 text-xs font-bold uppercase tracking-wide text-slate-600">
                      Exit Count
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {exitsByMonth.map((row, idx) => (
                    <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                      <td className="p-3 text-sm font-semibold text-slate-900">{row.month}</td>
                      <td className="p-3 text-right text-sm font-bold text-blue-700">
                        {formatNumber(row.count)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
