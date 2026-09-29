import {
  Users,
  Target,
  TrendingUp,
  TrendingDown,
  MessageSquare,
  AlertTriangle,
  Award,
  BarChart3,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useManagerAnalytics } from "@/hooks/useManagerDashboardMetrics";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-IN").format(value);
}

export function ManagerAnalyticsPanel() {
  const { data, isLoading, error } = useManagerAnalytics();

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
            Unable to load manager analytics. {error instanceof Error ? error.message : "Please try again."}
          </p>
        </CardContent>
      </Card>
    );
  }

  const teamSize = data?.team_size ?? 0;
  const qualityAvg = data?.team_quality_avg ?? 0;
  const kpiAvg = data?.team_kpi_avg ?? 0;
  const oneOnOne = data?.one_on_one_completion ?? { scheduled: 0, completed: 0, completion_rate: 0 };
  const pip = data?.pip_tracking ?? { active_pips: 0, completed_this_month: 0, at_risk_count: 0 };
  const bands = data?.performance_bands ?? { s_rating: 0, a_rating: 0, b_rating: 0, c_rating: 0, d_rating: 0 };
  const atRisk = data?.attrition_risk ?? [];
  const kpiByProcess = data?.team_kpi_by_process ?? [];
  const qualityDist = data?.quality_distribution ?? [];

  return (
    <div className="space-y-4">
      {/* KPI Tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
        {/* Team Size */}
        <Card className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Team Size
              </CardTitle>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-indigo-50">
                <Users className="h-4 w-4 text-indigo-600" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black text-slate-900">{formatNumber(teamSize)}</div>
            <p className="text-xs font-medium text-slate-500 mt-1">Active Employees</p>
          </CardContent>
        </Card>

        {/* Team Quality Avg */}
        <Card className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Team Quality
              </CardTitle>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-purple-50">
                <Award className="h-4 w-4 text-purple-600" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <div className="text-2xl font-black text-slate-900">{qualityAvg}</div>
              {qualityAvg >= 80 ? (
                <TrendingUp className="h-4 w-4 text-emerald-600" />
              ) : (
                <TrendingDown className="h-4 w-4 text-red-600" />
              )}
            </div>
            <p className="text-xs font-medium text-slate-500 mt-1">Last 30 Days</p>
          </CardContent>
        </Card>

        {/* Team KPI Avg */}
        <Card className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Team KPI
              </CardTitle>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-cyan-50">
                <Target className="h-4 w-4 text-cyan-600" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <div className="text-2xl font-black text-slate-900">{kpiAvg}%</div>
              {kpiAvg >= 90 ? (
                <TrendingUp className="h-4 w-4 text-emerald-600" />
              ) : (
                <TrendingDown className="h-4 w-4 text-red-600" />
              )}
            </div>
            <p className="text-xs font-medium text-slate-500 mt-1">Avg Achievement</p>
          </CardContent>
        </Card>

        {/* 1:1 Completion */}
        <Card className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-bold uppercase tracking-wide text-slate-500">
                1:1 Completion
              </CardTitle>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-emerald-50">
                <MessageSquare className="h-4 w-4 text-emerald-600" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <div className="text-2xl font-black text-slate-900">{oneOnOne.completion_rate}%</div>
              {oneOnOne.completion_rate >= 80 ? (
                <TrendingUp className="h-4 w-4 text-emerald-600" />
              ) : (
                <TrendingDown className="h-4 w-4 text-red-600" />
              )}
            </div>
            <p className="text-xs font-medium text-slate-500 mt-1">
              {oneOnOne.completed}/{oneOnOne.scheduled} This Month
            </p>
          </CardContent>
        </Card>

        {/* Attrition Risk */}
        <Card className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Attrition Risk
              </CardTitle>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-red-50">
                <AlertTriangle className="h-4 w-4 text-red-600" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black text-slate-900">{formatNumber(pip.at_risk_count)}</div>
            <p className="text-xs font-medium text-slate-500 mt-1">High Risk Employees</p>
          </CardContent>
        </Card>
      </div>

      {/* Performance Bands Distribution */}
      <Card className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm">
        <CardHeader className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-t-2xl">
          <CardTitle className="text-base font-bold">Performance Band Distribution</CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            {[
              { label: 'S Rating', value: bands.s_rating, color: 'emerald', desc: '≥100%' },
              { label: 'A Rating', value: bands.a_rating, color: 'green', desc: '90-99%' },
              { label: 'B Rating', value: bands.b_rating, color: 'blue', desc: '75-89%' },
              { label: 'C Rating', value: bands.c_rating, color: 'amber', desc: '60-74%' },
              { label: 'D Rating', value: bands.d_rating, color: 'red', desc: '<60%' },
            ].map((band) => (
              <div key={band.label} className="text-center">
                <div className={cn(
                  "text-3xl font-black",
                  band.color === 'emerald' && "text-emerald-600",
                  band.color === 'green' && "text-green-600",
                  band.color === 'blue' && "text-blue-600",
                  band.color === 'amber' && "text-amber-600",
                  band.color === 'red' && "text-red-600"
                )}>
                  {band.value}
                </div>
                <p className="text-sm font-semibold text-slate-900 mt-1">{band.label}</p>
                <p className="text-xs text-slate-500">{band.desc}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Team KPI by Process */}
      <Card className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm">
        <CardHeader className="bg-gradient-to-r from-cyan-600 to-indigo-600 text-white rounded-t-2xl">
          <CardTitle className="text-base font-bold">Team KPI vs Target</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {kpiByProcess.length === 0 ? (
            <div className="p-6 text-center text-sm text-slate-500">No KPI data available</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="text-left p-3 text-xs font-bold uppercase tracking-wide text-slate-600">
                      Process
                    </th>
                    <th className="text-right p-3 text-xs font-bold uppercase tracking-wide text-slate-600">
                      Target
                    </th>
                    <th className="text-right p-3 text-xs font-bold uppercase tracking-wide text-slate-600">
                      Actual
                    </th>
                    <th className="text-right p-3 text-xs font-bold uppercase tracking-wide text-slate-600">
                      Achievement %
                    </th>
                    <th className="text-center p-3 text-xs font-bold uppercase tracking-wide text-slate-600">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {kpiByProcess.map((kpi, idx) => (
                    <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                      <td className="p-3 text-sm font-semibold text-slate-900">{kpi.process_name}</td>
                      <td className="p-3 text-right text-sm font-bold text-blue-700">
                        {formatNumber(kpi.target)}
                      </td>
                      <td className="p-3 text-right text-sm font-bold text-cyan-700">
                        {formatNumber(kpi.actual)}
                      </td>
                      <td className="p-3 text-right">
                        <span className={cn(
                          "inline-flex items-center gap-1 text-sm font-bold",
                          kpi.achievement_pct >= 90 ? "text-emerald-600" :
                          kpi.achievement_pct >= 75 ? "text-amber-600" :
                          "text-red-600"
                        )}>
                          {kpi.achievement_pct >= 90 ? (
                            <TrendingUp className="h-3.5 w-3.5" />
                          ) : (
                            <TrendingDown className="h-3.5 w-3.5" />
                          )}
                          {kpi.achievement_pct}%
                        </span>
                      </td>
                      <td className="p-3 text-center">
                        <span className={cn(
                          "inline-block w-3 h-3 rounded-full",
                          kpi.status === 'green' && "bg-emerald-500",
                          kpi.status === 'amber' && "bg-amber-500",
                          kpi.status === 'red' && "bg-red-500"
                        )} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quality Distribution Histogram */}
      <Card className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm">
        <CardHeader className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-t-2xl">
          <CardTitle className="text-base font-bold">Team Quality Distribution</CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          {qualityDist.length === 0 ? (
            <div className="text-center text-sm text-slate-500">No quality data available</div>
          ) : (
            <div className="space-y-3">
              {qualityDist.map((dist, idx) => (
                <div key={idx} className="flex items-center gap-4">
                  <div className="w-20 text-sm font-semibold text-slate-900">{dist.score_range}</div>
                  <div className="flex-1 h-8 bg-slate-100 rounded-lg overflow-hidden">
                    <div
                      className={cn(
                        "h-full flex items-center justify-end pr-3 text-xs font-bold text-white transition-all",
                        dist.score_range.startsWith('90') && "bg-gradient-to-r from-emerald-500 to-emerald-600",
                        dist.score_range.startsWith('80') && "bg-gradient-to-r from-green-500 to-green-600",
                        dist.score_range.startsWith('70') && "bg-gradient-to-r from-blue-500 to-blue-600",
                        dist.score_range.startsWith('60') && "bg-gradient-to-r from-amber-500 to-amber-600",
                        dist.score_range.startsWith('<') && "bg-gradient-to-r from-red-500 to-red-600"
                      )}
                      style={{ width: `${Math.max((dist.count / teamSize) * 100, 5)}%` }}
                    >
                      {dist.count}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Attrition Risk Employees */}
      {atRisk.length > 0 && (
        <Card className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm">
          <CardHeader className="bg-gradient-to-r from-red-600 to-rose-600 text-white rounded-t-2xl">
            <CardTitle className="text-base font-bold">Attrition Risk — Needs Attention</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="text-left p-3 text-xs font-bold uppercase tracking-wide text-slate-600">
                      Employee
                    </th>
                    <th className="text-right p-3 text-xs font-bold uppercase tracking-wide text-slate-600">
                      Quality
                    </th>
                    <th className="text-right p-3 text-xs font-bold uppercase tracking-wide text-slate-600">
                      Attendance %
                    </th>
                    <th className="text-center p-3 text-xs font-bold uppercase tracking-wide text-slate-600">
                      Risk Level
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {atRisk.map((emp, idx) => (
                    <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                      <td className="p-3 text-sm font-semibold text-slate-900">{emp.employee_name}</td>
                      <td className="p-3 text-right text-sm font-bold text-purple-700">
                        {emp.quality_score}
                      </td>
                      <td className="p-3 text-right text-sm font-bold text-cyan-700">
                        {emp.attendance_pct}%
                      </td>
                      <td className="p-3 text-center">
                        <span className={cn(
                          "inline-block px-2 py-0.5 rounded-full text-xs font-bold",
                          emp.risk_level === 'critical' && "bg-red-100 text-red-700",
                          emp.risk_level === 'high' && "bg-amber-100 text-amber-700",
                          emp.risk_level === 'medium' && "bg-yellow-100 text-yellow-700"
                        )}>
                          {emp.risk_level.toUpperCase()}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* PIP Tracking Summary */}
      <Card className="rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm">
        <CardHeader className="bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-t-2xl">
          <CardTitle className="text-base font-bold">PIP Tracking</CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="text-center">
              <div className="text-3xl font-black text-amber-600">{pip.active_pips}</div>
              <p className="text-sm font-semibold text-slate-600 mt-1">Active PIPs</p>
            </div>
            <div className="text-center">
              <div className="text-3xl font-black text-emerald-600">{pip.completed_this_month}</div>
              <p className="text-sm font-semibold text-slate-600 mt-1">Completed (MTD)</p>
            </div>
            <div className="text-center">
              <div className="text-3xl font-black text-red-600">{pip.at_risk_count}</div>
              <p className="text-sm font-semibold text-slate-600 mt-1">At Risk</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
