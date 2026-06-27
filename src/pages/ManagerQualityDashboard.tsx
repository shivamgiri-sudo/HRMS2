/** Manager Quality Dashboard — team-level quality monitoring. Fetches GET /api/manager/team-quality */
import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, TrendingUp, Phone, AlertCircle, Loader2 } from "lucide-react";
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { formatIST, formatISTDate, formatISTTime } from '@/lib/utils';

// Types

interface ManagerQualityData {
  team_summary: {
    avg_quality: number;
    agent_count: number;
    calls_handled: number;
    top_performer: { agent_code: string; agent_name: string; quality: number };
    bottom_performer: { agent_code: string; agent_name: string; quality: number };
    quality_distribution: { excellent: number; good: number; average: number; poor: number };
  };
  agent_breakdown: Array<{
    agent_code: string;
    agent_name: string;
    quality_pct: number;
    calls_handled: number;
    weak_areas: string[];
    coaching_needed: boolean;
    risk_score: number;
  }>;
  last_updated: string;
}

// Helpers

function qualityColor(score: number): string {
  if (score >= 80) return "text-green-600";
  if (score >= 70) return "text-yellow-600";
  return "text-red-600";
}

const PROCESSES = ["INBOUND", "OUTBOUND", "CHAT", "EMAIL", "BACKOFFICE"] as const;
type Process = (typeof PROCESSES)[number];

type StatCardProps = { title: string; value: number | string; icon: React.ReactNode; tone: string; suffix?: string; sub?: string };
function StatCard({ title, value, icon, tone, suffix = "", sub }: StatCardProps) {
  return (
    <div className="glass-card stat-card rounded-3xl p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-slate-500">{title}</p>
          <p className="mt-2 text-3xl font-black tracking-tight text-slate-950">{value}{suffix}</p>
          {sub && <p className="mt-1 text-xs font-semibold text-slate-400">{sub}</p>}
        </div>
        <div className={`rounded-2xl p-3 ${tone}`}>{icon}</div>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <Card className="p-6"><div className="animate-pulse space-y-4"><div className="h-6 bg-slate-200 rounded w-1/3" /><div className="h-40 bg-slate-200 rounded" /></div></Card>
  );
}

// Main Component

export default function ManagerQualityDashboard() {
  const { user } = useAuth();
  const [process, setProcess] = useState<Process>("INBOUND");

  const { data, isLoading, error } = useQuery<ManagerQualityData>({
    queryKey: ["manager-team-quality", process],
    queryFn: () =>
      hrmsApi
        .get(`/api/manager/team-quality?daysBack=7&process=${process}`)
        .then((r) => r.data),
    enabled: !!user,
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

  const summary = data?.team_summary;
  const agents = data?.agent_breakdown ?? [];

  // Recharts distribution data
  const distData = summary
    ? [
        { name: "Excellent", count: summary.quality_distribution.excellent, fill: "#16a34a" },
        { name: "Good", count: summary.quality_distribution.good, fill: "#2563eb" },
        { name: "Average", count: summary.quality_distribution.average, fill: "#ca8a04" },
        { name: "Poor", count: summary.quality_distribution.poor, fill: "#dc2626" },
      ]
    : [];

  return (
    <DashboardLayout>
      <div className="space-y-6 p-4 md:p-8">
        {/* Page Header */}
        <div className="mb-2">
          <h1 className="text-3xl font-bold text-slate-900">Team Quality Dashboard</h1>
          <p className="text-slate-500 mt-1 text-sm">Monitor your team's call quality, coaching needs and performance distribution</p>
        </div>

        {/* Process Selector */}
        <div className="flex flex-wrap gap-2">
          {PROCESSES.map((p) => (
            <button
              key={p}
              onClick={() => setProcess(p)}
              className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-colors border ${
                process === p
                  ? "bg-blue-600 text-white border-blue-600 shadow"
                  : "bg-white text-slate-600 border-slate-200 hover:border-blue-400 hover:text-blue-600"
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        {/* Loading / Error */}
        {isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4"><LoadingSkeleton /><LoadingSkeleton /><LoadingSkeleton /></div>
        )}

        {!isLoading && error && (
          <Card className="p-6 border-red-200 bg-red-50">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-semibold text-red-900">Failed to load team quality data</p>
                <p className="text-sm text-red-700 mt-0.5">
                  Please refresh or try a different process.
                </p>
              </div>
            </div>
          </Card>
        )}

        {!isLoading && !error && data && (
          <>
            {/* Stat Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <StatCard
                title="Avg Quality"
                value={summary!.avg_quality.toFixed(1)}
                suffix="%"
                icon={<TrendingUp className="h-5 w-5" />}
                tone={
                  summary!.avg_quality >= 80
                    ? "bg-green-100 text-green-600"
                    : summary!.avg_quality >= 70
                    ? "bg-yellow-100 text-yellow-600"
                    : "bg-red-100 text-red-600"
                }
                sub={
                  summary!.avg_quality >= 80
                    ? "Excellent"
                    : summary!.avg_quality >= 70
                    ? "Needs attention"
                    : "Critical"
                }
              />
              <StatCard
                title="Agent Count"
                value={summary!.agent_count}
                icon={<Users className="h-5 w-5" />}
                tone="bg-blue-100 text-blue-600"
                sub={`${process} process`}
              />
              <StatCard
                title="Calls Handled"
                value={summary!.calls_handled.toLocaleString()}
                icon={<Phone className="h-5 w-5" />}
                tone="bg-indigo-100 text-indigo-600"
                sub="Last 7 days"
              />
            </div>

            {/* Distribution Chart + Performers */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Bar Chart */}
              <Card className="p-6">
                <h2 className="text-base font-bold text-slate-800 mb-4">Quality Distribution</h2>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={distData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip
                      contentStyle={{ fontSize: 12, borderRadius: 8 }}
                      formatter={(v: number) => [v, "Agents"]}
                    />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                      {distData.map((entry, index) => (
                        <Cell key={index} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Card>

              {/* Top / Bottom Performers */}
              <div className="flex flex-col gap-4">
                {/* Top Performer */}
                <Card className="p-5 border-green-100 bg-green-50 flex-1">
                  <p className="text-xs font-bold text-green-600 uppercase tracking-wide mb-2">
                    Top Performer
                  </p>
                  <p className="text-lg font-black text-slate-900">
                    {summary!.top_performer.agent_name}
                  </p>
                  <p className="text-sm text-slate-500">{summary!.top_performer.agent_code}</p>
                  <p
                    className={`text-2xl font-black mt-2 ${qualityColor(
                      summary!.top_performer.quality
                    )}`}
                  >
                    {summary!.top_performer.quality.toFixed(1)}%
                  </p>
                </Card>

                {/* Bottom Performer */}
                <Card className="p-5 border-red-100 bg-red-50 flex-1">
                  <p className="text-xs font-bold text-red-600 uppercase tracking-wide mb-2">
                    Needs Coaching
                  </p>
                  <p className="text-lg font-black text-slate-900">
                    {summary!.bottom_performer.agent_name}
                  </p>
                  <p className="text-sm text-slate-500">{summary!.bottom_performer.agent_code}</p>
                  <p
                    className={`text-2xl font-black mt-2 ${qualityColor(
                      summary!.bottom_performer.quality
                    )}`}
                  >
                    {summary!.bottom_performer.quality.toFixed(1)}%
                  </p>
                </Card>
              </div>
            </div>

            {/* Agent Breakdown Table */}
            <Card className="p-0 overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100">
                <h2 className="text-base font-bold text-slate-800">Agent Breakdown</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50 text-left">
                      <th className="px-4 py-3 font-semibold text-slate-500">Agent</th>
                      <th className="px-4 py-3 font-semibold text-slate-500">Quality %</th>
                      <th className="px-4 py-3 font-semibold text-slate-500">Calls</th>
                      <th className="px-4 py-3 font-semibold text-slate-500">Coaching</th>
                      <th className="px-4 py-3 font-semibold text-slate-500">Risk Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agents.length === 0 && (
                      <tr>
                        <td
                          colSpan={5}
                          className="px-4 py-8 text-center text-slate-400"
                        >
                          No agents found for this process.
                        </td>
                      </tr>
                    )}
                    {agents.map((agent) => (
                      <tr
                        key={agent.agent_code}
                        className="border-b border-slate-50 hover:bg-slate-50 transition-colors"
                      >
                        <td className="px-4 py-3">
                          <p className="font-semibold text-slate-800">{agent.agent_name}</p>
                          <p className="text-xs text-slate-400">{agent.agent_code}</p>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`font-bold text-base ${qualityColor(agent.quality_pct)}`}
                          >
                            {agent.quality_pct.toFixed(1)}%
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{agent.calls_handled}</td>
                        <td className="px-4 py-3">
                          {agent.coaching_needed ? (
                            <Badge className="bg-orange-100 text-orange-700 border-orange-200 text-xs font-semibold">
                              Required
                            </Badge>
                          ) : (
                            <span className="text-slate-400 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`font-bold ${
                              agent.risk_score >= 70
                                ? "text-red-600"
                                : agent.risk_score >= 40
                                ? "text-yellow-600"
                                : "text-green-600"
                            }`}
                          >
                            {agent.risk_score}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {data.last_updated && (
                <div className="px-6 py-2 border-t border-slate-100 text-xs text-slate-400 text-right">
                  Last updated: {formatIST(data.last_updated)}
                </div>
              )}
            </Card>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
