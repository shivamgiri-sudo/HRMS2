import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, Minus, Loader, RefreshCcw, Activity, CalendarDays } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { hrmsApi } from "@/lib/hrmsApi";

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

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({ metric }: { metric: KpiMetricResult }) {
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

  function formatValue(v: number | null, unit: string): string {
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

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-col gap-3 hover:shadow-md transition-shadow">
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
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function MyKpiDashboard() {
  const [period, setPeriod] = useState<Period>("day");
  const [selectedDate, setSelectedDate] = useState(today());
  const [data, setData] = useState<LivePerformanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noKpis, setNoKpis] = useState(false);

  async function loadData(p: Period) {
    setLoading(true);
    setError(null);
    setNoKpis(false);
    try {
      const dateQuery = p === "day" ? `&date=${selectedDate}` : "";
      const res = await hrmsApi.get<{ success: boolean; data: LivePerformanceData }>(`/api/kpi-master/live?period=${p}${dateQuery}`);
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
  }, [period, selectedDate]);

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
                    <KpiCard key={m.metric_id} metric={m} />
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
    </DashboardLayout>
  );
}
