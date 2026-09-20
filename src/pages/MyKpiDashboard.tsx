import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer, LabelList } from "recharts";
import {
  Loader,
  RefreshCcw,
  Activity,
  CalendarDays,
  BarChart3,
  Zap,
  Users,
  TrendingUp,
  ShieldCheck,
  AlertCircle,
  GraduationCap,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { hrmsApi } from "@/lib/hrmsApi";
import { AIInsightPanel } from "@/components/ai";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HeroScoreDial } from "@/components/my-kpi/HeroScoreDial";
import { CategorySummaryTile } from "@/components/my-kpi/CategorySummaryTile";
import { CategoryRadarChart } from "@/components/my-kpi/CategoryRadarChart";
import { PeerMetricCard } from "@/components/my-kpi/PeerMetricCard";
import type { KpiMetricResult } from "@/components/my-kpi/PeerMetricCard";
import { DrillDownDrawer } from "@/components/my-kpi/DrillDownDrawer";
import { KpiDrillDetail } from "@/components/my-kpi/KpiDrillDetail";
import { LiveCallScoreStrip } from "@/components/my-kpi/LiveCallScoreStrip";
import { AhtTrendChart } from "@/components/my-kpi/AhtTrendChart";
import { OpportunitiesMissed } from "@/components/my-kpi/OpportunitiesMissed";
import { ClapBreakdown } from "@/components/my-kpi/ClapBreakdown";
import { MyLearningSection } from "@/components/my-kpi/MyLearningSection";
import { RealTimeGuidePanel } from "@/components/my-kpi/RealTimeGuidePanel";
import { useAgentQualityData, useCallDetail } from "@/hooks/useAgentQualityData";
import { HeroCard } from "@/components/quality-dashboard/HeroCard";
import { QuickWins } from "@/components/quality-dashboard/QuickWins";
import { WeaknessPanel } from "@/components/quality-dashboard/WeaknessPanel";
import { TrendPanel } from "@/components/quality-dashboard/TrendPanel";
import { CallsTable } from "@/components/quality-dashboard/CallsTable";
import { CallDetailModal } from "@/components/quality-dashboard/CallDetailModal";
import { NoCalls } from "@/components/quality-dashboard/empty-states/NoCalls";
import { ScoringPending } from "@/components/quality-dashboard/empty-states/ScoringPending";
import { DataError } from "@/components/quality-dashboard/empty-states/DataError";

// ─── Types ────────────────────────────────────────────────────────────────────

type Period = "day" | "wtd" | "mtd" | "past_month";

interface OnfidoKpiValue { key: string; label: string; value: number | null; unit: "count" | "seconds" | "percent"; availability: string; note?: string }
interface OnfidoAnalystPerformance {
  email: string; tlName: string | null; amName: string | null; qaName: string | null;
  totalTasks: OnfidoKpiValue; avgManualProcessingTime: OnfidoKpiValue;
  overallErrorRate: OnfidoKpiValue;
  poaTasks: OnfidoKpiValue; poaAvgAht: OnfidoKpiValue; poaErrorRate: OnfidoKpiValue;
  monthly: { month: string; tasks: number; errorRate: number | null }[];
  peers: { email: string; tlName: string | null; tasks: number; errorRate: number | null }[];
}

interface LivePerformanceData {
  period: Period;
  date_range: { start: string; end: string };
  overall_score: number;
  overall_rating: string | null;
  overall_rating_color: string | null;
  metrics: KpiMetricResult[];
  daily_performance: Array<{
    date: string;
    overall_score: number;
    overall_rating: string | null;
    overall_rating_color: string | null;
    metrics: Array<{
      metric_id: string;
      metric_code: string;
      metric_name: string;
      unit: string;
      actual_value: number;
      score_pct: number;
      source: string;
    }>;
  }>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PERIOD_LABELS: Record<Period, string> = {
  day: "Today",
  wtd: "This Week",
  mtd: "This Month",
  past_month: "Last Month",
};

const CATEGORY_LABELS: Record<string, string> = {
  operations: "Operations",
  quality: "Quality",
  hr: "Hygiene",
  sales: "Sales",
  custom: "Custom",
};

const CATEGORY_ICONS: Record<string, typeof Activity> = {
  operations: BarChart3,
  quality: ShieldCheck,
  hr: Users,
  sales: TrendingUp,
  custom: Zap,
};

const RATING_STYLE: Record<string, string> = {
  S: "bg-emerald-50 border-emerald-200 text-emerald-700",
  A: "bg-blue-50 border-blue-200 text-blue-700",
  B: "bg-amber-50 border-amber-200 text-amber-700",
  C: "bg-orange-50 border-orange-200 text-orange-700",
  D: "bg-rose-50 border-rose-200 text-rose-700",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatMetricValue(value: number, unit: string) {
  if (unit === "seconds") return `${Math.round(value)} sec`;
  if (unit === "percent") return `${Math.round(value * 10) / 10}%`;
  if (unit === "currency") return `₹${value.toLocaleString("en-IN")}`;
  return String(Math.round(value * 10) / 10);
}

function fmtDate(d: string): string {
  try {
    return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  } catch {
    return d;
  }
}

// ─── Skeletons ────────────────────────────────────────────────────────────────

function LightSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="flex gap-6">
        <div className="w-44 h-44 bg-slate-100 rounded-full" />
        <div className="flex-1 space-y-3 py-4">
          <div className="h-6 bg-slate-100 rounded w-2/3" />
          <div className="h-16 bg-slate-100 rounded" />
          <div className="h-10 bg-slate-100 rounded w-1/2" />
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-24 bg-slate-100 rounded-xl" />
        ))}
      </div>
      <div className="h-64 bg-slate-100 rounded-xl" />
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function MyKpiDashboard() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // KPI state
  const [period, setPeriod] = useState<Period>("day");
  const [selectedDate, setSelectedDate] = useState(today());
  const [data, setData] = useState<LivePerformanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noKpis, setNoKpis] = useState(false);

  // Drill-down state
  const [drillMetric, setDrillMetric] = useState<KpiMetricResult | null>(null);
  const [drillDay, setDrillDay] = useState<LivePerformanceData["daily_performance"][0] | null>(null);

  // Quality state — paginated calls
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [callsPage, setCallsPage] = useState(0);
  const [callsSort, setCallsSort] = useState<"date" | "cq" | "fatal">("date");
  const CALLS_PAGE_SIZE = 10;

  async function loadData(p: Period) {
    setLoading(true);
    setError(null);
    setNoKpis(false);
    try {
      const dateQuery = p === "day" ? `&date=${selectedDate}` : "";
      const res = await hrmsApi.get<unknown>(`/api/kpi-master/live?period=${p}${dateQuery}`);
      const envelope = res.data as { success?: boolean; data?: LivePerformanceData } | LivePerformanceData | null;
      const d: LivePerformanceData | null = envelope && typeof envelope === "object" && "data" in envelope
        ? (envelope as { data?: LivePerformanceData }).data ?? null
        : (envelope as LivePerformanceData | null);
      if (!d?.metrics?.length) {
        setNoKpis(true);
        setData(null);
      } else {
        setData(d);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load KPI data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData(period);
  }, [period, selectedDate]);

  // Quality hooks
  const {
    cqScore,
    weakness,
    callsReview,
    error: qualityError,
    refetch: qualityRefetch,
    cqScoreLoading,
    weaknessLoading,
    callsLoading,
    isLoading: qualityLoading,
  } = useAgentQualityData(user?.id);

  const { data: callDetail } = useCallDetail(isModalOpen ? selectedCallId : null);

  // Paginated calls query for the Quality tab
  const { data: pagedCalls, isFetching: pagedCallsFetching } = useQuery({
    queryKey: ["quality-calls-paged", callsPage, callsSort],
    queryFn: () =>
      hrmsApi
        .get<unknown>(
          `/api/agent/calls-review?limit=${CALLS_PAGE_SIZE}&offset=${callsPage * CALLS_PAGE_SIZE}&sort=${callsSort}`
        )
        .then((r) => {
          const env = r.data as { data?: typeof callsReview; success?: boolean } | typeof callsReview | null;
          return (env && "data" in (env as object)
            ? (env as { data?: typeof callsReview }).data
            : env) as typeof callsReview | null;
        }),
    staleTime: 120_000,
    placeholderData: (prev) => prev,
  });

  // Derived KPI data
  const groupedMetrics = useMemo(
    () =>
      data?.metrics.reduce(
        (acc, m) => {
          if (!acc[m.category]) acc[m.category] = [];
          acc[m.category].push(m);
          return acc;
        },
        {} as Record<string, KpiMetricResult[]>
      ) ?? {},
    [data]
  );

  const categoryStats = useMemo(
    () =>
      Object.entries(groupedMetrics).map(([cat, metrics]) => {
        const withData = metrics.filter((m) => m.actual_value !== null);
        const avgScore =
          withData.length
            ? withData.reduce((s, m) => s + m.score_pct, 0) / withData.length
            : 0;
        return {
          category: cat,
          label: CATEGORY_LABELS[cat] ?? cat,
          avgScore,
          count: metrics.length,
        };
      }),
    [groupedMetrics]
  );

  // Quality derived state
  const hasNoCalls = !qualityLoading && callsReview && callsReview.total_calls === 0;
  const hasPendingScoring = !qualityLoading && callsReview && callsReview.total_calls > 0 && callsReview.calls.length === 0;
  const showQualityEmptyState = qualityError ? "error" : hasNoCalls ? "no-calls" : hasPendingScoring ? "scoring-pending" : null;

  const processId = (user as { process_id?: string | number } | null)?.process_id;

  // Onfido analyst performance — fetched by the logged-in user's email.
  // Only visible if the analyst has Onfido data in the selected range.
  const onfidoFrom = useMemo(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 3);
    return d.toISOString().slice(0, 10);
  }, []);
  const onfidoTo = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const onfidoQuery = useQuery({
    queryKey: ["onfido-my-perf", user?.email, onfidoFrom, onfidoTo],
    queryFn: () =>
      hrmsApi.get<{ data: OnfidoAnalystPerformance }>(
        `/api/onfido-process/analyst-performance/${encodeURIComponent(user?.email ?? "")}?from=${onfidoFrom}&to=${onfidoTo}`
      ),
    enabled: !!user?.email,
    retry: false,
  });
  const onfidoPerf = onfidoQuery.data?.data ?? null;

  return (
    <>
      {/* Page container — bleeds edge-to-edge */}
      <div className="-mx-4 -mt-5 -mb-9 sm:-mx-5 lg:-mx-6 lg:-mt-6 bg-blue-50/60 min-h-[calc(100vh-64px)] overflow-hidden">
        {/* Gradient hero header — MAS HRMS GradientHeader pattern */}
        <div className="relative overflow-hidden bg-gradient-to-r from-blue-600 to-indigo-700 text-white px-4 pt-5 pb-6 sm:px-5 lg:px-6 lg:pt-6 shadow-lg shadow-blue-500/20">
          <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-3xl" />
          <div className="pointer-events-none absolute bottom-0 left-1/3 h-24 w-24 rounded-full bg-indigo-300/20 blur-2xl" />
          <div className="relative flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-white/20 border border-white/30 backdrop-blur-sm">
                <Activity className="text-white" size={22} />
              </div>
              <div>
                <h1 className="text-xl font-bold text-white">My Performance Hub</h1>
                <p className="text-xs text-white/70 mt-0.5 uppercase tracking-widest font-medium">
                  Personal Performance Dashboard
                </p>
              </div>
            </div>
            <button
              onClick={() => {
                loadData(period);
                qualityRefetch();
                queryClient.invalidateQueries({ queryKey: ["live-cq-score"] });
                queryClient.invalidateQueries({ queryKey: ["weakness-detail"] });
                queryClient.invalidateQueries({ queryKey: ["agent-aht-trend"] });
                queryClient.invalidateQueries({ queryKey: ["my-assignments"] });
                queryClient.invalidateQueries({ queryKey: ["lms-employee"] });
              }}
              className="flex items-center gap-1.5 text-xs font-semibold text-white/70 hover:text-white transition-colors px-3 py-1.5 rounded-lg border border-white/30 bg-white/15 hover:bg-white/25 backdrop-blur-sm"
            >
              <RefreshCcw size={13} />
              Refresh
            </button>
          </div>
        </div>

        {/* ── Content area below gradient header ── */}
        <div className="px-4 pt-5 pb-9 sm:px-5 lg:px-6">

          {/* ── Main Tabs ────────────────────────────────────────────── */}
          <Tabs defaultValue="performance" className="space-y-5">
            <TabsList className="bg-white/95 backdrop-blur-sm border border-white/60 rounded-xl p-1 h-auto gap-1 shadow-[0_1px_3px_rgba(37,99,235,0.08),_0_4px_12px_rgba(37,99,235,0.06)]">
              {[
                { value: "performance", label: "Performance", icon: BarChart3 },
                { value: "quality", label: "Quality & CLAP", icon: ShieldCheck },
                { value: "learning", label: "Learning & TNI", icon: GraduationCap },
                { value: "live", label: "Live Activity", icon: Zap },
                ...(onfidoPerf ? [{ value: "onfido", label: "Onfido KPI", icon: Activity }] : []),
              ].map(({ value, label, icon: Icon }) => (
                <TabsTrigger
                  key={value}
                  value={value}
                  className="flex items-center gap-1.5 text-xs font-semibold data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:shadow-sm rounded-lg px-3 py-2 transition-all"
                >
                  <Icon size={13} />
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>

            {/* ═══════════════════════════════════════════════════════
                TAB 1: PERFORMANCE
            ═══════════════════════════════════════════════════════ */}
            <TabsContent value="performance" className="space-y-5 focus-visible:outline-none">

              {/* Period selector */}
              <div className="flex items-center gap-2 flex-wrap">
                {(Object.entries(PERIOD_LABELS) as [Period, string][]).map(([p, label]) => (
                  <button
                    key={p}
                    onClick={() => setPeriod(p)}
                    className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all ${
                      period === p
                        ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                        : "bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-600"
                    }`}
                  >
                    {label}
                  </button>
                ))}
                {period === "day" && (
                  <input
                    type="date"
                    value={selectedDate}
                    max={today()}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
                  />
                )}
                {loading && <Loader size={14} className="animate-spin text-blue-500 ml-2" />}
              </div>

              {/* Date range subtitle */}
              {data?.date_range && !loading && (
                <p className="text-xs text-slate-400 -mt-3">
                  <CalendarDays size={11} className="inline mr-1 -mt-0.5" />
                  {fmtDate(data.date_range.start)} – {fmtDate(data.date_range.end)}
                </p>
              )}

              {/* Loading */}
              {loading && <LightSkeleton />}

              {/* Error */}
              {!loading && error && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 flex items-start gap-3">
                  <AlertCircle size={18} className="text-rose-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-bold text-rose-700">Failed to load KPI data</p>
                    <p className="text-xs text-rose-600 mt-0.5">{error}</p>
                    <button
                      onClick={() => loadData(period)}
                      className="mt-2 text-xs font-semibold text-rose-600 hover:underline"
                    >
                      Try again
                    </button>
                  </div>
                </div>
              )}

              {/* No KPIs */}
              {!loading && !error && noKpis && (
                <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
                  <BarChart3 size={36} className="text-slate-300 mx-auto mb-3" />
                  <p className="text-sm font-bold text-slate-600">No KPI data for this period</p>
                  <p className="text-xs text-slate-400 mt-1">Try a different period or check your KPI assignments.</p>
                </div>
              )}

              {/* Data loaded */}
              {!loading && !error && data && (
                <>
                  {/* Hero row */}
                  <div className="rounded-xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-[0_1px_3px_rgba(37,99,235,0.08),_0_4px_12px_rgba(37,99,235,0.06)] p-5">
                    <div className="flex gap-6 flex-wrap sm:flex-nowrap">
                      <HeroScoreDial
                        score={data.overall_score}
                        rating={data.overall_rating}
                        ratingColor={data.overall_rating_color}
                      />
                      <div className="flex-1 min-w-0 flex flex-col justify-center gap-4">
                        <AIInsightPanel
                          context="performance_kpi"
                          contextData={{ period, metrics: data.metrics.slice(0, 5) }}
                        />
                        <div className="flex gap-3 flex-wrap">
                          {[
                            { label: "KPIs Tracked", value: data.metrics.length, color: "bg-blue-50 text-blue-700 border-blue-100" },
                            { label: "With Data", value: data.metrics.filter((m) => m.actual_value !== null).length, color: "bg-slate-50 text-slate-700 border-slate-200" },
                            {
                              label: "On Target",
                              value: data.metrics.filter((m) => m.actual_value !== null && m.score_pct >= 80).length,
                              color: "bg-emerald-50 text-emerald-700 border-emerald-100",
                            },
                          ].map(({ label, value, color }) => (
                            <div key={label} className={`rounded-lg border px-3 py-2 ${color}`}>
                              <p className="text-[10px] font-bold uppercase tracking-widest opacity-70">{label}</p>
                              <p className="text-xl font-extrabold font-mono">{value}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Category summary tiles */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {categoryStats.map((stat) => {
                      const Icon = CATEGORY_ICONS[stat.category] ?? Zap;
                      return (
                        <CategorySummaryTile
                          key={stat.category}
                          category={stat.category}
                          label={stat.label}
                          avgScore={stat.avgScore}
                          metricsCount={stat.count}
                          icon={Icon}
                        />
                      );
                    })}
                  </div>

                  {/* Radar + Peer context */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                    <div className="md:col-span-2">
                      <CategoryRadarChart categories={categoryStats} />
                    </div>
                    <div className="space-y-3">
                      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3">
                          Category vs Peers
                        </p>
                        {categoryStats.map((stat) => (
                          <div key={stat.category} className="mb-2">
                            <div className="flex justify-between text-xs mb-1">
                              <span className="text-slate-600 font-medium">{stat.label}</span>
                              <span className="font-mono font-bold text-slate-900">{Math.round(stat.avgScore)}%</span>
                            </div>
                            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${stat.avgScore >= 90 ? "bg-emerald-500" : stat.avgScore >= 70 ? "bg-amber-500" : "bg-rose-500"}`}
                                style={{ width: `${Math.min(stat.avgScore, 100)}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="bg-blue-50 rounded-xl border border-blue-100 p-4">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-blue-700 mb-2">
                          Overall Period
                        </p>
                        <p className="text-3xl font-extrabold font-mono text-blue-700">
                          {Math.round(data.overall_score)}
                        </p>
                        <p className="text-xs text-blue-600 mt-1">/100 composite score</p>
                        {data.overall_rating && (
                          <span className={`inline-block mt-2 text-xs font-extrabold px-2.5 py-0.5 rounded-full border ${RATING_STYLE[data.overall_rating] ?? "bg-slate-100 text-slate-600 border-slate-200"}`}>
                            Rating: {data.overall_rating}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* KPI cards per category — all clickable */}
                  {Object.entries(groupedMetrics).map(([cat, metrics]) => (
                    <div key={cat}>
                      <div className="flex items-center gap-2 mb-3">
                        <div className="h-px flex-1 bg-slate-200" />
                        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 px-2">
                          {CATEGORY_LABELS[cat] ?? cat}
                        </span>
                        <div className="h-px flex-1 bg-slate-200" />
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {metrics.map((m) => (
                          <PeerMetricCard
                            key={m.metric_id}
                            metric={m}
                            onClick={() => setDrillMetric(m)}
                          />
                        ))}
                      </div>
                    </div>
                  ))}

                  {/* Day-wise performance timeline */}
                  {data.daily_performance?.length > 0 && (
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                      <div className="px-5 py-3 border-b border-slate-100">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                          Day-wise Timeline
                        </p>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-slate-100 bg-slate-50">
                              <th className="text-left px-4 py-2.5 font-bold text-slate-500 uppercase tracking-wide">Date</th>
                              <th className="text-center px-4 py-2.5 font-bold text-slate-500 uppercase tracking-wide">Score</th>
                              <th className="text-center px-4 py-2.5 font-bold text-slate-500 uppercase tracking-wide">Rating</th>
                              <th className="text-left px-4 py-2.5 font-bold text-slate-500 uppercase tracking-wide">Metrics</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50">
                            {data.daily_performance.map((day) => (
                              <tr
                                key={day.date}
                                className="hover:bg-blue-50/30 transition-colors cursor-pointer"
                                onClick={() => setDrillDay(day)}
                              >
                                <td className="px-4 py-2.5 font-medium text-slate-700">{fmtDate(day.date)}</td>
                                <td className="px-4 py-2.5 text-center font-extrabold font-mono text-slate-900">
                                  {Math.round(day.overall_score)}
                                </td>
                                <td className="px-4 py-2.5 text-center">
                                  {day.overall_rating && (
                                    <span className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded border ${RATING_STYLE[day.overall_rating] ?? "bg-slate-100 text-slate-600 border-slate-200"}`}>
                                      {day.overall_rating}
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-2.5">
                                  <div className="flex flex-wrap gap-1">
                                    {day.metrics.slice(0, 4).map((m) => (
                                      <span key={m.metric_id} className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono">
                                        {m.metric_code}: {formatMetricValue(m.actual_value, m.unit)}
                                      </span>
                                    ))}
                                    {day.metrics.length > 4 && (
                                      <span className="text-[10px] text-slate-400">+{day.metrics.length - 4} more</span>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              )}
            </TabsContent>

            {/* ═══════════════════════════════════════════════════════
                TAB 2: QUALITY & CLAP
            ═══════════════════════════════════════════════════════ */}
            <TabsContent value="quality" className="space-y-5 focus-visible:outline-none">

              {/* Live call score strip */}
              <LiveCallScoreStrip />

              {/* Quality empty states */}
              {showQualityEmptyState === "error" && (
                <DataError onRetry={() => qualityRefetch()} />
              )}
              {showQualityEmptyState === "no-calls" && <NoCalls />}
              {showQualityEmptyState === "scoring-pending" && <ScoringPending />}

              {/* Full quality data */}
              {!showQualityEmptyState && (
                <>
                  {/* Hero CQ score */}
                  {cqScoreLoading ? (
                    <div className="h-40 bg-slate-100 rounded-xl animate-pulse" />
                  ) : (
                    cqScore && <HeroCard data={cqScore} />
                  )}

                  {/* Quick wins */}
                  {weakness && (
                    <QuickWins topWeakness={weakness.weakness_areas?.[0]?.category ?? null} />
                  )}

                  {/* Opportunities Missed */}
                  <OpportunitiesMissed />

                  {/* Weakness + Trend row */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    {weaknessLoading ? (
                      <div className="h-48 bg-slate-100 rounded-xl animate-pulse" />
                    ) : (
                      weakness && (
                        <WeaknessPanel
                          weaknessAreas={weakness.weakness_areas ?? []}
                        />
                      )
                    )}
                    {cqScoreLoading ? (
                      <div className="h-48 bg-slate-100 rounded-xl animate-pulse" />
                    ) : (
                      cqScore && (
                        <TrendPanel
                          weekly={cqScore.weekly}
                          cq_7day_avg={cqScore.cq_score_7day_avg}
                          cq_30day_avg={cqScore.cq_score_30day_avg}
                          trend_7day={cqScore.trend_7day}
                          trend_30day={cqScore.trend_30day}
                        />
                      )
                    )}
                  </div>

                  {/* CLAP breakdown */}
                  <ClapBreakdown processId={processId} />

                  {/* Calls table */}
                  {callsLoading && !pagedCalls ? (
                    <div className="h-64 bg-slate-100 rounded-xl animate-pulse" />
                  ) : (
                    (pagedCalls ?? callsReview) && (
                      <CallsTable
                        calls={(pagedCalls ?? callsReview)?.calls ?? []}
                        totalCalls={(pagedCalls ?? callsReview)?.total_calls ?? 0}
                        currentPage={callsPage}
                        pageSize={CALLS_PAGE_SIZE}
                        sortBy={callsSort}
                        isLoading={pagedCallsFetching}
                        onPageChange={(page) => setCallsPage(page)}
                        onSortChange={(sort) => { setCallsSort(sort); setCallsPage(0); }}
                        onCallClick={(call) => {
                          setSelectedCallId(call.call_id);
                          setIsModalOpen(true);
                        }}
                      />
                    )
                  )}
                </>
              )}
            </TabsContent>

            {/* ═══════════════════════════════════════════════════════
                TAB 3: LEARNING & TNI
            ═══════════════════════════════════════════════════════ */}
            <TabsContent value="learning" className="space-y-5 focus-visible:outline-none">
              <MyLearningSection />
            </TabsContent>

            {/* ═══════════════════════════════════════════════════════
                TAB 4: LIVE ACTIVITY
            ═══════════════════════════════════════════════════════ */}
            <TabsContent value="live" className="space-y-5 focus-visible:outline-none">
              {/* Live score strip with animated badge */}
              <LiveCallScoreStrip refetchInterval={30_000} showLiveBadge />

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* AHT Trend Chart */}
                <AhtTrendChart refetchInterval={30_000} />

                {/* Real-time Guide Panel */}
                <RealTimeGuidePanel refetchInterval={30_000} />
              </div>

              {/* Live monitoring note */}
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex items-center gap-3">
                <span className="h-3 w-3 rounded-full bg-emerald-500 animate-pulse flex-shrink-0" />
                <p className="text-xs text-blue-700">
                  <span className="font-bold">Auto-refreshes every 30 seconds.</span>{" "}
                  Data sourced from live call logs and quality audit system.
                </p>
              </div>
            </TabsContent>

            {/* ═══════════════════════════════════════════════════════
                TAB 5: ONFIDO KPI (only visible to Onfido analysts)
            ═══════════════════════════════════════════════════════ */}
            {onfidoPerf && (
              <TabsContent value="onfido" className="space-y-5 focus-visible:outline-none">
                <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4">
                  <p className="text-xs font-bold text-blue-700">Onfido Process Performance — last 3 months</p>
                  <p className="text-xs text-blue-500 mt-0.5">Sourced from Onfido DOC and POA queue data via the Onfido Process Dashboard.</p>
                </div>

                {/* DOC KPIs */}
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">DOC Queue</p>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { kpi: onfidoPerf.totalTasks, color: "bg-blue-50 border-blue-200 text-blue-700" },
                      { kpi: onfidoPerf.avgManualProcessingTime, color: "bg-indigo-50 border-indigo-200 text-indigo-700" },
                      { kpi: onfidoPerf.overallErrorRate, color: "bg-rose-50 border-rose-200 text-rose-700" },
                    ].map(({ kpi, color }) => (
                      <div key={kpi.key} className={`rounded-xl border p-4 ${color}`}>
                        <p className="text-[10px] font-bold uppercase tracking-widest opacity-70">{kpi.label}</p>
                        <p className="text-2xl font-extrabold font-mono mt-1">
                          {kpi.value === null ? "—" : kpi.unit === "percent" ? `${kpi.value}%` : kpi.unit === "seconds" ? `${kpi.value}s` : kpi.value.toLocaleString("en-IN")}
                        </p>
                        {kpi.note && <p className="text-[10px] opacity-60 mt-0.5">{kpi.note}</p>}
                      </div>
                    ))}
                  </div>
                </div>

                {/* POA KPIs */}
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">POA Queue</p>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { kpi: onfidoPerf.poaTasks, color: "bg-teal-50 border-teal-200 text-teal-700" },
                      { kpi: onfidoPerf.poaAvgAht, color: "bg-cyan-50 border-cyan-200 text-cyan-700" },
                      { kpi: onfidoPerf.poaErrorRate, color: "bg-orange-50 border-orange-200 text-orange-700" },
                    ].map(({ kpi, color }) => (
                      <div key={kpi.key} className={`rounded-xl border p-4 ${color}`}>
                        <p className="text-[10px] font-bold uppercase tracking-widest opacity-70">{kpi.label}</p>
                        <p className="text-2xl font-extrabold font-mono mt-1">
                          {kpi.value === null ? "—" : kpi.unit === "percent" ? `${kpi.value}%` : kpi.unit === "seconds" ? `${kpi.value}s` : kpi.value.toLocaleString("en-IN")}
                        </p>
                        {kpi.note && <p className="text-[10px] opacity-60 mt-0.5">{kpi.note}</p>}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Month-wise chart */}
                {onfidoPerf.monthly.length > 0 && (
                  <div className="rounded-xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm p-5">
                    <p className="text-xs font-bold text-slate-700 mb-3">Month-wise DOC Task Volume</p>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={onfidoPerf.monthly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                        <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#64748b" }} />
                        <YAxis tickLine={false} axisLine={false} width={36} allowDecimals={false} tick={{ fontSize: 11, fill: "#64748b" }} />
                        <RTooltip />
                        <Bar dataKey="tasks" name="Tasks" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={40}>
                          <LabelList dataKey="tasks" position="top" fontSize={10} fill="#64748b" />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* Peer ranking */}
                {onfidoPerf.peers.length > 0 && (
                  <div className="rounded-xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm p-5">
                    <p className="text-xs font-bold text-slate-700 mb-3">Peer Ranking (Same TL)</p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-slate-100">
                            <th className="text-left py-2 px-3 font-bold text-slate-500 text-[10px] uppercase tracking-wide">Rank</th>
                            <th className="text-left py-2 px-3 font-bold text-slate-500 text-[10px] uppercase tracking-wide">Analyst</th>
                            <th className="text-right py-2 px-3 font-bold text-slate-500 text-[10px] uppercase tracking-wide">Tasks</th>
                            <th className="text-right py-2 px-3 font-bold text-slate-500 text-[10px] uppercase tracking-wide">Error Rate</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...onfidoPerf.peers].sort((a, b) => b.tasks - a.tasks).slice(0, 20).map((p, i) => (
                            <tr key={p.email}
                              className={`border-b border-slate-50 ${p.email.toLowerCase() === onfidoPerf.email.toLowerCase() ? "bg-blue-50 font-bold" : ""}`}
                            >
                              <td className="py-2 px-3 text-slate-400 font-bold">{i + 1}</td>
                              <td className="py-2 px-3 text-slate-700">{p.email}</td>
                              <td className="py-2 px-3 text-right font-mono text-slate-700">{p.tasks.toLocaleString("en-IN")}</td>
                              <td className="py-2 px-3 text-right font-mono" style={{ color: p.errorRate !== null && p.errorRate > 2 ? "#ef4444" : p.errorRate !== null && p.errorRate < 1 ? "#22c55e" : "#64748b" }}>
                                {p.errorRate !== null ? `${p.errorRate}%` : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </TabsContent>
            )}
          </Tabs>
        </div>
      </div>

      {/* ── Metric drill-down drawer ──────────────────────────── */}
      <DrillDownDrawer
        open={!!drillMetric}
        onClose={() => setDrillMetric(null)}
        title={drillMetric?.metric_name ?? ""}
        subtitle={drillMetric?.metric_code}
        badge={
          drillMetric?.rating ? (
            <span className={`text-xs font-extrabold px-2 py-0.5 rounded-full border ${RATING_STYLE[drillMetric.rating] ?? "bg-slate-100 text-slate-600 border-slate-200"}`}>
              {drillMetric.rating}
            </span>
          ) : undefined
        }
      >
        {drillMetric && <KpiDrillDetail metric={drillMetric} />}
      </DrillDownDrawer>

      {/* ── Day-wise drill-down drawer ───────────────────────── */}
      <DrillDownDrawer
        open={!!drillDay}
        onClose={() => setDrillDay(null)}
        title={drillDay ? fmtDate(drillDay.date) : ""}
        subtitle="Day breakdown"
        badge={
          drillDay?.overall_rating ? (
            <span className={`text-xs font-extrabold px-2 py-0.5 rounded-full border ${RATING_STYLE[drillDay.overall_rating] ?? "bg-slate-100 text-slate-600 border-slate-200"}`}>
              {drillDay.overall_rating}
            </span>
          ) : undefined
        }
      >
        {drillDay && (
          <>
            {/* Summary */}
            <div className={`rounded-xl border p-4 mb-1 ${
              drillDay.overall_score >= 90 ? "bg-emerald-50 border-emerald-200 text-emerald-700"
              : drillDay.overall_score >= 70 ? "bg-amber-50 border-amber-200 text-amber-700"
              : "bg-rose-50 border-rose-200 text-rose-700"
            }`}>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest opacity-70">Overall Score</p>
                  <p className="text-3xl font-extrabold font-mono">{Math.round(drillDay.overall_score)}</p>
                  <p className="text-xs opacity-70">/ 100 composite</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-bold uppercase tracking-widest opacity-70">Date</p>
                  <p className="text-sm font-bold">{fmtDate(drillDay.date)}</p>
                  <p className="text-xs opacity-70">{drillDay.metrics.length} metrics tracked</p>
                </div>
              </div>
            </div>
            {/* Per-metric breakdown */}
            <div className="px-5 py-3 space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Metric Breakdown</p>
              {drillDay.metrics.map((m) => (
                <div key={m.metric_id} className="flex items-center justify-between gap-3 py-2 border-b border-slate-50">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-slate-900 truncate">{m.metric_name}</p>
                    <p className="text-[10px] text-slate-400">{m.metric_code} · {m.source}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs font-mono text-slate-700">{formatMetricValue(m.actual_value, m.unit)}</span>
                    <span className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded border ${
                      m.score_pct >= 90 ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : m.score_pct >= 70 ? "bg-amber-50 text-amber-700 border-amber-200"
                      : "bg-rose-50 text-rose-700 border-rose-200"
                    }`}>
                      {Math.round(m.score_pct)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </DrillDownDrawer>

      {/* ── Call detail modal ─────────────────────────────────── */}
      <CallDetailModal
        isOpen={isModalOpen && !!callDetail}
        call={callDetail as Parameters<typeof CallDetailModal>[0]["call"]}
        onClose={() => {
          setIsModalOpen(false);
          setSelectedCallId(null);
        }}
      />
    </>
  );
}
