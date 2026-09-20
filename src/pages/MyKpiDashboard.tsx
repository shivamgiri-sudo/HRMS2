import { useEffect, useMemo, useState } from "react";
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
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { hrmsApi } from "@/lib/hrmsApi";
import { AIInsightPanel } from "@/components/ai";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { HeroScoreDial } from "@/components/my-kpi/HeroScoreDial";
import { CategorySummaryTile } from "@/components/my-kpi/CategorySummaryTile";
import { CategoryRadarChart } from "@/components/my-kpi/CategoryRadarChart";
import { PeerMetricCard } from "@/components/my-kpi/PeerMetricCard";
import type { KpiMetricResult } from "@/components/my-kpi/PeerMetricCard";
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

const RATING_DARK: Record<string, string> = {
  S: "bg-emerald-500/20 border-emerald-500/40 text-emerald-300",
  A: "bg-blue-500/20   border-blue-500/40   text-blue-300",
  B: "bg-amber-500/20  border-amber-500/40  text-amber-300",
  C: "bg-orange-500/20 border-orange-500/40 text-orange-300",
  D: "bg-rose-500/20   border-rose-500/40   text-rose-300",
};

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function DarkSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="flex gap-6">
        <div className="w-44 h-44 bg-slate-900/60 rounded-full border border-slate-800" />
        <div className="flex-1 space-y-3 py-4">
          <div className="h-6 bg-slate-900/60 rounded border border-slate-800 w-2/3" />
          <div className="h-16 bg-slate-900/60 rounded border border-slate-800" />
          <div className="h-10 bg-slate-900/60 rounded border border-slate-800 w-1/2" />
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-24 bg-slate-900/60 rounded-xl border border-slate-800" />
        ))}
      </div>
      <div className="h-64 bg-slate-900/60 rounded-xl border border-slate-800" />
    </div>
  );
}

// ─── Quality Tab Skeletons ────────────────────────────────────────────────────

function HeroSkeleton() {
  return (
    <Card className="p-6 bg-slate-900/60 border-slate-800">
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-slate-700 rounded w-1/3" />
        <div className="h-64 bg-slate-700 rounded" />
      </div>
    </Card>
  );
}

function PanelSkeleton() {
  return (
    <Card className="p-6 bg-slate-900/60 border-slate-800">
      <div className="animate-pulse space-y-4">
        <div className="h-6 bg-slate-700 rounded w-1/2" />
        <div className="h-40 bg-slate-700 rounded" />
      </div>
    </Card>
  );
}

function TableSkeleton() {
  return (
    <Card className="p-6 bg-slate-900/60 border-slate-800">
      <div className="animate-pulse space-y-4">
        <div className="h-10 bg-slate-700 rounded" />
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-12 bg-slate-700 rounded" />
          ))}
        </div>
      </div>
    </Card>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function MyKpiDashboard() {
  const { user } = useAuth();

  // KPI state
  const [period, setPeriod] = useState<Period>("day");
  const [selectedDate, setSelectedDate] = useState(today());
  const [data, setData] = useState<LivePerformanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noKpis, setNoKpis] = useState(false);

  // Quality state
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  async function loadData(p: Period) {
    setLoading(true);
    setError(null);
    setNoKpis(false);
    try {
      const dateQuery = p === "day" ? `&date=${selectedDate}` : "";
      const res = await hrmsApi.get<{ success: boolean; data: LivePerformanceData }>(
        `/api/kpi-master/live?period=${p}${dateQuery}`
      );
      if (!res.data?.metrics?.length) {
        setNoKpis(true);
        setData(null);
      } else {
        setData(res.data);
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
  const hasNoCalls = useMemo(
    () => !qualityLoading && callsReview && callsReview.total_calls === 0,
    [qualityLoading, callsReview]
  );

  const hasPendingScoring = useMemo(
    () =>
      !qualityLoading &&
      callsReview &&
      callsReview.total_calls > 0 &&
      callsReview.calls.length === 0,
    [qualityLoading, callsReview]
  );

  const showQualityEmptyState = useMemo(() => {
    if (qualityError) return "error";
    if (hasNoCalls) return "no-calls";
    if (hasPendingScoring) return "scoring-pending";
    return null;
  }, [qualityError, hasNoCalls, hasPendingScoring]);

  return (
    <>
      <div className="relative bg-slate-950 min-h-[calc(100vh-64px)] overflow-hidden -mx-4 -mt-5 -mb-9 sm:-mx-5 lg:-mx-6 lg:-mt-6 px-4 pt-5 pb-9 sm:px-5 lg:px-6 lg:pt-6">
        {/* Ambient glow orbs */}
        <div className="pointer-events-none absolute -top-32 left-1/4 w-[480px] h-[480px] bg-blue-600/5 blur-[120px]" />
        <div className="pointer-events-none absolute top-1/2 right-0 w-[320px] h-[320px] bg-indigo-600/4 blur-[100px]" />

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20">
              <Activity className="text-blue-400" size={22} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">My Performance Hub</h1>
              <p className="text-xs text-slate-400 mt-0.5 uppercase tracking-widest font-medium">
                Live metrics · {PERIOD_LABELS[period]}
              </p>
            </div>
          </div>
          <button
            onClick={() => loadData(period)}
            disabled={loading}
            className="flex items-center gap-1.5 text-slate-400 hover:text-blue-400 text-xs font-semibold uppercase tracking-widest transition-colors disabled:opacity-50"
          >
            <RefreshCcw size={13} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        {/* Period selector */}
        <div className="flex gap-2 mb-6 flex-wrap">
          {(Object.entries(PERIOD_LABELS) as [Period, string][]).map(([p, label]) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-4 py-2 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all ${
                period === p
                  ? "bg-blue-600 text-white shadow-[0_0_16px_-4px_rgba(59,130,246,0.5)]"
                  : "bg-slate-900/60 border border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-600"
              }`}
            >
              {label}
            </button>
          ))}
          {period === "day" && (
            <label className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-3 text-xs text-slate-400">
              <CalendarDays size={14} />
              <input
                type="date"
                value={selectedDate}
                max={today()}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-transparent py-2 outline-none text-slate-300"
              />
            </label>
          )}
        </div>

        {/* Tabs */}
        <Tabs defaultValue="performance">
          <TabsList className="bg-slate-900/60 border border-slate-800 rounded-xl p-1 mb-6 w-auto inline-flex">
            <TabsTrigger
              value="performance"
              className="data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:shadow-[0_0_12px_-4px_rgba(59,130,246,0.6)] text-slate-400 rounded-lg text-xs font-semibold uppercase tracking-wider px-5 py-2 transition-all"
            >
              My Performance
            </TabsTrigger>
            <TabsTrigger
              value="quality"
              className="data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:shadow-[0_0_12px_-4px_rgba(59,130,246,0.6)] text-slate-400 rounded-lg text-xs font-semibold uppercase tracking-wider px-5 py-2 transition-all"
            >
              Call Quality
            </TabsTrigger>
          </TabsList>

          {/* ── KPI Performance Tab ────────────────────────────────────────── */}
          <TabsContent value="performance">
            {loading && <DarkSkeleton />}

            {!loading && error && (
              <div className="bg-rose-950/40 border border-rose-800/60 text-rose-400 px-4 py-3 rounded-xl text-sm">
                {error}
              </div>
            )}

            {!loading && !error && noKpis && (
              <div className="text-center py-24 text-slate-500">
                <Activity size={48} className="mx-auto mb-4 opacity-30" />
                <p className="text-lg font-semibold text-slate-400">No KPIs assigned yet</p>
                <p className="text-sm mt-2">
                  Your KPIs are configured by HR based on your department, process, and designation.
                </p>
                <p className="text-sm mt-1">Contact HR or your manager to get started.</p>
              </div>
            )}

            {!loading && data && (
              <div className="space-y-6">
                {/* Hero row */}
                <div className="flex flex-col sm:flex-row gap-6 items-start">
                  <HeroScoreDial
                    score={data.overall_score}
                    rating={data.overall_rating}
                    ratingColor={data.overall_rating_color}
                  />
                  <div className="flex-1 space-y-3">
                    <AIInsightPanel
                      contextType="performance_kpi"
                      role="employee"
                      title="AI Performance Brief"
                      enabled
                      data={{
                        overall_score: data.overall_score,
                        overall_rating: data.overall_rating,
                        total_kpis: data.metrics.length,
                        kpis_with_data: data.metrics.filter((m) => m.actual_value !== null).length,
                        on_target_count: data.metrics.filter((m) => m.score_pct >= 90).length,
                        below_60_count: data.metrics.filter((m) => m.score_pct < 60).length,
                      }}
                    />
                    {/* Stat chips */}
                    <div className="flex gap-3 flex-wrap">
                      {[
                        { label: "KPIs Tracked", value: data.metrics.length },
                        { label: "With Data", value: data.metrics.filter((m) => m.actual_value !== null).length },
                        { label: "On Target", value: data.metrics.filter((m) => m.score_pct >= 90).length },
                      ].map((chip) => (
                        <div
                          key={chip.label}
                          className="bg-slate-900/60 border border-slate-800 rounded-lg px-4 py-2 text-center"
                        >
                          <div className="text-xl font-bold font-mono text-white">{chip.value}</div>
                          <div className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">
                            {chip.label}
                          </div>
                        </div>
                      ))}
                      {data.date_range && (
                        <div className="bg-slate-900/60 border border-slate-800 rounded-lg px-4 py-2 text-center">
                          <div className="text-xs font-mono text-slate-300">
                            {data.date_range.start}
                          </div>
                          <div className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">
                            → {data.date_range.end}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Category tiles */}
                {categoryStats.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    {categoryStats.map((cat) => {
                      const Icon = CATEGORY_ICONS[cat.category] ?? Zap;
                      return (
                        <CategorySummaryTile
                          key={cat.category}
                          category={cat.category}
                          label={cat.label}
                          avgScore={cat.avgScore}
                          metricsCount={cat.count}
                          icon={Icon}
                        />
                      );
                    })}
                  </div>
                )}

                {/* Radar + Peer context */}
                {categoryStats.length >= 2 && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="md:col-span-2">
                      <CategoryRadarChart categories={categoryStats} />
                    </div>
                    <div className="bg-slate-900/60 backdrop-blur-md rounded-xl p-5 border border-slate-800/80">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-4">
                        Peer Benchmarking
                      </p>
                      <div className="space-y-3">
                        {categoryStats.map((cat) => {
                          const catMetrics = groupedMetrics[cat.category] ?? [];
                          const withPeer = catMetrics.filter(
                            (m) => m.peer_avg !== null && m.actual_value !== null
                          );
                          const peerAvgScore =
                            withPeer.length > 0
                              ? withPeer.reduce((s, m) => {
                                  const isLower = m.direction === "lower_is_better";
                                  const pct =
                                    m.target_value > 0 && m.peer_avg !== null
                                      ? isLower
                                        ? Math.min((m.target_value / m.peer_avg) * 100, 100)
                                        : Math.min((m.peer_avg / m.target_value) * 100, 100)
                                      : 0;
                                  return s + pct;
                                }, 0) / withPeer.length
                              : null;

                          return (
                            <div key={cat.category}>
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                                  {cat.label}
                                </span>
                                <span className="text-[10px] font-mono text-slate-300">
                                  {Math.round(cat.avgScore)}%
                                </span>
                              </div>
                              <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-blue-500 rounded-full"
                                  style={{ width: `${Math.min(cat.avgScore, 100)}%` }}
                                />
                              </div>
                              {peerAvgScore !== null && (
                                <div className="flex items-center justify-between mt-0.5">
                                  <span className="text-[9px] text-slate-600">Peer avg</span>
                                  <span className="text-[9px] font-mono text-slate-500">
                                    {Math.round(peerAvgScore)}%
                                  </span>
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {categoryStats.every(
                          (c) =>
                            !(groupedMetrics[c.category] ?? []).some(
                              (m) => m.peer_avg !== null
                            )
                        ) && (
                          <p className="text-xs text-slate-600 text-center py-4">
                            Peer data not available for this period
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* KPI metric cards per category */}
                {Object.entries(groupedMetrics).map(([category, catMetrics]) => (
                  <div key={category}>
                    <h2 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3">
                      {CATEGORY_LABELS[category] ?? category}
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      {catMetrics.map((m) => (
                        <PeerMetricCard key={m.metric_id} metric={m} />
                      ))}
                    </div>
                  </div>
                ))}

                {/* Day-wise timeline */}
                <div className="overflow-auto rounded-2xl border border-slate-800/80 bg-slate-900/60 backdrop-blur-md">
                  <div className="border-b border-slate-800/80 px-5 py-3.5">
                    <h2 className="font-semibold text-slate-200 text-sm">Day-wise performance</h2>
                  </div>
                  <table className="w-full min-w-[720px] text-sm">
                    <thead className="bg-slate-950 text-left">
                      <tr>
                        {["Date", "Overall Score", "Rating", "Metrics & Source"].map((col) => (
                          <th
                            key={col}
                            className="px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-500"
                          >
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.daily_performance.length === 0 && (
                        <tr>
                          <td
                            colSpan={4}
                            className="px-5 py-10 text-center text-slate-600 text-sm"
                          >
                            No source data available for this date or period.
                          </td>
                        </tr>
                      )}
                      {data.daily_performance.map((day) => (
                        <tr key={day.date} className="border-t border-slate-800/50 align-top">
                          <td className="px-5 py-3 font-medium text-slate-300 font-mono text-xs">
                            {day.date}
                          </td>
                          <td className="px-5 py-3 font-bold text-white font-mono">
                            {Math.round(day.overall_score)}%
                          </td>
                          <td className="px-5 py-3">
                            {day.overall_rating ? (
                              <span
                                className={`text-xs font-extrabold px-2.5 py-0.5 rounded-full border ${
                                  RATING_DARK[day.overall_rating] ??
                                  "bg-slate-700/40 border-slate-600 text-slate-400"
                                }`}
                              >
                                {day.overall_rating}
                              </span>
                            ) : (
                              <span className="text-slate-600">—</span>
                            )}
                          </td>
                          <td className="px-5 py-3">
                            <div className="flex flex-wrap gap-2">
                              {day.metrics.map((m) => (
                                <span
                                  key={m.metric_id}
                                  className="rounded-full bg-slate-800/60 border border-slate-700/50 px-2.5 py-1 text-xs text-slate-300"
                                >
                                  {m.metric_code}:{" "}
                                  {formatMetricValue(m.actual_value, m.unit)} ·{" "}
                                  {m.source}
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </TabsContent>

          {/* ── Call Quality Tab ───────────────────────────────────────────── */}
          <TabsContent value="quality">
            <div className="space-y-6">
              {showQualityEmptyState === "error" && (
                <DataError onRetry={qualityRefetch} />
              )}

              {showQualityEmptyState === "no-calls" && <NoCalls />}

              {showQualityEmptyState === "scoring-pending" && <ScoringPending />}

              {!showQualityEmptyState && (
                <>
                  {/* Hero Card */}
                  <div className="w-full">
                    {cqScoreLoading ? (
                      <HeroSkeleton />
                    ) : cqScore ? (
                      <HeroCard data={cqScore} isLoading={false} />
                    ) : (
                      <Card className="p-6 bg-amber-950/30 border-amber-800/40">
                        <div className="flex items-start gap-4">
                          <AlertCircle className="h-5 w-5 text-amber-400 mt-1 flex-shrink-0" />
                          <div>
                            <h3 className="font-semibold text-amber-300">
                              Quality Score Unavailable
                            </h3>
                            <p className="text-sm text-amber-400/70 mt-1">
                              Your CQ score could not be loaded. Please refresh the page.
                            </p>
                          </div>
                        </div>
                      </Card>
                    )}
                  </div>

                  {/* Quick Wins */}
                  {cqScore && !cqScoreLoading && (
                    <div className="w-full">
                      <QuickWins
                        topWeakness={weakness?.weakness_areas?.[0]?.category}
                        isLoading={cqScoreLoading}
                      />
                    </div>
                  )}

                  {/* Weakness + Trend 2-col */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      {weaknessLoading ? (
                        <PanelSkeleton />
                      ) : weakness ? (
                        <WeaknessPanel weaknessAreas={weakness.weakness_areas} />
                      ) : (
                        <Card className="p-6 text-center text-slate-500 bg-slate-900/60 border-slate-800">
                          No weakness data available
                        </Card>
                      )}
                    </div>
                    <div>
                      {cqScoreLoading ? (
                        <PanelSkeleton />
                      ) : cqScore ? (
                        <TrendPanel
                          weekly={cqScore.weekly}
                          cq_7day_avg={cqScore.cq_score_7day_avg}
                          cq_30day_avg={cqScore.cq_score_30day_avg}
                          trend_7day={cqScore.trend_7day}
                          trend_30day={cqScore.trend_30day}
                        />
                      ) : (
                        <Card className="p-6 text-center text-slate-500 bg-slate-900/60 border-slate-800">
                          No trend data available
                        </Card>
                      )}
                    </div>
                  </div>

                  {/* Calls Table */}
                  <div className="w-full">
                    {callsLoading ? (
                      <TableSkeleton />
                    ) : callsReview && callsReview.calls.length > 0 ? (
                      <CallsTable
                        calls={callsReview.calls}
                        totalCalls={callsReview.total_calls}
                        currentPage={
                          Math.floor(callsReview.page.offset / callsReview.page.limit) + 1
                        }
                        pageSize={callsReview.page.limit}
                        isLoading={callsLoading}
                        onCallClick={(call) => {
                          setSelectedCallId(call.call_id);
                          setIsModalOpen(true);
                        }}
                      />
                    ) : (
                      <Card className="p-6 text-center text-slate-500 bg-slate-900/60 border-slate-800">
                        No calls available yet
                      </Card>
                    )}
                  </div>
                </>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Call Detail Modal — outside tabs so it can overlay full screen */}
      <CallDetailModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setSelectedCallId(null);
        }}
        call={callDetail}
        isLoading={!callDetail && isModalOpen}
      />
    </>
  );
}
