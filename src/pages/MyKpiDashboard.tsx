import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, Minus, Loader, RefreshCcw, Activity, CalendarDays, X, ArrowUpRight, ArrowDownRight, Users } from "lucide-react";
import {
  Line, LineChart, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";
import { AIInsightPanel } from "@/components/ai";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useViewAs } from "@/contexts/ViewAsContext";

// GET /api/kpi-master/live always resolves to the REAL logged-in user's own linked
// employee record (getEmployeeForUser(req.authUser.id) in kpi-master.routes.ts) —
// confirmed live: switching "View As" showed this page's OWN manager's attendance
// data relabeled under the impersonated employee's name, not that employee's real
// data. /live/:empId exists specifically for this (manager-scoped, enforces
// canViewEmployeePerformance) — route there whenever a View As target is active.
function liveKpiUrl(activeEmployeeId: string | undefined, query: string): string {
  return activeEmployeeId
    ? `/api/kpi-master/live/${activeEmployeeId}${query}`
    : `/api/kpi-master/live${query}`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Period = "day" | "wtd" | "mtd" | "past_month";

interface TrendPoint {
  date: string;
  value: number;
  source: string;
}

interface KpiMetricResult {
  metric_id: string;
  metric_code: string;
  metric_name: string;
  category: string;
  unit: string;
  direction: string;
  family: string;
  target_value: number;
  min_threshold: number | null;
  actual_value: number | null;
  score_pct: number;
  score_status: string;
  rating: string | null;
  rating_color: string | null;
  resolved_from: string;
  trend_data: TrendPoint[];
  // Peer comparison — same process+designation (falling back to designation,
  // then department) over the same period. null when there's no meaningful
  // peer group (e.g. fewer than 2 peers) rather than a misleading 0/100.
  peer_avg: number | null;
  peer_count: number | null;
  percentile: number | null;
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

const CATEGORY_COLORS: Record<string, string> = {
  operations: "bg-blue-100 text-blue-700",
  quality: "bg-green-100 text-green-700",
  hr: "bg-purple-100 text-purple-700",
  sales: "bg-orange-100 text-orange-700",
  custom: "bg-gray-100 text-gray-700",
};

const RATING_BG: Record<string, string> = {
  S: "bg-emerald-500",
  A: "bg-blue-500",
  B: "bg-amber-500",
  C: "bg-orange-500",
  D: "bg-red-500",
};

function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// Combines two /api/kpi-master/live responses (past_month + mtd) into one, merging
// each metric's trend_data by metric_id and de-duplicating by date. Summary fields
// (actual_value, target, rating) come from whichever side actually resolved the
// metric — mtd preferred as the more current period — since trendData here is only
// ever read for its per-metric trend_data, not its own overall_score/date_range.
function mergeTrendPeriods(
  pastMonth: LivePerformanceData | null | undefined,
  mtd: LivePerformanceData | null | undefined,
): LivePerformanceData | null {
  if (!pastMonth && !mtd) return null;
  const byId = new Map<string, KpiMetricResult>();
  for (const m of pastMonth?.metrics ?? []) byId.set(m.metric_id, m);
  for (const m of mtd?.metrics ?? []) {
    const existing = byId.get(m.metric_id);
    if (!existing) {
      byId.set(m.metric_id, m);
      continue;
    }
    const seenDates = new Set(existing.trend_data.map((p) => p.date));
    const mergedTrend = [
      ...existing.trend_data,
      ...m.trend_data.filter((p) => !seenDates.has(p.date)),
    ].sort((a, b) => a.date.localeCompare(b.date));
    // Prefer mtd's own actual/score fields when it has data — it's the more
    // current period — but always keep the merged trend_data either way.
    byId.set(m.metric_id, {
      ...(m.actual_value !== null ? m : existing),
      trend_data: mergedTrend,
    });
  }
  return {
    period: mtd?.period ?? pastMonth?.period ?? "mtd",
    date_range: {
      start: pastMonth?.date_range.start ?? mtd?.date_range.start ?? "",
      end: mtd?.date_range.end ?? pastMonth?.date_range.end ?? "",
    },
    overall_score: mtd?.overall_score ?? pastMonth?.overall_score ?? 0,
    overall_rating: mtd?.overall_rating ?? pastMonth?.overall_rating ?? null,
    overall_rating_color: mtd?.overall_rating_color ?? pastMonth?.overall_rating_color ?? null,
    metrics: Array.from(byId.values()),
    daily_performance: [...(pastMonth?.daily_performance ?? []), ...(mtd?.daily_performance ?? [])],
  };
}

function formatMetricValue(value: number, unit: string) {
  if (unit === "seconds") return `${Math.round(value)} sec`;
  if (unit === "percent") return `${Math.round(value * 10) / 10}%`;
  if (unit === "currency") return `₹${value.toLocaleString()}`;
  return String(Math.round(value * 10) / 10);
}

// ─── Sparkline ────────────────────────────────────────────────────────────────

function Sparkline({ data, color }: { data: TrendPoint[]; color: string }) {
  if (!data.length) return <div className="h-10 flex items-center justify-center text-xs text-gray-300">No data</div>;

  const values = data.map(d => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = 120;
  const h = 36;
  const pts = values.map((v, i) => {
    const x = (i / Math.max(values.length - 1, 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x},${y}`;
  });

  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline
        points={pts.join(" ")}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {pts.map((pt, i) => {
        const [x, y] = pt.split(",");
        return <circle key={i} cx={x} cy={y} r="2" fill={color} />;
      })}
    </svg>
  );
}

// ─── Featured trend chart (full line graph, not a sparkline) ──────────────────
//
// Purpose-built to motivate: a real line with the target drawn in and an explicit
// "Improving" / "Needs attention" call-out reads as a story someone wants to keep
// climbing, in a way the per-card sparklines above don't. Always fetched over the
// last 30 days regardless of the page's own period filter (day/wtd/mtd), since a
// single day's trend_data is one point — not a trend a person can read.

function formatTrendDate(d: string): string {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

function trendDirectionLabel(points: TrendPoint[], direction: string): { label: string; className: string } | null {
  if (points.length < 4) return null;
  const mid = Math.floor(points.length / 2);
  const avg = (arr: TrendPoint[]) => arr.reduce((s, p) => s + p.value, 0) / (arr.length || 1);
  const delta = avg(points.slice(mid)) - avg(points.slice(0, mid));
  if (Math.abs(delta) < 0.01) return { label: "Holding steady", className: "text-gray-500 border-gray-300 bg-gray-50" };
  const improving = direction === "lower_is_better" ? delta < 0 : delta > 0;
  return improving
    ? { label: "Improving", className: "text-emerald-700 border-emerald-300 bg-emerald-50" }
    : { label: "Needs attention", className: "text-amber-700 border-amber-300 bg-amber-50" };
}

function FeaturedTrendChart({ metric, color }: { metric: KpiMetricResult | undefined; color: string }) {
  if (!metric) {
    return (
      <div className="flex h-48 flex-col items-center justify-center gap-2 text-gray-400">
        <TrendingUp className="h-6 w-6 opacity-30" />
        <p className="text-xs">This metric isn't assigned to you</p>
      </div>
    );
  }
  if (!metric.trend_data?.length || metric.trend_data.length < 2) {
    return (
      <div className="flex h-48 flex-col items-center justify-center gap-2 text-gray-400">
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
          <p className="text-xs font-medium text-gray-500">{metric.metric_name}</p>
          <p className="text-2xl font-bold tabular-nums" style={{ color }}>{formatMetricValue(latest, metric.unit)}</p>
        </div>
        {trend && (
          <span className={`text-xs font-medium px-2 py-1 rounded-full border ${trend.className}`}>{trend.label}</span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={chartData} margin={{ top: 5, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
          <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 10 }} width={36} />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 8 }}
            formatter={(v: number) => [formatMetricValue(v, metric.unit), metric.metric_name]}
          />
          {metric.target_value ? (
            <ReferenceLine
              y={metric.target_value}
              stroke="#9ca3af"
              strokeDasharray="4 4"
              label={{ value: "Target", fontSize: 10, fill: "#9ca3af", position: "insideTopRight" }}
            />
          ) : null}
          <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2.5} dot={{ r: 2 }} activeDot={{ r: 4 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function formatMetricUnitValue(v: number | null, unit: string): string {
  if (v === null) return "—";
  if (unit === "seconds") {
    const m = Math.floor(v / 60);
    const s = Math.round(v % 60);
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }
  if (unit === "percent") return `${Math.round(v * 10) / 10}%`;
  if (unit === "currency") return `₹${v.toLocaleString()}`;
  return String(Math.round(v * 10) / 10);
}

// percentile = share of same-job peers this period's average beats or ties
// (direction-aware — see computePercentile on the backend). "Beating X% of
// peers" reads unambiguously at every value, unlike "top/above/below" framing
// which flips confusingly depending on which side of 50 the number lands on.
function peerPercentileLabel(percentile: number): { text: string; tone: string } {
  if (percentile >= 90) return { text: `Top of the team — beating ${percentile}% of peers`, tone: "text-emerald-700 bg-emerald-50" };
  if (percentile >= 50) return { text: `Beating ${percentile}% of peers`, tone: "text-blue-700 bg-blue-50" };
  return { text: `Beating ${percentile}% of peers`, tone: "text-amber-700 bg-amber-50" };
}

function KpiCard({ metric, onOpenDrillDown }: { metric: KpiMetricResult; onOpenDrillDown: (metricId: string) => void }) {
  const hasData = metric.actual_value !== null;
  const isLower = metric.direction === "lower_is_better";
  const ratingBg = metric.rating ? RATING_BG[metric.rating] ?? "bg-gray-400" : "bg-gray-300";
  const sparkColor = metric.rating === "S" || metric.rating === "A" ? "#10b981"
    : metric.rating === "B" ? "#f59e0b"
    : "#ef4444";
  const barWidth = Math.min(metric.score_pct, 100);
  const barColor = metric.score_pct >= 90 ? "bg-emerald-500"
    : metric.score_pct >= 75 ? "bg-amber-500"
    : "bg-red-500";

  const formatValue = formatMetricUnitValue;

  return (
    <button
      type="button"
      onClick={() => onOpenDrillDown(metric.metric_id)}
      className="text-left bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-col gap-3 hover:shadow-md hover:border-indigo-300 transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2"
      aria-label={`View daily drill-down for ${metric.metric_name}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-gray-900 text-sm truncate">{metric.metric_name}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CATEGORY_COLORS[metric.category] ?? "bg-gray-100 text-gray-700"}`}>
              {CATEGORY_LABELS[metric.category] ?? metric.category}
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-0.5">
            {metric.metric_code} · via {metric.resolved_from}
            {isLower ? " · lower is better" : ""}
          </p>
        </div>
        {metric.rating && (
          <span className={`${ratingBg} text-white text-sm font-bold w-8 h-8 flex items-center justify-center rounded-full flex-shrink-0`}>
            {metric.rating}
          </span>
        )}
      </div>

      {/* Values */}
      <div className="flex items-end gap-3">
        <div>
          <div className="text-2xl font-bold text-gray-900 leading-tight">
            {formatValue(metric.actual_value, metric.unit)}
          </div>
          <div className="text-xs text-gray-400 mt-0.5">
            Target: {formatValue(metric.target_value, metric.unit)}
          </div>
        </div>
        <div className="flex-1 pb-1">
          <Sparkline data={metric.trend_data} color={hasData ? sparkColor : "#e5e7eb"} />
        </div>
      </div>

      {/* Progress bar */}
      {hasData && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-500">Score</span>
            <span className="font-semibold text-gray-700">{Math.round(metric.score_pct)}%</span>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${barColor}`}
              style={{ width: `${barWidth}%` }}
            />
          </div>
        </div>
      )}

      {!hasData && (
        <div className="text-xs text-gray-400 text-center py-1">No data available for this period</div>
      )}

      {/* Peer comparison — same process+designation, same period. Only shown
          when there's a meaningful peer group (backend returns null otherwise,
          e.g. a role with just 1 person in it). */}
      {hasData && metric.percentile !== null && metric.peer_count !== null && (
        <div className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium ${peerPercentileLabel(metric.percentile).tone}`}>
          <Users className="h-3 w-3 flex-shrink-0" />
          <span className="truncate">{peerPercentileLabel(metric.percentile).text}</span>
          <span className="ml-auto flex-shrink-0 opacity-70">of {metric.peer_count}</span>
        </div>
      )}

      <div className="flex items-center justify-end gap-1 text-xs font-medium text-indigo-600 -mb-1">
        View daily breakdown <ArrowUpRight className="h-3 w-3" />
      </div>
    </button>
  );
}

// ─── Metric Drill-Down Dialog ───────────────────────────────────────────────────
//
// Reuses trend_data already returned by the /live endpoint (30-day window fetched
// separately from the card grid's own period filter, same as the featured charts
// above) — no new backend endpoint needed. Clicking a card zooms into that one
// metric: full-size trend, min/best/worst days, and a per-day value table.

function MetricDrillDownDialog({ metric, onClose }: { metric: KpiMetricResult | null; onClose: () => void }) {
  if (!metric) return null;
  const points = [...(metric.trend_data ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const chartData = points.map((p) => ({ date: formatTrendDate(p.date), value: Math.round(p.value * 100) / 100 }));
  const values = points.map((p) => p.value);
  const isLower = metric.direction === "lower_is_better";
  const best = values.length ? (isLower ? Math.min(...values) : Math.max(...values)) : null;
  const worst = values.length ? (isLower ? Math.max(...values) : Math.min(...values)) : null;
  const avg = values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
  const trend = trendDirectionLabel(points, metric.direction);

  return (
    <Dialog open={!!metric} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {metric.metric_name}
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CATEGORY_COLORS[metric.category] ?? "bg-gray-100 text-gray-700"}`}>
              {CATEGORY_LABELS[metric.category] ?? metric.category}
            </span>
          </DialogTitle>
          <DialogDescription>
            {metric.metric_code} · via {metric.resolved_from} · {isLower ? "lower is better" : "higher is better"}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs text-gray-500">Current</p>
            <p className="text-lg font-bold text-gray-900">{formatMetricUnitValue(metric.actual_value, metric.unit)}</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs text-gray-500">Target</p>
            <p className="text-lg font-bold text-gray-900">{formatMetricUnitValue(metric.target_value, metric.unit)}</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs text-gray-500">Best day (30d)</p>
            <p className="text-lg font-bold text-emerald-700">{formatMetricUnitValue(best, metric.unit)}</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs text-gray-500">Worst day (30d)</p>
            <p className="text-lg font-bold text-red-700">{formatMetricUnitValue(worst, metric.unit)}</p>
          </div>
        </div>

        {trend && (
          <div className={`flex items-center gap-1.5 text-sm font-medium ${trend.className.split(" ")[0]}`}>
            {trend.label === "Needs attention" ? <ArrowDownRight className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
            {trend.label} over the last 30 days (avg {formatMetricUnitValue(avg, metric.unit)})
          </div>
        )}

        {metric.percentile !== null && metric.peer_avg !== null && metric.peer_count !== null && (
          <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${peerPercentileLabel(metric.percentile).tone}`}>
            <Users className="h-4 w-4 flex-shrink-0" />
            <span>
              {peerPercentileLabel(metric.percentile).text} in your role — peer average is{" "}
              {formatMetricUnitValue(metric.peer_avg, metric.unit)} across {metric.peer_count} people doing the same job this period.
            </span>
          </div>
        )}

        {chartData.length >= 2 ? (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData} margin={{ top: 5, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10 }} width={36} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
                formatter={(v: number) => [formatMetricUnitValue(v, metric.unit), metric.metric_name]}
              />
              {metric.target_value ? (
                <ReferenceLine
                  y={metric.target_value}
                  stroke="#9ca3af"
                  strokeDasharray="4 4"
                  label={{ value: "Target", fontSize: 10, fill: "#9ca3af", position: "insideTopRight" }}
                />
              ) : null}
              <Line type="monotone" dataKey="value" stroke="#4f46e5" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-32 items-center justify-center text-sm text-gray-400">
            Not enough daily data yet for a trend chart
          </div>
        )}

        {points.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Value</th>
                  <th className="px-3 py-2">Source</th>
                </tr>
              </thead>
              <tbody>
                {[...points].reverse().map((p) => (
                  <tr key={p.date} className="border-t border-gray-100">
                    <td className="px-3 py-2 font-medium text-gray-900">{p.date}</td>
                    <td className="px-3 py-2">{formatMetricUnitValue(p.value, metric.unit)}</td>
                    <td className="px-3 py-2 text-gray-500">{p.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function MyKpiDashboard() {
  const { activeEmployee } = useViewAs();
  const viewAsId = activeEmployee?.id;
  const [period, setPeriod] = useState<Period>("day");
  const [selectedDate, setSelectedDate] = useState(today());
  const [data, setData] = useState<LivePerformanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noKpis, setNoKpis] = useState(false);
  // Independent of `period` above — the featured trend charts always want a real
  // multi-week window, not whatever the card grid's own filter happens to be set to.
  const [trendData, setTrendData] = useState<LivePerformanceData | null>(null);
  // Which metric card's drill-down dialog is open, by id — not the metric object
  // itself, because the dialog merges the card grid's current-period stats (actual/
  // target/rating "now") with the always-30-day trendData's trend_data for the chart,
  // so the dialog isn't nearly empty when the page filter is "Today" (1 data point).
  const [selectedMetricId, setSelectedMetricId] = useState<string | null>(null);

  async function loadTrend() {
    try {
      // getDateRange() on the backend defines past_month as the FIXED previous
      // calendar month (July 1-31 on an Aug 22 request), not a rolling 30-day
      // window — confirmed live: an agent with real August QUALITY_SCORE actuals
      // showed "not enough data" under past_month alone because none of those
      // rows fall in July. mtd (month-to-date) covers the current month instead,
      // so fetching both and merging trend_data per metric approximates a real
      // recent window without changing the shared period semantics other callers
      // of this endpoint rely on.
      const [pastMonthRes, mtdRes] = await Promise.all([
        hrmsApi.get<{ success: boolean; data: LivePerformanceData }>(liveKpiUrl(viewAsId, `?period=past_month`)),
        hrmsApi.get<{ success: boolean; data: LivePerformanceData }>(liveKpiUrl(viewAsId, `?period=mtd`)),
      ]);
      const merged = mergeTrendPeriods(pastMonthRes.data, mtdRes.data);
      setTrendData(merged);
    } catch {
      setTrendData(null);
    }
  }

  async function loadData(p: Period) {
    setLoading(true);
    setError(null);
    setNoKpis(false);
    try {
      const dateQuery = p === "day" ? `&date=${selectedDate}` : "";
      const res = await hrmsApi.get<{ success: boolean; data: LivePerformanceData }>(liveKpiUrl(viewAsId, `?period=${p}${dateQuery}`));
      if (!res.data?.metrics?.length) {
        setNoKpis(true);
        setData(null);
      } else {
        setData(res.data);
      }
    } catch (err: any) {
      setError(err?.message ?? "Failed to load KPI data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData(period);
  }, [period, selectedDate, viewAsId]);

  useEffect(() => {
    loadTrend();
  }, [viewAsId]);

  const overallRatingBg = data?.overall_rating ? RATING_BG[data.overall_rating] ?? "bg-gray-400" : "bg-gray-300";

  const groupedMetrics = data?.metrics.reduce((acc, m) => {
    const cat = m.category;
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(m);
    return acc;
  }, {} as Record<string, KpiMetricResult[]>) ?? {};

  return (
    <DashboardLayout>
      <div className="p-6 max-w-6xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Activity className="text-indigo-600" size={28} />
            <div>
              <h1 className="text-2xl font-bold text-gray-900">My KPI Performance</h1>
              <p className="text-sm text-gray-500 mt-0.5">Your live performance metrics across categories</p>
            </div>
          </div>
          <button
            onClick={() => loadData(period)}
            disabled={loading}
            className="flex items-center gap-2 text-gray-500 hover:text-indigo-600 transition-colors text-sm"
          >
            <RefreshCcw size={16} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        {/* Period Tabs */}
        <div className="flex gap-2">
          {(Object.entries(PERIOD_LABELS) as [Period, string][]).map(([p, label]) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                period === p
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "bg-white text-gray-600 border border-gray-200 hover:border-indigo-300"
              }`}
            >
              {label}
            </button>
          ))}
          {period === "day" && (
            <label className="flex items-center gap-2 rounded-lg border bg-white px-3 text-sm text-gray-600">
              <CalendarDays size={16} />
              <input
                type="date"
                value={selectedDate}
                max={today()}
                onChange={(event) => setSelectedDate(event.target.value)}
                className="bg-transparent py-2 outline-none"
              />
            </label>
          )}
        </div>

        {/* Featured trends — always last 30 days, independent of the period tabs above */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
          <div className="mb-3 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-emerald-600" />
            <h2 className="text-sm font-semibold text-gray-900">My Performance Trends — Recent</h2>
          </div>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <FeaturedTrendChart
              metric={trendData?.metrics.find((m) => m.metric_code === "QUALITY_SCORE")}
              color="#10b981"
            />
            <FeaturedTrendChart
              metric={trendData?.metrics.find((m) => m.metric_code === "AHT")}
              color="#3b82f6"
            />
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader className="animate-spin text-indigo-500" size={32} />
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
        )}

        {/* No KPIs assigned */}
        {!loading && !error && noKpis && (
          <div className="text-center py-20 text-gray-400">
            <Activity size={48} className="mx-auto mb-3 opacity-40" />
            <p className="text-lg font-medium text-gray-600">No KPIs assigned yet</p>
            <p className="text-sm mt-1">Your KPIs are defined based on your department, designation, process, or cost centre.</p>
            <p className="text-sm mt-1">Please contact HR or your manager to get KPIs configured for your role.</p>
          </div>
        )}

        {/* Dashboard */}
        {!loading && data && (
          <>
            {/* AI KPI Brief */}
            <AIInsightPanel
              contextType="performance_kpi"
              role="employee"
              title="Your KPI AI Brief"
              enabled={data !== null}
              data={{
                overall_score: data.overall_score,
                overall_rating: data.overall_rating,
                total_kpis: data.metrics.length,
                kpis_with_data: data.metrics.filter((m) => m.actual_value !== null).length,
                on_target_count: data.metrics.filter((m) => m.score_pct >= 90).length,
                below_60_count: data.metrics.filter((m) => m.score_pct < 60).length,
              }}
            />

            {/* Summary Bar */}
            <div className="bg-gradient-to-r from-indigo-600 to-indigo-700 rounded-2xl p-5 text-white">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                  <p className="text-indigo-200 text-sm">Overall Score — {PERIOD_LABELS[period]}</p>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-4xl font-bold">{Math.round(data.overall_score)}%</span>
                    {data.overall_rating && (
                      <span className={`${overallRatingBg} text-white text-xl font-bold w-12 h-12 flex items-center justify-center rounded-full shadow-lg`}>
                        {data.overall_rating}
                      </span>
                    )}
                  </div>
                  {data.date_range && (
                    <p className="text-indigo-200 text-xs mt-1">
                      {data.date_range.start} → {data.date_range.end}
                    </p>
                  )}
                </div>
                <div className="flex gap-6 text-center">
                  <div>
                    <div className="text-2xl font-bold">{data.metrics.length}</div>
                    <div className="text-indigo-200 text-xs">KPIs Tracked</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold">{data.metrics.filter(m => m.actual_value !== null).length}</div>
                    <div className="text-indigo-200 text-xs">With Data</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold">{data.metrics.filter(m => m.score_pct >= 90).length}</div>
                    <div className="text-indigo-200 text-xs">On Target</div>
                  </div>
                </div>
              </div>

              {/* Progress bar */}
              <div className="mt-4 h-2 bg-indigo-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-white rounded-full transition-all"
                  style={{ width: `${Math.min(data.overall_score, 100)}%` }}
                />
              </div>
            </div>

            {/* KPI Cards by category */}
            {Object.entries(groupedMetrics).map(([category, catMetrics]) => (
              <div key={category}>
                <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
                  {CATEGORY_LABELS[category] ?? category}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {catMetrics.map(m => (
                    <KpiCard key={m.metric_id} metric={m} onOpenDrillDown={setSelectedMetricId} />
                  ))}
                </div>
              </div>
            ))}

            <div className="overflow-auto rounded-2xl border border-gray-200 bg-white">
              <div className="border-b px-4 py-3">
                <h2 className="font-semibold text-gray-900">Day-wise performance details</h2>
              </div>
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Overall score</th>
                    <th className="px-4 py-3">Rating</th>
                    <th className="px-4 py-3">Metrics and source</th>
                  </tr>
                </thead>
                <tbody>
                  {data.daily_performance.length === 0 && (
                    <tr><td colSpan={4} className="px-4 py-10 text-center text-gray-400">No source data is available for this date or period.</td></tr>
                  )}
                  {data.daily_performance.map((day) => (
                    <tr key={day.date} className="border-t align-top">
                      <td className="px-4 py-3 font-medium text-gray-900">{day.date}</td>
                      <td className="px-4 py-3 font-bold">{Math.round(day.overall_score)}%</td>
                      <td className="px-4 py-3">{day.overall_rating ?? "—"}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          {day.metrics.map((metric) => (
                            <span key={metric.metric_id} className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-700">
                              {metric.metric_code}: {formatMetricValue(metric.actual_value, metric.unit)} · {metric.source}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <MetricDrillDownDialog
        metric={(() => {
          if (!selectedMetricId) return null;
          const current = data?.metrics.find(m => m.metric_id === selectedMetricId);
          const trended = trendData?.metrics.find(m => m.metric_id === selectedMetricId);
          if (!current && !trended) return null;
          // Prefer the current-period card's actual/target/rating (matches what the
          // user just clicked); fall back to the 30-day fetch's copy if this metric
          // wasn't resolved for the card grid's period, and always take trend_data
          // from the 30-day fetch since a "Today" filter would otherwise show 1 point.
          return {
            ...(current ?? trended!),
            trend_data: trended?.trend_data ?? current?.trend_data ?? [],
          };
        })()}
        onClose={() => setSelectedMetricId(null)}
      />
    </DashboardLayout>
  );
}
