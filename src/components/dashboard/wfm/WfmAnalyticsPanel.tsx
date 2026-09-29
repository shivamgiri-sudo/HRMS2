import {
  Calendar,
  Users,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Clock,
  UserCheck,
  Coffee,
  Activity,
  Target,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useWfmAnalytics } from "@/hooks/useWfmDashboardMetrics";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-IN").format(value);
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${value.toFixed(1)}%`;
}

export function WfmAnalyticsPanel() {
  const { data, isLoading, error } = useWfmAnalytics();

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="rounded-2xl border border-red-200 bg-red-50/50 backdrop-blur-sm">
        <CardContent className="p-6">
          <p className="text-sm font-medium text-red-700">
            Unable to load WFM analytics. {error instanceof Error ? error.message : "Please try again."}
          </p>
        </CardContent>
      </Card>
    );
  }

  const rosterPublishRate = data?.roster_publish_rate ?? 0;
  const adherencePct = data?.adherence_pct ?? 0;
  const shrinkagePct = data?.shrinkage_pct ?? 0;
  const exceptions = data?.attendance_exceptions ?? { mismatch_count: 0, cosec_sync_errors: 0, manual_entry_count: 0 };
  const rtAttendance = data?.real_time_attendance ?? {
    expected_today: 0,
    present: 0,
    absent: 0,
    late: 0,
    on_leave: 0,
    attendance_pct: 0,
  };
  const breakCompliance = data?.break_compliance ?? { over_break_count: 0, avg_over_break_mins: 0, top_violators: [] };
  const forecast = data?.workforce_forecast ?? [];
  const adherenceByProcess = data?.adherence_by_process ?? [];

  return (
    <div className="space-y-4">
      {/* KPI Tiles — Pattern #123 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
        {/* Roster Publish Rate */}
        <Card className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Roster Published
              </CardTitle>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-teal-50">
                <Calendar className="h-4 w-4 text-teal-600" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <div className="text-2xl font-black text-slate-900">{rosterPublishRate}%</div>
              {rosterPublishRate >= 90 ? (
                <TrendingUp className="h-4 w-4 text-emerald-600" />
              ) : (
                <TrendingDown className="h-4 w-4 text-red-600" />
              )}
            </div>
            <p className="text-xs font-medium text-slate-500 mt-1">Next 7 Days</p>
          </CardContent>
        </Card>

        {/* Adherence % */}
        <Card className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Adherence
              </CardTitle>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-cyan-50">
                <UserCheck className="h-4 w-4 text-cyan-600" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <div className="text-2xl font-black text-slate-900">{adherencePct}%</div>
              {adherencePct >= 80 ? (
                <TrendingUp className="h-4 w-4 text-emerald-600" />
              ) : (
                <TrendingDown className="h-4 w-4 text-red-600" />
              )}
            </div>
            <p className="text-xs font-medium text-slate-500 mt-1">Rostered vs Actual</p>
          </CardContent>
        </Card>

        {/* Shrinkage % */}
        <Card className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Shrinkage
              </CardTitle>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-amber-50">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <div className="text-2xl font-black text-slate-900">{shrinkagePct}%</div>
              {shrinkagePct <= 10 ? (
                <TrendingDown className="h-4 w-4 text-emerald-600" />
              ) : (
                <TrendingUp className="h-4 w-4 text-red-600" />
              )}
            </div>
            <p className="text-xs font-medium text-slate-500 mt-1">Last 7 Days</p>
          </CardContent>
        </Card>

        {/* Exceptions */}
        <Card className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Exceptions
              </CardTitle>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-red-50">
                <AlertTriangle className="h-4 w-4 text-red-600" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black text-slate-900">
              {formatNumber(exceptions.mismatch_count + exceptions.cosec_sync_errors + exceptions.manual_entry_count)}
            </div>
            <p className="text-xs font-medium text-slate-500 mt-1">Unresolved Today</p>
          </CardContent>
        </Card>

        {/* Break Violations */}
        <Card className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Over-Break
              </CardTitle>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-purple-50">
                <Coffee className="h-4 w-4 text-purple-600" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black text-slate-900">{formatNumber(breakCompliance.over_break_count)}</div>
            <p className="text-xs font-medium text-slate-500 mt-1">Avg +{breakCompliance.avg_over_break_mins} mins</p>
          </CardContent>
        </Card>
      </div>

      {/* Real-Time Attendance — Pattern #118 Heatmap-style */}
      <Card className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm">
        <CardHeader className="bg-gradient-to-r from-teal-500 to-cyan-500 text-white rounded-t-2xl">
          <CardTitle className="text-base font-bold">Real-Time Attendance (Today)</CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto rounded-full bg-gradient-to-br from-teal-100 to-cyan-100 flex items-center justify-center mb-2">
                <Users className="h-8 w-8 text-teal-700" />
              </div>
              <div className="text-2xl font-black text-slate-900">{formatNumber(rtAttendance.expected_today)}</div>
              <p className="text-xs font-semibold text-slate-600 mt-1">Expected</p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 mx-auto rounded-full bg-gradient-to-br from-emerald-100 to-green-100 flex items-center justify-center mb-2">
                <UserCheck className="h-8 w-8 text-emerald-700" />
              </div>
              <div className="text-2xl font-black text-emerald-700">{formatNumber(rtAttendance.present)}</div>
              <p className="text-xs font-semibold text-slate-600 mt-1">Present</p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 mx-auto rounded-full bg-gradient-to-br from-red-100 to-rose-100 flex items-center justify-center mb-2">
                <AlertTriangle className="h-8 w-8 text-red-700" />
              </div>
              <div className="text-2xl font-black text-red-700">{formatNumber(rtAttendance.absent)}</div>
              <p className="text-xs font-semibold text-slate-600 mt-1">Absent</p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 mx-auto rounded-full bg-gradient-to-br from-amber-100 to-orange-100 flex items-center justify-center mb-2">
                <Clock className="h-8 w-8 text-amber-700" />
              </div>
              <div className="text-2xl font-black text-amber-700">{formatNumber(rtAttendance.late)}</div>
              <p className="text-xs font-semibold text-slate-600 mt-1">Late</p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 mx-auto rounded-full bg-gradient-to-br from-purple-100 to-violet-100 flex items-center justify-center mb-2">
                <Activity className="h-8 w-8 text-purple-700" />
              </div>
              <div className="text-2xl font-black text-purple-700">{formatNumber(rtAttendance.on_leave)}</div>
              <p className="text-xs font-semibold text-slate-600 mt-1">On Leave</p>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-slate-200">
            <div className="flex items-center justify-center gap-2">
              <span className="text-sm font-semibold text-slate-600">Attendance Rate:</span>
              <span className={cn(
                "text-xl font-black",
                rtAttendance.attendance_pct >= 90 ? "text-emerald-600" :
                rtAttendance.attendance_pct >= 80 ? "text-amber-600" :
                "text-red-600"
              )}>
                {formatPercent(rtAttendance.attendance_pct)}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Adherence by Process */}
      <Card className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm">
        <CardHeader className="bg-gradient-to-r from-cyan-600 to-teal-600 text-white rounded-t-2xl">
          <CardTitle className="text-base font-bold">Adherence by Process</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {adherenceByProcess.length === 0 ? (
            <div className="p-6 text-center text-sm text-slate-500">No process data available</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="text-left p-3 text-xs font-bold uppercase tracking-wide text-slate-600">
                      Process
                    </th>
                    <th className="text-right p-3 text-xs font-bold uppercase tracking-wide text-slate-600">
                      Rostered
                    </th>
                    <th className="text-right p-3 text-xs font-bold uppercase tracking-wide text-slate-600">
                      Actual
                    </th>
                    <th className="text-right p-3 text-xs font-bold uppercase tracking-wide text-slate-600">
                      Adherence %
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {adherenceByProcess.map((process, idx) => (
                    <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                      <td className="p-3 text-sm font-semibold text-slate-900">{process.process_name}</td>
                      <td className="p-3 text-right text-sm font-bold text-teal-700">
                        {formatNumber(process.rostered)}
                      </td>
                      <td className="p-3 text-right text-sm font-bold text-cyan-700">
                        {formatNumber(process.actual)}
                      </td>
                      <td className="p-3 text-right">
                        <span className={cn(
                          "inline-flex items-center gap-1 text-sm font-bold",
                          process.adherence_pct >= 90 ? "text-emerald-600" :
                          process.adherence_pct >= 80 ? "text-amber-600" :
                          "text-red-600"
                        )}>
                          {process.adherence_pct >= 80 ? (
                            <TrendingUp className="h-3.5 w-3.5" />
                          ) : (
                            <TrendingDown className="h-3.5 w-3.5" />
                          )}
                          {formatPercent(process.adherence_pct)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Top Over-Break Violators */}
      {breakCompliance.top_violators.length > 0 && (
        <Card className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm">
          <CardHeader className="bg-gradient-to-r from-purple-600 to-violet-600 text-white rounded-t-2xl">
            <CardTitle className="text-base font-bold">Top Over-Break Employees</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="text-left p-3 text-xs font-bold uppercase tracking-wide text-slate-600">
                      Employee
                    </th>
                    <th className="text-left p-3 text-xs font-bold uppercase tracking-wide text-slate-600">
                      Branch
                    </th>
                    <th className="text-right p-3 text-xs font-bold uppercase tracking-wide text-slate-600">
                      Avg Over-Break (mins)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {breakCompliance.top_violators.map((violator, idx) => (
                    <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                      <td className="p-3 text-sm font-semibold text-slate-900">{violator.employee_name}</td>
                      <td className="p-3 text-sm font-medium text-slate-700">{violator.branch_name}</td>
                      <td className="p-3 text-right text-sm font-bold text-purple-700">
                        +{violator.avg_over_break_mins}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
