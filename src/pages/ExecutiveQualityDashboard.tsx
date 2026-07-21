/**
 * Executive Quality Dashboard
 * Org-level quality summary for executive/management roles
 *
 * Auth Gate: Shows loader if no user
 * Layout: Header → KPI Hero → Trends → Top/Bottom Performers → Process Scorecard → Benchmarks
 */
import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useUserRole } from "@/hooks/useUserRole";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  TrendingUp,
  TrendingDown,
  Target,
  Award,
  AlertCircle,
  Loader2,
  BarChart2,
} from "lucide-react";

interface ExecutiveQualityData {
  metrics: {
    overall_quality_score: number;
    target_quality_score: number;
    gap_pct: number;
    status: string;
    trend_7day: { direction: string; change_pct: number };
    trend_30day: { direction: string; change_pct: number };
  };
  top_performers: Array<{ rank: number; agent_code: string; agent_name: string; quality_score: number; calls_handled: number; process: string }>;
  bottom_performers: Array<{ rank: number; agent_code: string; agent_name: string; quality_score: number; calls_handled: number; process: string }>;
  process_performance: Array<{ process: string; avg_quality: number; agent_count: number; calls_handled: number; status: string }>;
  risk_summary: { critical_agents_count: number; at_risk_agents_count: number; coaching_priority_count: number };
  org_benchmarks: { avg_quality: number; median_quality: number; std_deviation: number };
}

function qualityColor(score: number): string {
  if (score >= 80) return "text-green-600 font-semibold";
  if (score >= 70) return "text-yellow-600 font-semibold";
  return "text-red-600 font-semibold";
}

function statusBadge(status: string): string {
  if (status === "On Track") return "bg-green-100 text-green-700 border-green-200";
  if (status === "At Risk") return "bg-yellow-100 text-yellow-700 border-yellow-200";
  return "bg-red-100 text-red-700 border-red-200";
}

const ALLOWED_ROLES = ["super_admin", "admin", "ceo", "coo"] as const;

export default function ExecutiveQualityDashboard() {
  const { user } = useAuth();
  const [daysBack, setDaysBack] = useState<7 | 30>(30);

  const { data: roleData, isLoading: roleLoading } = useUserRole();
  const isAllowed =
    roleData?.roleKeys?.some((r: string) =>
      (ALLOWED_ROLES as readonly string[]).includes(r)
    ) ?? false;

  const { data, isLoading, isError, error } = useQuery<ExecutiveQualityData>({
    queryKey: ["executive-quality-summary", daysBack],
    queryFn: () =>
      hrmsApi.get(`/api/executive/quality-summary?daysBack=${daysBack}`).then((r) => r.data),
    enabled: !!user && isAllowed,
  });

  // Auth gate
  if (!user) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-screen">
          <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        </div>
      </DashboardLayout>
    );
  }

  // Role loading
  if (roleLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-screen">
          <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        </div>
      </DashboardLayout>
    );
  }

  // Role guard — restricted to super_admin, admin, ceo, coo
  if (!isAllowed) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <p className="text-gray-500 text-sm">You don&apos;t have access to this view.</p>
        </div>
      </DashboardLayout>
    );
  }

  // Loading skeleton
  const Skeleton = ({ h = "h-32" }: { h?: string }) => (
    <Card className="p-6">
      <div className="animate-pulse space-y-3">
        <div className="h-5 bg-slate-200 rounded w-1/3" />
        <div className={`${h} bg-slate-200 rounded`} />
      </div>
    </Card>
  );

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="space-y-6 p-4 md:p-8">
          <div className="mb-6">
            <div className="h-8 bg-slate-200 rounded w-1/3 animate-pulse" />
            <div className="h-4 bg-slate-200 rounded w-1/2 mt-2 animate-pulse" />
          </div>
          <Skeleton h="h-40" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Skeleton />
            <Skeleton />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Skeleton h="h-64" />
            <Skeleton h="h-64" />
          </div>
          <Skeleton h="h-48" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Skeleton />
            <Skeleton />
            <Skeleton />
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (isError || !data) {
    return (
      <DashboardLayout>
        <div className="p-4 md:p-8">
          <Card className="p-6 border-red-200 bg-red-50">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="font-semibold text-red-900">Failed to load quality data</h3>
                <p className="text-sm text-red-700 mt-1">
                  {(error as Error)?.message ?? "An unexpected error occurred. Please refresh."}
                </p>
              </div>
            </div>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  const { metrics, top_performers, bottom_performers, process_performance, org_benchmarks } = data;
  const gapPositive = metrics.gap_pct <= 0; // gap_pct = target - current; negative means above target

  return (
    <DashboardLayout>
      <div className="space-y-6 p-4 md:p-8">
        {/* Page Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-2">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-2">
              <BarChart2 className="h-7 w-7 text-slate-600" />
              Executive Quality Summary
            </h1>
            <p className="text-slate-500 mt-1 text-sm">
              Org-wide quality KPIs, performer rankings and process health
            </p>
          </div>
          {/* Days selector */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-500 mr-1">Period:</span>
            {([7, 30] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDaysBack(d)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                  daysBack === d
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white text-slate-600 border-slate-300 hover:border-slate-500"
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>

        {/* Org KPI Hero */}
        <Card className="p-6 md:p-8 border-slate-200 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center gap-6">
            <div className="flex items-center gap-4">
              <div className="h-14 w-14 rounded-full bg-slate-100 flex items-center justify-center">
                <Target className="h-7 w-7 text-slate-600" />
              </div>
              <div>
                <p className="text-sm text-slate-500 font-medium uppercase tracking-wide">
                  Overall Quality Score
                </p>
                <p className="text-5xl font-extrabold text-slate-900 leading-none mt-1">
                  {metrics.overall_quality_score.toFixed(1)}
                  <span className="text-2xl font-semibold text-slate-400 ml-1">%</span>
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-6 md:ml-10">
              <div>
                <p className="text-xs text-slate-400 uppercase tracking-wide">Target</p>
                <p className="text-2xl font-bold text-slate-700">{metrics.target_quality_score}%</p>
              </div>
              <div>
                <p className="text-xs text-slate-400 uppercase tracking-wide">Gap</p>
                <p className={`text-2xl font-bold ${gapPositive ? "text-green-600" : "text-red-600"}`}>
                  {gapPositive ? "" : "+"}{(-metrics.gap_pct).toFixed(1)}%
                </p>
              </div>
              <div className="flex items-center">
                <Badge
                  className={`text-sm px-3 py-1 border ${statusBadge(metrics.status)}`}
                  variant="outline"
                >
                  {metrics.status}
                </Badge>
              </div>
            </div>
          </div>
        </Card>

        {/* Trend Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[
            { label: "7-Day Trend", trend: metrics.trend_7day },
            { label: "30-Day Trend", trend: metrics.trend_30day },
          ].map(({ label, trend }) => {
            const up = trend.direction === "↗" || trend.change_pct > 0;
            return (
              <Card key={label} className="p-6 flex items-center gap-4">
                <div
                  className={`h-12 w-12 rounded-full flex items-center justify-center ${
                    up ? "bg-green-100" : "bg-red-100"
                  }`}
                >
                  {up ? (
                    <TrendingUp className="h-6 w-6 text-green-600" />
                  ) : (
                    <TrendingDown className="h-6 w-6 text-red-600" />
                  )}
                </div>
                <div>
                  <p className="text-sm text-slate-500">{label}</p>
                  <p className={`text-2xl font-bold ${up ? "text-green-600" : "text-red-600"}`}>
                    {up ? "↑" : "↓"} {Math.abs(trend.change_pct).toFixed(1)}%
                  </p>
                </div>
              </Card>
            );
          })}
        </div>

        {/* Top 10 and Bottom 10 Performers */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Top Performers */}
          <Card className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <Award className="h-5 w-5 text-green-600" />
              <h2 className="text-lg font-semibold text-slate-800">Top Performers</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left py-2 pr-3 text-slate-400 font-medium">#</th>
                    <th className="text-left py-2 pr-3 text-slate-400 font-medium">Agent</th>
                    <th className="text-right py-2 text-slate-400 font-medium">Quality</th>
                  </tr>
                </thead>
                <tbody>
                  {top_performers.map((p) => (
                    <tr key={p.agent_code} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className="py-2 pr-3 text-slate-400">{p.rank}</td>
                      <td className="py-2 pr-3 text-slate-700">{p.agent_name}</td>
                      <td className={`py-2 text-right ${qualityColor(p.quality_score)}`}>
                        {p.quality_score.toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Bottom Performers */}
          <Card className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <AlertCircle className="h-5 w-5 text-red-500" />
              <h2 className="text-lg font-semibold text-slate-800">Bottom Performers</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left py-2 pr-3 text-slate-400 font-medium">#</th>
                    <th className="text-left py-2 pr-3 text-slate-400 font-medium">Agent</th>
                    <th className="text-right py-2 text-slate-400 font-medium">Quality</th>
                  </tr>
                </thead>
                <tbody>
                  {bottom_performers.map((p) => (
                    <tr key={p.agent_code} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className="py-2 pr-3 text-slate-400">{p.rank}</td>
                      <td className="py-2 pr-3 text-slate-700">{p.agent_name}</td>
                      <td className="py-2 text-right text-red-600 font-semibold">
                        {p.quality_score.toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        {/* Process Scorecard */}
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <BarChart2 className="h-5 w-5 text-slate-500" />
            Process Scorecard
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left py-2 pr-6 text-slate-400 font-medium">Process</th>
                  <th className="text-right py-2 pr-6 text-slate-400 font-medium">Avg Quality</th>
                  <th className="text-right py-2 text-slate-400 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {process_performance.map((row, idx) => (
                  <tr key={row.process ?? idx} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="py-2 pr-6 text-slate-700">{row.process || "—"}</td>
                    <td className={`py-2 pr-6 text-right ${qualityColor(row.avg_quality)}`}>
                      {(row.avg_quality ?? 0).toFixed(1)}%
                    </td>
                    <td className="py-2 text-right">
                      <Badge
                        className={`text-xs px-2 py-0.5 border ${statusBadge(row.status)}`}
                        variant="outline"
                      >
                        {row.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Benchmarks */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            { label: "Mean", value: org_benchmarks.avg_quality },
            { label: "Median", value: org_benchmarks.median_quality },
            { label: "Std Dev", value: org_benchmarks.std_deviation },
          ].map(({ label, value }) => (
            <Card key={label} className="p-6 text-center">
              <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">{label}</p>
              <p className="text-3xl font-bold text-slate-800">
                {(value ?? 0).toFixed(2)}
                {label !== "Std Dev" && (
                  <span className="text-lg font-medium text-slate-400 ml-0.5">%</span>
                )}
              </p>
            </Card>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}
