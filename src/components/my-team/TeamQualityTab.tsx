import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertCircle, Star, Phone, Users, TrendingUp, Award, TrendingDown } from "lucide-react";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Cell } from "recharts";

interface AgentBreakdown {
  agent_code: string;
  agent_name: string;
  quality_pct: number;
  calls_handled: number;
  weak_areas?: string[];
  coaching_needed?: boolean;
  risk_score?: number;
}

interface QualityDist {
  excellent: number;
  good: number;
  average: number;
  poor: number;
}

interface QualityData {
  team_summary: {
    avg_quality: number;
    agent_count: number;
    calls_handled: number;
    top_performer?: { agent_code: string; agent_name: string; quality: number };
    bottom_performer?: { agent_code: string; agent_name: string; quality: number };
    quality_distribution: QualityDist;
  };
  agent_breakdown: AgentBreakdown[];
}

function qualityBadgeClass(score: number) {
  if (score >= 80) return "bg-emerald-100 text-emerald-700";
  if (score >= 70) return "bg-amber-100 text-amber-700";
  return "bg-rose-100 text-rose-700";
}

function qualityTextColor(score: number) {
  if (score >= 80) return "text-emerald-600";
  if (score >= 70) return "text-amber-600";
  return "text-rose-600";
}

// ── Quality gauge arc (simplified) ───────────────────────────
function QualityGauge({ score }: { score: number }) {
  const color = score >= 80 ? "#22c55e" : score >= 70 ? "#f59e0b" : "#ef4444";
  const pct = Math.min(100, score);
  return (
    <div className="flex flex-col items-center justify-center p-4">
      <div className="relative flex h-24 w-24 items-center justify-center">
        <svg viewBox="0 0 36 36" className="h-24 w-24 -rotate-90">
          <circle cx="18" cy="18" r="15.9" fill="none" stroke="#f1f5f9" strokeWidth="3" />
          <circle
            cx="18" cy="18" r="15.9" fill="none"
            stroke={color} strokeWidth="3"
            strokeDasharray={`${pct} ${100 - pct}`}
            strokeLinecap="round"
            className="transition-all duration-700"
          />
        </svg>
        <span className={`absolute text-2xl font-bold ${qualityTextColor(score)}`}>{score}%</span>
      </div>
      <p className="text-xs font-medium text-slate-500 mt-1">Avg Quality</p>
    </div>
  );
}

const DIST_CONFIG = {
  excellent: { label: "Excellent", color: "#22c55e" },
  good:      { label: "Good",      color: "#84cc16" },
  average:   { label: "Average",   color: "#f59e0b" },
  poor:      { label: "Poor",      color: "#ef4444" },
};

const chartConfig = { count: { label: "Agents", color: "#6366f1" } };

export default function TeamQualityTab() {
  const { data, isLoading } = useQuery({
    queryKey: ["manager", "team-quality"],
    queryFn: () => hrmsApi.get<any>("/api/manager/team-quality"),
    staleTime: 60_000,
  });

  const qd = (data as any)?.data as QualityData | undefined;
  const summary = qd?.team_summary;
  const agents = qd?.agent_breakdown ?? [];

  const distData = summary
    ? (Object.entries(DIST_CONFIG) as [keyof QualityDist, typeof DIST_CONFIG[keyof typeof DIST_CONFIG]][]).map(
        ([key, cfg]) => ({ name: cfg.label, count: summary.quality_distribution[key] ?? 0, fill: cfg.color })
      )
    : [];

  if (isLoading) return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
      </div>
      <Skeleton className="h-40 rounded-2xl" />
    </div>
  );

  if (!qd || !summary) return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white py-16">
      <Star className="h-8 w-8 text-slate-300 mb-2" />
      <p className="text-sm text-slate-500">No quality data available for your team.</p>
      <p className="text-xs text-slate-400 mt-1">Data comes from the quality audit system</p>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {/* Gauge card */}
        <div className="flex items-center justify-center rounded-2xl border border-slate-200 bg-white shadow-sm">
          <QualityGauge score={summary.avg_quality ?? 0} />
        </div>

        {/* Stat cards */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm flex flex-col justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            <Users className="h-3.5 w-3.5" />Agents Monitored
          </div>
          <div className="mt-2 text-3xl font-bold text-slate-900">{summary.agent_count}</div>
          {summary.top_performer && (
            <div className="mt-2 flex items-center gap-1.5 rounded-xl bg-emerald-50 px-3 py-1.5">
              <Award className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
              <span className="text-xs font-medium text-emerald-700 truncate">
                Top: {summary.top_performer.agent_name} ({summary.top_performer.quality}%)
              </span>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm flex flex-col justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            <Phone className="h-3.5 w-3.5" />Calls Handled
          </div>
          <div className="mt-2 text-3xl font-bold text-slate-900">
            {summary.calls_handled?.toLocaleString("en-IN") ?? "—"}
          </div>
          {summary.bottom_performer && (
            <div className="mt-2 flex items-center gap-1.5 rounded-xl bg-rose-50 px-3 py-1.5">
              <TrendingDown className="h-3.5 w-3.5 text-rose-600 shrink-0" />
              <span className="text-xs font-medium text-rose-700 truncate">
                Low: {summary.bottom_performer.agent_name} ({summary.bottom_performer.quality}%)
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Distribution chart */}
      {distData.some((d) => d.count > 0) && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-4">Quality Distribution</p>
          <ChartContainer config={chartConfig} className="h-44 w-full">
            <BarChart data={distData} margin={{ top: 4, right: 4, bottom: 4, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={40}>
                {distData.map((d, i) => <Cell key={i} fill={d.fill} />)}
              </Bar>
            </BarChart>
          </ChartContainer>
        </div>
      )}

      {/* Agent table */}
      {agents.length > 0 && (
        <div className="overflow-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 hover:bg-slate-50">
                <TableHead className="font-semibold text-slate-600">Agent</TableHead>
                <TableHead className="font-semibold text-slate-600">Quality</TableHead>
                <TableHead className="font-semibold text-slate-600 text-center">Calls</TableHead>
                <TableHead className="font-semibold text-slate-600">Coaching</TableHead>
                <TableHead className="font-semibold text-slate-600">Weak Areas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agents.map((a) => (
                <TableRow key={a.agent_code} className="hover:bg-slate-50/60 transition-colors">
                  <TableCell>
                    <div className="font-medium text-slate-900">{a.agent_name}</div>
                    <div className="text-xs text-slate-400">{a.agent_code}</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="relative h-2 w-20 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="absolute inset-y-0 left-0 rounded-full"
                          style={{
                            width: `${Math.min(100, a.quality_pct)}%`,
                            background: a.quality_pct >= 80 ? "#22c55e" : a.quality_pct >= 70 ? "#f59e0b" : "#ef4444",
                          }}
                        />
                      </div>
                      <span className={`text-sm font-bold ${qualityTextColor(a.quality_pct)}`}>
                        {a.quality_pct}%
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-center font-medium text-slate-700">{a.calls_handled}</TableCell>
                  <TableCell>
                    {a.coaching_needed ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                        <AlertCircle className="h-3 w-3" />Needed
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-slate-500">
                    {a.weak_areas?.length
                      ? a.weak_areas.map((w, i) => (
                          <span key={i} className="mr-1 inline-block rounded-md bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{w}</span>
                        ))
                      : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
