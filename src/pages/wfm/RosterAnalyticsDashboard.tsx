/**
 * Roster Analytics Dashboard — Phase 2
 *
 * Design System: MAS HRMS Frozen Patterns
 * - GlassCard containers with backdrop-blur
 * - Gradient headers (teal for attendance domain)
 * - Tone color system for KPIs
 * - Bento grid layout (density 8/10)
 * - Responsive: mobile-first grid
 *
 * Features:
 * 1. Weekly Shrinkage Intelligence
 * 2. Quality-Adherence Correlation
 * 3. Cost of Non-Adherence
 * 4. Shrinkage Forecast
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  TrendingDown,
  TrendingUp,
  DollarSign,
  AlertTriangle,
  BarChart3,
  Calendar,
  Users,
  Target,
  Lightbulb,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  Zap,
  LineChart,
} from "lucide-react";

const ALL = "__all__";

// ── Types ────────────────────────────────────────────────────────────────────

interface ShrinkageIntelligence {
  branchId: string;
  branchName: string;
  weekStart: string;
  weekEnd: string;
  breakdown: {
    plannedLeave: { count: number; pct: number };
    unplannedAbsence: { count: number; pct: number };
    lateArrival: { count: number; pct: number };
    earlyDeparture: { count: number; pct: number };
    training: { count: number; pct: number };
    total: { count: number; pct: number };
  };
  budgetPct: number;
  varianceFromBudget: number;
  trendVsPrevWeek: number;
  costImpact: {
    hoursLost: number;
    estimatedCostINR: number;
    productivityLossPct: number;
  };
  dayOfWeekPattern: Array<{ day: string; shrinkagePct: number; isHighRisk: boolean }>;
  managerRanking: Array<{ managerId: string; managerName: string; teamSize: number; shrinkagePct: number; unplannedCount: number; rank: number }>;
  processRanking: Array<{ processId: string; processName: string; planned: number; shrinkagePct: number }>;
}

interface QualityCorrelation {
  period: string;
  correlation: {
    coefficient: number;
    interpretation: string;
    insight: string;
  };
  segments: {
    highAdherence: { count: number; avgQuality: number; adherenceRange: string };
    mediumAdherence: { count: number; avgQuality: number; adherenceRange: string };
    lowAdherence: { count: number; avgQuality: number; adherenceRange: string };
  };
  outliers: Array<{
    employeeId: string;
    employeeCode: string;
    employeeName: string;
    adherencePct: number;
    qualityPct: number;
    category: string;
  }>;
  actionableInsights: string[];
}

interface CostImpact {
  period: string;
  metrics: {
    totalPlannedHours: number;
    actualWorkedHours: number;
    hoursLost: number;
    avgHourlyCostINR: number;
    directCostLossINR: number;
    productivityImpactPct: number;
  };
  breakdown: {
    unplannedAbsenceCost: number;
    lateCost: number;
    earlyDepartureCost: number;
    incompleteShiftCost: number;
  };
  projectedAnnual: {
    currentTrend: number;
    ifImproved5Pct: number;
    potentialSavings: number;
  };
  benchmarks: {
    industryAvgShrinkage: number;
    currentShrinkage: number;
    gapPct: number;
  };
}

interface Forecast {
  branchId: string;
  nextWeek: {
    weekStart: string;
    predictedShrinkagePct: number;
    confidence: string;
    riskDays: Array<{ date: string; day: string; predictedPct: number; reason: string }>;
  };
  patterns: {
    mondayEffect: number;
    fridayEffect: number;
    monthEndEffect: number;
  };
  recommendations: string[];
}

// ── Design Tokens (MAS HRMS Frozen) ──────────────────────────────────────────

const TONE = {
  blue: { iconBg: "#edf4ff", value: "#0b63e5", border: "#dce8fb" },
  green: { iconBg: "#eaf8ef", value: "#15803d", border: "#d7f0df" },
  amber: { iconBg: "#fff4e8", value: "#ea580c", border: "#fee3c5" },
  red: { iconBg: "#fff0f1", value: "#dc2626", border: "#ffdadd" },
  violet: { iconBg: "#f3efff", value: "#6d28d9", border: "#e6ddff" },
  teal: { iconBg: "#f0fdfa", value: "#0f766e", border: "#99f6e4" },
  slate: { iconBg: "#f1f4f8", value: "#0b1f44", border: "#e3e9f2" },
};

// ── Utility ──────────────────────────────────────────────────────────────────

function formatCurrency(n: number): string {
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${n}`;
}

function getWeekStart(): string {
  const d = new Date();
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d.toISOString().slice(0, 10);
}

function getPreviousMonth(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ── Subcomponents ────────────────────────────────────────────────────────────

function GlassCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm hover:shadow-md transition-all duration-200 ${className}`}>
      {children}
    </div>
  );
}

function MetricTile({
  label,
  value,
  helper,
  tone = "slate",
  trend,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  helper?: string;
  tone?: keyof typeof TONE;
  trend?: number;
  icon: React.ElementType;
}) {
  const colors = TONE[tone];
  return (
    <GlassCard className="p-4">
      <div className="flex items-start justify-between">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-xl"
          style={{ backgroundColor: colors.iconBg }}
        >
          <Icon className="h-5 w-5" style={{ color: colors.value }} />
        </div>
        {trend !== undefined && (
          <div className={`flex items-center gap-1 text-xs font-medium ${trend >= 0 ? "text-red-600" : "text-emerald-600"}`}>
            {trend >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {Math.abs(trend)}%
          </div>
        )}
      </div>
      <div className="mt-3">
        <p className="text-2xl font-bold" style={{ color: colors.value }}>{value}</p>
        <p className="text-sm font-medium text-slate-700">{label}</p>
        {helper && <p className="text-xs text-slate-500 mt-0.5">{helper}</p>}
      </div>
    </GlassCard>
  );
}

function ScoreRing({ score, size = 80, strokeWidth = 8 }: { score: number; size?: number; strokeWidth?: number }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.abs(score) / 100) * circumference;
  const color = score > 0.4 ? "#15803d" : score > 0 ? "#ea580c" : "#dc2626";

  return (
    <div className="relative">
      <svg width={size} height={size} className="transform -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#e5e7eb" strokeWidth={strokeWidth} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-xl font-bold" style={{ color }}>{score.toFixed(2)}</span>
      </div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function RosterAnalyticsDashboard() {
  const [branchId, setBranchId] = useState(ALL);
  const weekStart = getWeekStart();
  const period = getPreviousMonth();

  const { data: branchData } = useQuery({
    queryKey: ["roster-analytics", "branches"],
    queryFn: () => hrmsApi.get<{ data: Array<{ id: string; branch_name: string }> }>("/api/org/branches"),
  });

  const { data: shrinkageData, isLoading: shrinkageLoading } = useQuery({
    queryKey: ["roster-analytics", "shrinkage", branchId, weekStart],
    queryFn: () =>
      hrmsApi.get<ShrinkageIntelligence>(
        `/api/roster-analytics/shrinkage-intelligence/${branchId}?weekStart=${weekStart}`
      ),
    enabled: branchId !== ALL,
  });

  const { data: qualityData, isLoading: qualityLoading } = useQuery({
    queryKey: ["roster-analytics", "quality", branchId, period],
    queryFn: () => {
      const params = new URLSearchParams({ period });
      if (branchId !== ALL) params.set("branchId", branchId);
      return hrmsApi.get<QualityCorrelation>(`/api/roster-analytics/quality-correlation?${params}`);
    },
  });

  const { data: costData, isLoading: costLoading } = useQuery({
    queryKey: ["roster-analytics", "cost", branchId, period],
    queryFn: () => {
      const params = new URLSearchParams({ period });
      if (branchId !== ALL) params.set("branchId", branchId);
      return hrmsApi.get<CostImpact>(`/api/roster-analytics/cost-impact?${params}`);
    },
  });

  const { data: forecastData, isLoading: forecastLoading } = useQuery({
    queryKey: ["roster-analytics", "forecast", branchId],
    queryFn: () => hrmsApi.get<Forecast>(`/api/roster-analytics/forecast/${branchId}`),
    enabled: branchId !== ALL,
  });

  return (
    <DashboardLayout>
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-teal-50/30 to-cyan-50/20 p-4 sm:p-6">
        {/* Header with gradient (teal for attendance domain) */}
        <div className="mb-6 rounded-2xl bg-gradient-to-r from-teal-600 via-cyan-600 to-blue-600 p-6 text-white shadow-lg shadow-teal-500/20">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/20 backdrop-blur">
                <BarChart3 className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">Roster Analytics Intelligence</h1>
                <p className="text-teal-100 text-sm">Shrinkage patterns, quality correlation, cost impact, and forecasting</p>
              </div>
            </div>
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger className="w-48 bg-white/10 border-white/20 text-white">
                <SelectValue placeholder="Select Branch" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All Branches</SelectItem>
                {(branchData?.data ?? []).map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.branch_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Tabs defaultValue="shrinkage" className="space-y-4">
          <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4 lg:w-[600px] bg-white/80 backdrop-blur">
            <TabsTrigger value="shrinkage" className="flex items-center gap-2 data-[state=active]:bg-teal-500 data-[state=active]:text-white">
              <BarChart3 className="h-4 w-4" /> Shrinkage
            </TabsTrigger>
            <TabsTrigger value="quality" className="flex items-center gap-2 data-[state=active]:bg-violet-500 data-[state=active]:text-white">
              <Target className="h-4 w-4" /> Quality
            </TabsTrigger>
            <TabsTrigger value="cost" className="flex items-center gap-2 data-[state=active]:bg-red-500 data-[state=active]:text-white">
              <DollarSign className="h-4 w-4" /> Cost
            </TabsTrigger>
            <TabsTrigger value="forecast" className="flex items-center gap-2 data-[state=active]:bg-blue-500 data-[state=active]:text-white">
              <LineChart className="h-4 w-4" /> Forecast
            </TabsTrigger>
          </TabsList>

          {/* Shrinkage Tab */}
          <TabsContent value="shrinkage" className="space-y-4">
            {branchId === ALL ? (
              <GlassCard className="py-12 text-center text-slate-500">
                <Calendar className="h-12 w-12 mx-auto mb-3 text-slate-300" />
                <p className="font-medium">Select a branch to view shrinkage intelligence</p>
              </GlassCard>
            ) : shrinkageLoading ? (
              <GlassCard className="py-12 text-center">
                <div className="animate-pulse">Loading shrinkage data...</div>
              </GlassCard>
            ) : shrinkageData ? (
              <>
                {/* KPI Tiles */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                  <MetricTile
                    label="Total Shrinkage"
                    value={`${shrinkageData.breakdown.total.pct}%`}
                    helper={`Budget: ${shrinkageData.budgetPct}%`}
                    tone={shrinkageData.varianceFromBudget > 0 ? "red" : "green"}
                    trend={shrinkageData.varianceFromBudget}
                    icon={TrendingDown}
                  />
                  <MetricTile
                    label="Hours Lost"
                    value={shrinkageData.costImpact.hoursLost}
                    helper="This week"
                    tone="amber"
                    icon={Clock}
                  />
                  <MetricTile
                    label="Cost Impact"
                    value={formatCurrency(shrinkageData.costImpact.estimatedCostINR)}
                    helper="Estimated loss"
                    tone="red"
                    icon={DollarSign}
                  />
                  <MetricTile
                    label="Week Trend"
                    value={`${shrinkageData.trendVsPrevWeek > 0 ? "+" : ""}${shrinkageData.trendVsPrevWeek}%`}
                    helper="vs last week"
                    tone={shrinkageData.trendVsPrevWeek > 0 ? "red" : "green"}
                    icon={shrinkageData.trendVsPrevWeek > 0 ? TrendingUp : TrendingDown}
                  />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Breakdown */}
                  <GlassCard>
                    <div className="p-4 border-b border-slate-100">
                      <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                        <BarChart3 className="h-5 w-5 text-teal-600" /> Shrinkage Breakdown
                      </h3>
                    </div>
                    <div className="p-4 space-y-4">
                      {[
                        { label: "Unplanned Absence", data: shrinkageData.breakdown.unplannedAbsence, color: "bg-red-500", colorClass: "text-red-600" },
                        { label: "Planned Leave", data: shrinkageData.breakdown.plannedLeave, color: "bg-blue-500", colorClass: "text-blue-600" },
                        { label: "Late Arrival", data: shrinkageData.breakdown.lateArrival, color: "bg-amber-500", colorClass: "text-amber-600" },
                        { label: "Early Departure", data: shrinkageData.breakdown.earlyDeparture, color: "bg-orange-500", colorClass: "text-orange-600" },
                        { label: "Training", data: shrinkageData.breakdown.training, color: "bg-purple-500", colorClass: "text-purple-600" },
                      ].map((item) => (
                        <div key={item.label} className="space-y-1">
                          <div className="flex justify-between text-sm">
                            <span className="text-slate-600">{item.label}</span>
                            <span className={`font-bold ${item.colorClass}`}>{item.data.pct}% ({item.data.count})</span>
                          </div>
                          <Progress value={item.data.pct * 5} className={`h-2 [&>div]:${item.color}`} />
                        </div>
                      ))}
                    </div>
                  </GlassCard>

                  {/* Day Pattern */}
                  <GlassCard>
                    <div className="p-4 border-b border-slate-100">
                      <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                        <Calendar className="h-5 w-5 text-blue-600" /> Day-of-Week Pattern
                      </h3>
                    </div>
                    <div className="p-4">
                      <div className="flex items-end justify-between h-40 gap-2">
                        {shrinkageData.dayOfWeekPattern.map((d) => (
                          <div key={d.day} className="flex-1 flex flex-col items-center">
                            <div
                              className={`w-full rounded-t-lg transition-all ${d.isHighRisk ? "bg-gradient-to-t from-red-600 to-red-400" : "bg-gradient-to-t from-teal-600 to-teal-400"}`}
                              style={{ height: `${Math.max(d.shrinkagePct * 4, 8)}px` }}
                            />
                            <span className="text-xs mt-2 text-slate-600 font-medium">{d.day.slice(0, 3)}</span>
                            <span className={`text-xs font-bold ${d.isHighRisk ? "text-red-600" : "text-teal-700"}`}>
                              {d.shrinkagePct}%
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </GlassCard>
                </div>

                {/* Manager Ranking */}
                <GlassCard>
                  <div className="p-4 border-b border-slate-100">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100">
                        <Users className="h-5 w-5 text-violet-600" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-slate-800">Manager Shrinkage Ranking</h3>
                        <p className="text-xs text-slate-500">Highest shrinkage first — target for intervention</p>
                      </div>
                    </div>
                  </div>
                  <div className="p-4 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 rounded-lg">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Rank</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Manager</th>
                          <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase">Team Days</th>
                          <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase">Unplanned</th>
                          <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase">Shrinkage</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {shrinkageData.managerRanking.map((m) => (
                          <tr key={m.managerId} className="hover:bg-slate-50 transition-colors">
                            <td className="px-4 py-3">
                              <Badge variant={m.rank <= 3 ? "destructive" : "secondary"} className="font-bold">#{m.rank}</Badge>
                            </td>
                            <td className="px-4 py-3 font-semibold text-slate-800">{m.managerName}</td>
                            <td className="px-4 py-3 text-center text-slate-600">{m.teamSize}</td>
                            <td className="px-4 py-3 text-center">
                              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-red-100 text-red-700 text-xs font-bold">
                                {m.unplannedCount}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <Badge variant={m.shrinkagePct > 15 ? "destructive" : m.shrinkagePct > 10 ? "secondary" : "default"}>
                                {m.shrinkagePct}%
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </GlassCard>
              </>
            ) : null}
          </TabsContent>

          {/* Quality Tab */}
          <TabsContent value="quality" className="space-y-4">
            {qualityLoading ? (
              <GlassCard className="py-12 text-center">
                <div className="animate-pulse">Loading quality data...</div>
              </GlassCard>
            ) : qualityData ? (
              <>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <GlassCard className="lg:col-span-2">
                    <div className="p-4 border-b border-slate-100">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100">
                          <Target className="h-5 w-5 text-violet-600" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-slate-800">Quality-Adherence Correlation</h3>
                          <p className="text-xs text-slate-500">Statistical relationship between attendance and quality</p>
                        </div>
                      </div>
                    </div>
                    <div className="p-6">
                      <div className="flex items-center gap-8">
                        <ScoreRing score={qualityData.correlation.coefficient * 100} size={100} strokeWidth={10} />
                        <div className="flex-1">
                          <Badge variant="outline" className="mb-2 text-xs">
                            {qualityData.correlation.interpretation.replace(/_/g, " ")}
                          </Badge>
                          <p className="text-sm text-slate-600">{qualityData.correlation.insight}</p>
                        </div>
                      </div>
                    </div>
                  </GlassCard>

                  <GlassCard>
                    <div className="p-4 border-b border-slate-100">
                      <h3 className="font-semibold text-slate-800">Segment Analysis</h3>
                    </div>
                    <div className="p-4 space-y-4">
                      {Object.entries(qualityData.segments).map(([key, seg]) => {
                        const tone = key === "highAdherence" ? "green" : key === "mediumAdherence" ? "amber" : "red";
                        const colors = TONE[tone];
                        return (
                          <div key={key} className="flex items-center justify-between p-3 rounded-xl" style={{ backgroundColor: colors.iconBg }}>
                            <div>
                              <span className="font-semibold text-slate-800 capitalize text-sm">{key.replace(/([A-Z])/g, " $1")}</span>
                              <span className="text-slate-500 text-xs ml-1">({seg.adherenceRange})</span>
                            </div>
                            <div className="text-right">
                              <span className="font-bold text-lg" style={{ color: colors.value }}>{seg.avgQuality}%</span>
                              <span className="text-slate-400 text-xs ml-1">n={seg.count}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </GlassCard>
                </div>

                {qualityData.actionableInsights.length > 0 && (
                  <GlassCard className="border-amber-200 bg-gradient-to-br from-amber-50/80 to-white">
                    <div className="p-4 border-b border-amber-100">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100">
                          <Lightbulb className="h-5 w-5 text-amber-600" />
                        </div>
                        <h3 className="font-semibold text-amber-800">Actionable Insights</h3>
                      </div>
                    </div>
                    <div className="p-4">
                      <ul className="space-y-2">
                        {qualityData.actionableInsights.map((insight, i) => (
                          <li key={i} className="flex items-start gap-3 text-sm text-amber-900">
                            <Zap className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
                            {insight}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </GlassCard>
                )}

                {qualityData.outliers.length > 0 && (
                  <GlassCard>
                    <div className="p-4 border-b border-slate-100">
                      <h3 className="font-semibold text-slate-800">Notable Outliers</h3>
                      <p className="text-xs text-slate-500">Employees with unusual quality/adherence patterns</p>
                    </div>
                    <div className="p-4 overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Employee</th>
                            <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase">Adherence</th>
                            <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase">Quality</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Category</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {qualityData.outliers.slice(0, 10).map((o) => (
                            <tr key={o.employeeId} className="hover:bg-slate-50">
                              <td className="px-4 py-3">
                                <div className="font-semibold text-slate-800">{o.employeeName}</div>
                                <div className="text-xs text-slate-500">{o.employeeCode}</div>
                              </td>
                              <td className="px-4 py-3 text-center font-medium">{o.adherencePct}%</td>
                              <td className="px-4 py-3 text-center font-medium">{o.qualityPct}%</td>
                              <td className="px-4 py-3">
                                <Badge variant={
                                  o.category === "BOTH_LOW" ? "destructive" :
                                  o.category === "BOTH_HIGH" ? "default" : "secondary"
                                }>
                                  {o.category.replace(/_/g, " ")}
                                </Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </GlassCard>
                )}
              </>
            ) : null}
          </TabsContent>

          {/* Cost Tab */}
          <TabsContent value="cost" className="space-y-4">
            {costLoading ? (
              <GlassCard className="py-12 text-center">
                <div className="animate-pulse">Loading cost data...</div>
              </GlassCard>
            ) : costData ? (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                  <MetricTile
                    label="Direct Cost Loss"
                    value={formatCurrency(costData.metrics.directCostLossINR)}
                    helper={period}
                    tone="red"
                    icon={DollarSign}
                  />
                  <MetricTile
                    label="Hours Lost"
                    value={costData.metrics.hoursLost}
                    helper={`of ${costData.metrics.totalPlannedHours} planned`}
                    tone="amber"
                    icon={Clock}
                  />
                  <MetricTile
                    label="Productivity Impact"
                    value={`${costData.metrics.productivityImpactPct}%`}
                    helper="Capacity lost"
                    tone="amber"
                    icon={TrendingDown}
                  />
                  <MetricTile
                    label="Potential Savings"
                    value={formatCurrency(costData.projectedAnnual.potentialSavings)}
                    helper="if improved 5%/yr"
                    tone="green"
                    icon={TrendingUp}
                  />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <GlassCard>
                    <div className="p-4 border-b border-slate-100">
                      <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                        <DollarSign className="h-5 w-5 text-red-600" /> Cost Breakdown
                      </h3>
                    </div>
                    <div className="p-4 space-y-4">
                      {[
                        { label: "Unplanned Absence", cost: costData.breakdown.unplannedAbsenceCost, color: "bg-red-500", colorClass: "text-red-600" },
                        { label: "Late Arrival", cost: costData.breakdown.lateCost, color: "bg-amber-500", colorClass: "text-amber-600" },
                        { label: "Early Departure", cost: costData.breakdown.earlyDepartureCost, color: "bg-orange-500", colorClass: "text-orange-600" },
                        { label: "Incomplete Shift", cost: costData.breakdown.incompleteShiftCost, color: "bg-purple-500", colorClass: "text-purple-600" },
                      ].map((item) => {
                        const pct = costData.metrics.directCostLossINR > 0
                          ? (item.cost / costData.metrics.directCostLossINR) * 100
                          : 0;
                        return (
                          <div key={item.label} className="space-y-1">
                            <div className="flex justify-between text-sm">
                              <span className="text-slate-600">{item.label}</span>
                              <span className={`font-bold ${item.colorClass}`}>{formatCurrency(item.cost)}</span>
                            </div>
                            <Progress value={pct} className={`h-2 [&>div]:${item.color}`} />
                          </div>
                        );
                      })}
                    </div>
                  </GlassCard>

                  <GlassCard>
                    <div className="p-4 border-b border-slate-100">
                      <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                        <LineChart className="h-5 w-5 text-blue-600" /> Annual Projection
                      </h3>
                    </div>
                    <div className="p-4 space-y-6">
                      <div className="flex items-center justify-between p-3 rounded-xl bg-red-50">
                        <span className="text-slate-700 font-medium">Current Trend</span>
                        <span className="text-2xl font-bold text-red-600">
                          {formatCurrency(costData.projectedAnnual.currentTrend)}/yr
                        </span>
                      </div>
                      <div className="flex items-center justify-between p-3 rounded-xl bg-amber-50">
                        <span className="text-slate-700 font-medium">If Improved 5%</span>
                        <span className="text-2xl font-bold text-amber-600">
                          {formatCurrency(costData.projectedAnnual.ifImproved5Pct)}/yr
                        </span>
                      </div>
                      <div className="flex items-center justify-between p-3 rounded-xl bg-green-50 border border-green-200">
                        <span className="text-green-800 font-semibold">Potential Savings</span>
                        <span className="text-2xl font-bold text-green-600">
                          {formatCurrency(costData.projectedAnnual.potentialSavings)}/yr
                        </span>
                      </div>
                    </div>
                  </GlassCard>
                </div>

                <GlassCard>
                  <div className="p-4 border-b border-slate-100">
                    <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                      <Target className="h-5 w-5 text-indigo-600" /> Industry Benchmark
                    </h3>
                  </div>
                  <div className="p-6">
                    <div className="flex flex-col sm:flex-row items-center gap-8">
                      <div className="text-center p-4 rounded-xl bg-slate-50 flex-1">
                        <div className="text-4xl font-bold text-slate-800">{costData.benchmarks.currentShrinkage}%</div>
                        <div className="text-sm text-slate-500 mt-1">Your Shrinkage</div>
                      </div>
                      <div className="text-slate-300 text-3xl font-light">vs</div>
                      <div className="text-center p-4 rounded-xl bg-slate-50 flex-1">
                        <div className="text-4xl font-bold text-slate-400">{costData.benchmarks.industryAvgShrinkage}%</div>
                        <div className="text-sm text-slate-500 mt-1">Industry Avg (BPO)</div>
                      </div>
                      <Badge
                        variant={costData.benchmarks.gapPct > 0 ? "destructive" : "default"}
                        className="text-lg px-6 py-3"
                      >
                        {costData.benchmarks.gapPct > 0 ? "+" : ""}{costData.benchmarks.gapPct}% gap
                      </Badge>
                    </div>
                  </div>
                </GlassCard>
              </>
            ) : null}
          </TabsContent>

          {/* Forecast Tab */}
          <TabsContent value="forecast" className="space-y-4">
            {branchId === ALL ? (
              <GlassCard className="py-12 text-center text-slate-500">
                <LineChart className="h-12 w-12 mx-auto mb-3 text-slate-300" />
                <p className="font-medium">Select a branch to view shrinkage forecast</p>
              </GlassCard>
            ) : forecastLoading ? (
              <GlassCard className="py-12 text-center">
                <div className="animate-pulse">Loading forecast data...</div>
              </GlassCard>
            ) : forecastData ? (
              <>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <GlassCard className="lg:col-span-2">
                    <div className="p-4 border-b border-slate-100">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100">
                          <Calendar className="h-5 w-5 text-blue-600" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-slate-800">Next Week Forecast</h3>
                          <p className="text-xs text-slate-500">Week of {forecastData.nextWeek.weekStart}</p>
                        </div>
                      </div>
                    </div>
                    <div className="p-6">
                      <div className="flex items-center gap-8">
                        <div className="text-center">
                          <div className="text-5xl font-bold text-blue-600">
                            {forecastData.nextWeek.predictedShrinkagePct}%
                          </div>
                          <Badge variant="outline" className="mt-2">{forecastData.nextWeek.confidence} confidence</Badge>
                        </div>
                        <div className="flex-1">
                          {forecastData.nextWeek.riskDays.length > 0 ? (
                            <div>
                              <p className="text-sm font-medium text-red-600 mb-3 flex items-center gap-2">
                                <AlertTriangle className="h-4 w-4" /> Risk Days Identified
                              </p>
                              <div className="space-y-2">
                                {forecastData.nextWeek.riskDays.map((d) => (
                                  <div key={d.date} className="flex items-center justify-between text-sm bg-red-50 px-4 py-2 rounded-lg border border-red-200">
                                    <span className="font-semibold text-red-800">{d.day}</span>
                                    <span className="text-red-600">{d.predictedPct}% — {d.reason}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 text-green-600 bg-green-50 p-4 rounded-lg">
                              <Target className="h-5 w-5" />
                              <p className="font-medium">No high-risk days identified for next week</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </GlassCard>

                  <GlassCard>
                    <div className="p-4 border-b border-slate-100">
                      <h3 className="font-semibold text-slate-800">Historical Patterns</h3>
                    </div>
                    <div className="p-4 space-y-4">
                      {[
                        { label: "Monday Effect", value: forecastData.patterns.mondayEffect },
                        { label: "Friday Effect", value: forecastData.patterns.fridayEffect },
                        { label: "Month-End Effect", value: forecastData.patterns.monthEndEffect },
                      ].map((pattern) => (
                        <div key={pattern.label} className="flex items-center justify-between p-3 rounded-xl bg-slate-50">
                          <span className="text-sm font-medium text-slate-700">{pattern.label}</span>
                          <Badge variant={pattern.value > 3 ? "destructive" : "secondary"}>
                            {pattern.value > 0 ? "+" : ""}{pattern.value}%
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </GlassCard>
                </div>

                {forecastData.recommendations.length > 0 && (
                  <GlassCard className="border-blue-200 bg-gradient-to-br from-blue-50/80 to-white">
                    <div className="p-4 border-b border-blue-100">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100">
                          <Lightbulb className="h-5 w-5 text-blue-600" />
                        </div>
                        <h3 className="font-semibold text-blue-800">Recommendations</h3>
                      </div>
                    </div>
                    <div className="p-4">
                      <ul className="space-y-2">
                        {forecastData.recommendations.map((rec, i) => (
                          <li key={i} className="flex items-start gap-3 text-sm text-blue-900">
                            <Zap className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
                            {rec}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </GlassCard>
                )}
              </>
            ) : null}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
