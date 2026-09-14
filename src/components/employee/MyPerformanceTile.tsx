/**
 * MyPerformanceTile — Employee Self-KPI Dashboard Section
 *
 * Four panels:
 *   1. My Quality Score   — CQ% this week, 4-week sparkline, vs team avg
 *   2. My KPI Scorecard   — per-metric row + composite rating
 *   3. My TNI             — parameters where my pass rate < 70%
 *   4. My Quick Actions   — Leave / Payslip / Roster / Training
 *
 * Data sources:
 *   /api/agent/cq-score          (self-scoped; resolved from JWT)
 *   /api/agent/weakness-detail   (self-scoped)
 *   /api/kpi-master/live         (self-scoped; period=wtd)
 *
 * Uses React Query v5 (useQueries), shadcn Card / Progress / Badge / Button.
 */

import { useQueries } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BookOpen,
  Calendar,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  Loader2,
  Minus,
  RefreshCw,
  Shield,
  TrendingUp,
} from "lucide-react";
import {
  Line, LineChart, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { hrmsApi } from "@/lib/hrmsApi";
import { useViewAs } from "@/contexts/ViewAsContext";

// /api/kpi-master/live resolves to the REAL logged-in user's own linked employee
// record regardless of View As state (confirmed live — see MyKpiDashboard.tsx's
// liveKpiUrl for the full story). Route to /live/:empId, which exists specifically
// for this, whenever a View As target is active.
function liveKpiUrl(activeEmployeeId: string | undefined, query: string): string {
  return activeEmployeeId
    ? `/api/kpi-master/live/${activeEmployeeId}${query}`
    : `/api/kpi-master/live${query}`;
}

// ── Types ────────────────────────────────────────────────────────────────────

interface CQScorePayload {
  cq_score_current: number;
  peer_avg: number;
  target: number;
  weekly: Array<{ day: string; avg: number }>;
  trend_7day?: { direction: string; change_pct: number };
}

interface WeaknessArea {
  category: string;
  score: number;
  peer_avg: number;
  gap: number;
  sub_metrics: Array<{ name: string; score: number; calls_weak: number }>;
}

interface WeaknessPayload {
  weakness_areas: WeaknessArea[];
}

interface KpiTrendPoint {
  date: string;
  value: number;
  source: string;
}

interface KpiMetric {
  metric_id: string;
  metric_code: string;
  metric_name: string;
  unit: string;
  direction: string;
  target_value: number;
  actual_value: number | null;
  score_pct: number;
  score_status: string;
  rating: string | null;
  trend_data?: KpiTrendPoint[];
  // Peer comparison — same process+designation this period; null when there's
  // no meaningful peer group. See MyKpiDashboard.tsx's identical contract.
  percentile?: number | null;
}

interface KpiLivePayload {
  overall_score: number;
  overall_rating: string | null;
  metrics: KpiMetric[];
}

// ── API helpers ───────────────────────────────────────────────────────────────

function unwrap<T>(res: unknown): T | null {
  const r = res as { data?: T } | null;
  if (r && typeof r === "object" && "data" in r) return r.data ?? null;
  return (res ?? null) as T | null;
}

async function fetchCqScore(): Promise<CQScorePayload | null> {
  try {
    const res = await hrmsApi.get<unknown>("/api/agent/cq-score?daysBack=7");
    return unwrap<CQScorePayload>(res);
  } catch {
    return null;
  }
}

async function fetchWeakness(): Promise<WeaknessPayload | null> {
  try {
    const res = await hrmsApi.get<unknown>("/api/agent/weakness-detail");
    return unwrap<WeaknessPayload>(res);
  } catch {
    return null;
  }
}

async function fetchKpiLive(viewAsId: string | undefined): Promise<KpiLivePayload | null> {
  try {
    const res = await hrmsApi.get<unknown>(liveKpiUrl(viewAsId, "?period=wtd"));
    return unwrap<KpiLivePayload>(res);
  } catch {
    return null;
  }
}

// period=past_month (not wtd) — a week gives ~5 working-day points, too short for a
// trend a person can actually read. trend_data is already computed server-side
// (getLiveKpiPerformance in kpi-master.service.ts) — this just fetches a wider window.
//
// past_month means the FIXED previous calendar month on the backend (getDateRange in
// kpi-master.service.ts), not a rolling 30 days — confirmed live: an agent with real
// current-month actuals showed empty trends because none of that data falls in the
// prior month's window. Fetching mtd (this month) too and merging trend_data per
// metric covers both without changing what past_month means for other callers.
async function fetchKpiTrend(viewAsId: string | undefined): Promise<KpiLivePayload | null> {
  try {
    const [pastMonthRes, mtdRes] = await Promise.all([
      hrmsApi.get<unknown>(liveKpiUrl(viewAsId, "?period=past_month")),
      hrmsApi.get<unknown>(liveKpiUrl(viewAsId, "?period=mtd")),
    ]);
    const pastMonth = unwrap<KpiLivePayload>(pastMonthRes);
    const mtd = unwrap<KpiLivePayload>(mtdRes);
    if (!pastMonth && !mtd) return null;
    const byId = new Map<string, KpiMetric>();
    for (const m of pastMonth?.metrics ?? []) byId.set(m.metric_id, m);
    for (const m of mtd?.metrics ?? []) {
      const existing = byId.get(m.metric_id);
      if (!existing) { byId.set(m.metric_id, m); continue; }
      const existingTrend = existing.trend_data ?? [];
      const newTrend = m.trend_data ?? [];
      const seenDates = new Set(existingTrend.map((p) => p.date));
      const mergedTrend = [
        ...existingTrend,
        ...newTrend.filter((p) => !seenDates.has(p.date)),
      ].sort((a, b) => a.date.localeCompare(b.date));
      byId.set(m.metric_id, {
        ...(m.actual_value !== null ? m : existing),
        trend_data: mergedTrend,
      });
    }
    return {
      overall_score: mtd?.overall_score ?? pastMonth?.overall_score ?? 0,
      overall_rating: mtd?.overall_rating ?? pastMonth?.overall_rating ?? null,
      metrics: Array.from(byId.values()),
    };
  } catch {
    return null;
  }
}

// ── Utility ───────────────────────────────────────────────────────────────────

/** Clamp 0–100, graceful NaN */
function clamp(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

function fmtPct(n: number): string {
  return `${Math.round(n * 10) / 10}%`;
}

function fmtValue(v: number | null, unit: string): string {
  if (v === null) return "—";
  if (unit === "seconds") {
    const m = Math.floor(v / 60);
    const s = Math.round(v % 60);
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }
  if (unit === "percent") return fmtPct(v);
  if (unit === "currency") return `₹${v.toLocaleString("en-IN")}`;
  return String(Math.round(v * 10) / 10);
}

const RATING_LABEL: Record<string, string> = { S: "Superstar", A: "Excellent", B: "Good", C: "Needs Improvement", D: "At Risk" };
const RATING_COLOR: Record<string, string> = {
  S: "bg-emerald-500 text-white",
  A: "bg-blue-500 text-white",
  B: "bg-amber-500 text-white",
  C: "bg-orange-500 text-white",
  D: "bg-red-500 text-white",
};

// ── Mini sparkline (SVG) ──────────────────────────────────────────────────────

function Sparkline({ values, color = "#10b981" }: { values: number[]; color?: string }) {
  if (values.length < 2) {
    return <div className="h-8 w-24 flex items-center justify-center text-xs text-muted-foreground">—</div>;
  }
  const W = 96, H = 32;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * W;
      const y = H - ((v - min) / range) * (H - 4) - 2;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg width={W} height={H} className="overflow-visible flex-shrink-0">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {values.map((v, i) => {
        const [x, y] = pts.split(" ")[i].split(",");
        return <circle key={i} cx={x} cy={y} r="2.5" fill={color} />;
      })}
    </svg>
  );
}

// ── Panel 1: Quality Score ────────────────────────────────────────────────────

function QualityPanel({ data, loading }: { data: CQScorePayload | null; loading: boolean }) {
  if (loading) return <PanelSkeleton rows={3} />;
  if (!data || data.cq_score_current === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
        <Shield className="h-8 w-8 opacity-30" />
        <p className="text-sm">No quality data available yet</p>
      </div>
    );
  }

  const score = data.cq_score_current;
  const teamAvg = data.peer_avg ?? 0;
  const diff = score - teamAvg;

  const ringColor = score >= 90 ? "text-emerald-500" : score >= 85 ? "text-amber-500" : "text-red-500";
  const ringBg   = score >= 90 ? "bg-emerald-50 border-emerald-200" : score >= 85 ? "bg-amber-50 border-amber-200" : "bg-red-50 border-red-200";

  const weeklyVals = (data.weekly ?? []).map((w) => w.avg ?? 0).slice(-4);
  const sparkColor = score >= 90 ? "#10b981" : score >= 85 ? "#f59e0b" : "#ef4444";

  return (
    <div className="space-y-4">
      {/* Big number + ring */}
      <div className={`flex items-center gap-4 p-3 rounded-xl border ${ringBg}`}>
        <div className={`text-4xl font-extrabold tabular-nums ${ringColor}`}>
          {fmtPct(score)}
        </div>
        <div className="flex-1 space-y-1">
          <p className="text-xs text-muted-foreground font-medium">This Week's CQ Score</p>
          {/* vs team avg badge */}
          <div className="flex items-center gap-1.5">
            {diff > 0 ? (
              <Badge variant="outline" className="text-emerald-700 border-emerald-300 bg-emerald-50 text-xs gap-1">
                <ArrowUp className="h-3 w-3" />+{fmtPct(diff)} vs team
              </Badge>
            ) : diff < 0 ? (
              <Badge variant="outline" className="text-red-700 border-red-300 bg-red-50 text-xs gap-1">
                <ArrowDown className="h-3 w-3" />{fmtPct(diff)} vs team
              </Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground text-xs gap-1">
                <Minus className="h-3 w-3" />On par with team
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* 4-week sparkline */}
      {weeklyVals.length >= 2 && (
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground whitespace-nowrap">Last 4 wks</span>
          <Sparkline values={weeklyVals} color={sparkColor} />
          <span className="text-xs font-medium tabular-nums">{fmtPct(weeklyVals[weeklyVals.length - 1])}</span>
        </div>
      )}

      {/* Target bar */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Progress to target ({fmtPct(data.target ?? 90)})</span>
          <span className="font-semibold text-foreground">{fmtPct(clamp((score / (data.target || 90)) * 100))}</span>
        </div>
        <Progress
          value={clamp((score / (data.target || 90)) * 100)}
          className={`h-2 ${score >= 90 ? "[&>div]:bg-emerald-500" : score >= 85 ? "[&>div]:bg-amber-500" : "[&>div]:bg-red-500"}`}
        />
      </div>
    </div>
  );
}

// ── Panel 2: KPI Scorecard ────────────────────────────────────────────────────

const STATUS_DOT: Record<string, string> = {
  on_track: "bg-emerald-500",
  at_risk: "bg-amber-500",
  below_target: "bg-red-500",
  exceeded: "bg-blue-500",
};

function KpiScorecardPanel({ data, loading }: { data: KpiLivePayload | null; loading: boolean }) {
  if (loading) return <PanelSkeleton rows={5} />;
  if (!data || !data.metrics?.length) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
        <AlertTriangle className="h-8 w-8 opacity-30" />
        <p className="text-sm">No KPI scorecard assigned yet</p>
        <p className="text-xs">Contact your manager or HR to set up your KPI template.</p>
      </div>
    );
  }

  const overallRating = data.overall_rating;
  const overallScore  = data.overall_score ?? 0;
  const ratingClass   = overallRating ? (RATING_COLOR[overallRating] ?? "bg-gray-400 text-white") : "bg-gray-300 text-gray-600";
  const ratingLabel   = overallRating ? (RATING_LABEL[overallRating] ?? overallRating) : "No rating";

  return (
    <div className="space-y-3">
      {/* Metric rows */}
      <div className="divide-y divide-border rounded-lg border overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 px-3 py-1.5 bg-muted/40 text-xs text-muted-foreground font-medium">
          <span>Metric</span>
          <span className="text-right w-14">My Value</span>
          <span className="text-right w-14">Target</span>
          <span className="text-right w-10">Ach%</span>
          <span className="w-2" />
        </div>
        {data.metrics.map((m) => {
          const dotClass = STATUS_DOT[m.score_status] ?? "bg-gray-300";
          return (
            <div
              key={m.metric_id}
              className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 px-3 py-2 items-center hover:bg-muted/20 transition-colors"
            >
              <span className="flex items-center gap-1.5 min-w-0">
                <span className="text-sm font-medium truncate">{m.metric_name}</span>
                {typeof m.percentile === "number" && (
                  <span
                    className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                      m.percentile >= 90 ? "bg-emerald-100 text-emerald-700"
                      : m.percentile >= 50 ? "bg-blue-100 text-blue-700"
                      : "bg-amber-100 text-amber-700"
                    }`}
                    title={`Beating ${m.percentile}% of peers in the same role this period`}
                  >
                    {m.percentile}th pctl
                  </span>
                )}
              </span>
              <span className="text-sm tabular-nums text-right w-14">{fmtValue(m.actual_value, m.unit)}</span>
              <span className="text-xs text-muted-foreground tabular-nums text-right w-14">{fmtValue(m.target_value, m.unit)}</span>
              <span className="text-xs font-semibold tabular-nums text-right w-10">
                {m.actual_value !== null ? `${Math.round(m.score_pct)}%` : "—"}
              </span>
              <span className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${dotClass}`} />
            </div>
          );
        })}
      </div>

      {/* Composite score footer */}
      <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2.5">
        <div className="space-y-0.5">
          <p className="text-xs text-muted-foreground">Overall Composite Score</p>
          <p className="text-lg font-bold tabular-nums">{fmtPct(overallScore)}</p>
        </div>
        {overallRating && (
          <div className="flex flex-col items-center gap-0.5">
            <span className={`text-sm font-bold px-3 py-1.5 rounded-full ${ratingClass}`}>{overallRating}</span>
            <span className="text-xs text-muted-foreground">{ratingLabel}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Panel 3: TNI ──────────────────────────────────────────────────────────────

const IMPROVEMENT_TIPS: Record<string, string> = {
  opening:       "Practice your greeting script. Focus on establishing rapport in the first 30 seconds.",
  soft_skills:   "Enroll in the Active Listening module in your LMS.",
  hold_procedure:"Review the hold etiquette SOP — always ask before placing on hold.",
  resolution:    "Shadow a top-performer call to study resolution patterns.",
  closing:       "Practice the 3-step close: summarise, confirm satisfaction, thank.",
};

function getTip(name: string): string {
  const key = name.toLowerCase().replace(/[^a-z_]/g, "_");
  return IMPROVEMENT_TIPS[key] ?? "Discuss with your Quality Coach for targeted guidance.";
}

function TniPanel({
  data,
  loading,
  onViewReport,
}: {
  data: WeaknessPayload | null;
  loading: boolean;
  onViewReport: () => void;
}) {
  if (loading) return <PanelSkeleton rows={3} />;

  // Flatten sub-metrics with pass rate < 70%
  const tniItems: Array<{ name: string; pct: number; tip: string }> = [];
  for (const area of data?.weakness_areas ?? []) {
    for (const sm of area.sub_metrics ?? []) {
      if (sm.score < 70) {
        tniItems.push({ name: sm.name, pct: sm.score, tip: getTip(sm.name) });
      }
    }
  }

  if (!tniItems.length) {
    return (
      <div className="flex flex-col items-center justify-center py-6 gap-2 text-emerald-600">
        <CheckCircle2 className="h-9 w-9" />
        <p className="text-sm font-semibold">All quality parameters on track!</p>
        <p className="text-xs text-muted-foreground">Keep it up — every call counts.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {tniItems.map((item) => (
        <div key={item.name} className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-amber-900 capitalize">{item.name.replace(/_/g, " ")}</span>
            <Badge variant="outline" className="text-amber-700 border-amber-400 text-xs">
              {fmtPct(item.pct)} pass rate
            </Badge>
          </div>
          <p className="text-xs text-amber-800 leading-relaxed">{item.tip}</p>
          <div className="h-1.5 bg-amber-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-400 rounded-full"
              style={{ width: `${clamp(item.pct)}%` }}
            />
          </div>
        </div>
      ))}

      <button
        onClick={onViewReport}
        className="flex items-center gap-1 text-xs text-primary hover:underline mt-1"
      >
        View my full quality report <ChevronRight className="h-3 w-3" />
      </button>
    </div>
  );
}

// ── Panel 4: Quick Actions ────────────────────────────────────────────────────

function QuickActionsPanel() {
  const navigate = useNavigate();

  const actions = [
    {
      label: "Apply for Leave",
      icon: <Calendar className="h-4 w-4" />,
      route: "/leaves",
      variant: "outline" as const,
    },
    {
      label: "View My Payslip",
      icon: <CreditCard className="h-4 w-4" />,
      route: "/payslip-center",
      variant: "outline" as const,
    },
    {
      label: "View My Roster",
      icon: <Shield className="h-4 w-4" />,
      route: "/my-roster",
      variant: "outline" as const,
    },
    {
      label: "My Training",
      icon: <BookOpen className="h-4 w-4" />,
      route: "/lms-my-learning",
      variant: "outline" as const,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-2">
      {actions.map((a) => (
        <Button
          key={a.label}
          variant={a.variant}
          size="sm"
          className="h-auto py-3 flex-col gap-1.5 text-xs font-medium"
          onClick={() => navigate(a.route)}
        >
          <span className="text-muted-foreground">{a.icon}</span>
          {a.label}
        </Button>
      ))}
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

// ── Panel: Performance Trends (daily line charts) ──────────────────────────────
//
// The point of this panel: a single "78%" number doesn't tell anyone whether they're
// getting better or worse. A daily line — with the target drawn in, and an explicit
// "Improving" / "Needs attention" call-out — turns the score into a story someone is
// motivated to keep climbing, which a flat scorecard row can't do.

function formatTrendDate(d: string): string {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

function trendDirectionLabel(
  points: KpiTrendPoint[],
  direction: string,
): { label: string; color: string } | null {
  if (points.length < 4) return null;
  const mid = Math.floor(points.length / 2);
  const avg = (arr: KpiTrendPoint[]) => arr.reduce((s, p) => s + p.value, 0) / (arr.length || 1);
  const delta = avg(points.slice(mid)) - avg(points.slice(0, mid));
  if (Math.abs(delta) < 0.01) return { label: "Holding steady", color: "text-muted-foreground border-muted-foreground/30" };
  const improving = direction === "lower_better" ? delta < 0 : delta > 0;
  return improving
    ? { label: "Improving", color: "text-emerald-600 border-emerald-300 bg-emerald-50" }
    : { label: "Needs attention", color: "text-amber-600 border-amber-300 bg-amber-50" };
}

function MetricTrendChart({ metric, color }: { metric: KpiMetric | undefined; color: string }) {
  if (!metric || !metric.trend_data || metric.trend_data.length < 2) {
    return (
      <div className="flex h-40 flex-col items-center justify-center gap-2 text-muted-foreground">
        <TrendingUp className="h-6 w-6 opacity-30" />
        <p className="text-xs">Not enough data yet for a trend</p>
      </div>
    );
  }

  const points = [...metric.trend_data].sort((a, b) => a.date.localeCompare(b.date));
  const chartData = points.map((p) => ({ date: formatTrendDate(p.date), value: Math.round(p.value * 100) / 100 }));
  const trend = trendDirectionLabel(points, metric.direction);
  const latest = points[points.length - 1].value;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <div>
          <p className="text-xs font-medium text-muted-foreground">{metric.metric_name}</p>
          <p className="text-2xl font-extrabold tabular-nums" style={{ color }}>{fmtValue(latest, metric.unit)}</p>
        </div>
        {trend && (
          <Badge variant="outline" className={`text-xs ${trend.color}`}>
            {trend.label}
          </Badge>
        )}
      </div>
      <ResponsiveContainer width="100%" height={140}>
        <LineChart data={chartData} margin={{ top: 5, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
          <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 10 }} width={36} />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 8 }}
            formatter={(v: number) => [fmtValue(v, metric.unit), metric.metric_name]}
          />
          {metric.target_value ? (
            <ReferenceLine
              y={metric.target_value}
              stroke="#94a3b8"
              strokeDasharray="4 4"
              label={{ value: "Target", fontSize: 10, fill: "#94a3b8", position: "insideTopRight" }}
            />
          ) : null}
          <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2.5} dot={{ r: 2 }} activeDot={{ r: 4 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function TrendsPanel({ data, loading }: { data: KpiLivePayload | null; loading: boolean }) {
  if (loading) return <PanelSkeleton rows={4} />;
  const qualityMetric = data?.metrics?.find((m) => m.metric_code === "QUALITY_SCORE");
  const ahtMetric = data?.metrics?.find((m) => m.metric_code === "AHT");
  if (!qualityMetric && !ahtMetric) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
        <TrendingUp className="h-8 w-8 opacity-30" />
        <p className="text-sm">No trend data available yet — check back once you have more scored calls.</p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      <MetricTrendChart metric={qualityMetric} color="#10b981" />
      <MetricTrendChart metric={ahtMetric} color="#3b82f6" />
    </div>
  );
}

function PanelSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3 animate-pulse">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-8 rounded bg-muted" />
      ))}
    </div>
  );
}

// ── Root component ────────────────────────────────────────────────────────────

export interface MyPerformanceTileProps {
  /** Override title (default: "My Performance") */
  title?: string;
  /** Hide the quality panel (useful for non-call-centre roles) */
  hideQuality?: boolean;
  /** Hide the KPI panel */
  hideKpi?: boolean;
  /** Callback when "View my full quality report" is clicked */
  onViewQualityReport?: () => void;
}

export default function MyPerformanceTile({
  title = "My Performance",
  hideQuality = false,
  hideKpi = false,
  onViewQualityReport,
}: MyPerformanceTileProps) {
  const navigate = useNavigate();
  const { activeEmployee } = useViewAs();
  const viewAsId = activeEmployee?.id;

  const handleViewReport = onViewQualityReport ?? (() => navigate("/agent-quality-dashboard"));

  // Parallel queries — only what we need.
  // cq-score/weakness-detail have no manager-scoped variant on the backend (checked
  // — only /api/kpi-master/live/:empId exists), so those two stay self-scoped even
  // while impersonating; only the KPI queries below are View-As-aware.
  const [cqQuery, weaknessQuery, kpiQuery, trendQuery] = useQueries({
    queries: [
      {
        queryKey: ["my-performance-tile", "cq-score"],
        queryFn: fetchCqScore,
        staleTime: 5 * 60 * 1000,
        gcTime: 10 * 60 * 1000,
        retry: 1,
        enabled: !hideQuality,
      },
      {
        queryKey: ["my-performance-tile", "weakness"],
        queryFn: fetchWeakness,
        staleTime: 10 * 60 * 1000,
        gcTime: 15 * 60 * 1000,
        retry: 1,
        enabled: !hideQuality,
      },
      {
        queryKey: ["my-performance-tile", "kpi-live", viewAsId],
        queryFn: () => fetchKpiLive(viewAsId),
        staleTime: 5 * 60 * 1000,
        gcTime: 10 * 60 * 1000,
        retry: 1,
        enabled: !hideKpi,
      },
      {
        queryKey: ["my-performance-tile", "kpi-trend", viewAsId],
        queryFn: () => fetchKpiTrend(viewAsId),
        staleTime: 15 * 60 * 1000,
        gcTime: 30 * 60 * 1000,
        retry: 1,
        enabled: !hideKpi,
      },
    ],
  });

  const isAnyLoading = cqQuery.isFetching || weaknessQuery.isFetching || kpiQuery.isFetching || trendQuery.isFetching;

  function handleRefresh() {
    if (!hideQuality) { cqQuery.refetch(); weaknessQuery.refetch(); }
    if (!hideKpi)     { kpiQuery.refetch(); trendQuery.refetch(); }
  }

  return (
    <div className="space-y-4">
      {/* Tile header */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground"
          onClick={handleRefresh}
          disabled={isAnyLoading}
          title="Refresh performance data"
        >
          <RefreshCw className={`h-4 w-4 ${isAnyLoading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Trends — full width, above the scorecard grid so it's the first thing seen */}
      {!hideKpi && (
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-emerald-500" />
              My Performance Trends — Recent
              {trendQuery.isFetching && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-auto" />}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <TrendsPanel data={trendQuery.data ?? null} loading={trendQuery.isLoading} />
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Panel 1 — Quality Score */}
        {!hideQuality && (
          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Shield className="h-4 w-4 text-emerald-500" />
                My Quality Score
                {cqQuery.isFetching && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-auto" />}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <QualityPanel data={cqQuery.data ?? null} loading={cqQuery.isLoading} />
            </CardContent>
          </Card>
        )}

        {/* Panel 2 — KPI Scorecard */}
        {!hideKpi && (
          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                My KPI Scorecard
                {kpiQuery.isFetching && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-auto" />}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <KpiScorecardPanel data={kpiQuery.data ?? null} loading={kpiQuery.isLoading} />
            </CardContent>
          </Card>
        )}

        {/* Panel 3 — TNI */}
        {!hideQuality && (
          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-blue-500" />
                What I Need to Improve
                {weaknessQuery.isFetching && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-auto" />}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <TniPanel
                data={weaknessQuery.data ?? null}
                loading={weaknessQuery.isLoading}
                onViewReport={handleViewReport}
              />
            </CardContent>
          </Card>
        )}

        {/* Panel 4 — Quick Actions */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              My Quick Actions
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <QuickActionsPanel />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
