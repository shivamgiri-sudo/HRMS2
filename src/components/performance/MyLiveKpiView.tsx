import { useEffect, useState } from "react";
import { Activity, CalendarDays, Loader2, RefreshCw } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";

type Period = "day" | "wtd" | "mtd" | "past_month";

interface DailyMetric {
  metric_id: string;
  metric_code: string;
  metric_name: string;
  unit: string;
  actual_value: number;
  target_value: number;
  score_pct: number;
  source: string;
}

interface LiveData {
  date_range: { start: string; end: string };
  overall_score: number;
  overall_rating: string | null;
  metrics: Array<{
    metric_id: string;
    metric_name: string;
    actual_value: number | null;
    target_value: number;
    score_pct: number;
    unit: string;
  }>;
  daily_performance: Array<{
    date: string;
    overall_score: number;
    overall_rating: string | null;
    metrics: DailyMetric[];
  }>;
}

const periodLabels: Record<Period, string> = {
  day: "Day",
  wtd: "Week to date",
  mtd: "Month to date",
  past_month: "Last month",
};

function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatValue(value: number | null, unit: string) {
  if (value === null) return "No data";
  if (unit === "percent") return `${value.toFixed(1)}%`;
  if (unit === "seconds") return `${value.toFixed(0)} sec`;
  return value.toFixed(1);
}

export function MyLiveKpiView() {
  const [period, setPeriod] = useState<Period>("mtd");
  const [selectedDate, setSelectedDate] = useState(today());
  const [data, setData] = useState<LiveData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const dateQuery = period === "day" ? `&date=${selectedDate}` : "";
      const response = await hrmsApi.get<{ data: LiveData }>(
        `/api/kpi-master/live?period=${period}${dateQuery}`
      );
      setData(response.data ?? null);
    } catch (err: any) {
      setError(err?.message ?? "Unable to load performance data");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [period, selectedDate]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-950">
            <Activity className="h-5 w-5 text-indigo-600" />
            My Live Performance
          </h2>
          <p className="mt-1 text-sm text-slate-500">Daily KPI results populated from attendance, APR, quality and connected sources.</p>
        </div>
        <button type="button" onClick={load} className="flex items-center gap-2 text-sm font-medium text-indigo-600">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {(Object.keys(periodLabels) as Period[]).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setPeriod(value)}
            className={`rounded-lg px-3 py-2 text-sm font-medium ${
              period === value ? "bg-indigo-600 text-white" : "border bg-white text-slate-600"
            }`}
          >
            {periodLabels[value]}
          </button>
        ))}
        {period === "day" && (
          <label className="flex items-center gap-2 rounded-lg border bg-white px-3 text-sm text-slate-600">
            <CalendarDays className="h-4 w-4" />
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

      {loading && <div className="flex justify-center py-12"><Loader2 className="h-7 w-7 animate-spin text-indigo-600" /></div>}
      {!loading && error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      {!loading && !error && data && (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-700 p-5 text-white">
              <p className="text-xs font-semibold uppercase tracking-wide text-indigo-100">Overall score</p>
              <p className="mt-2 text-4xl font-bold">{Math.round(data.overall_score)}%</p>
              <p className="mt-1 text-sm text-indigo-100">{data.overall_rating ?? "No rating"} · {data.date_range.start} to {data.date_range.end}</p>
            </div>
            {data.metrics.slice(0, 2).map((metric) => (
              <div key={metric.metric_id} className="rounded-2xl border bg-white p-5">
                <p className="text-sm font-semibold text-slate-700">{metric.metric_name}</p>
                <p className="mt-2 text-2xl font-bold text-slate-950">{formatValue(metric.actual_value, metric.unit)}</p>
                <p className="mt-1 text-xs text-slate-500">Target {formatValue(metric.target_value, metric.unit)} · Score {Math.round(metric.score_pct)}%</p>
              </div>
            ))}
          </div>

          <div className="overflow-auto rounded-2xl border bg-white">
            <div className="border-b px-4 py-3">
              <h3 className="font-semibold text-slate-900">Day-wise performance</h3>
            </div>
            <table className="w-full min-w-[700px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Score</th>
                  <th className="px-4 py-3">Rating</th>
                  <th className="px-4 py-3">Metric details</th>
                </tr>
              </thead>
              <tbody>
                {data.daily_performance.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-10 text-center text-slate-500">No source data is available for this date or period.</td></tr>
                )}
                {data.daily_performance.map((day) => (
                  <tr key={day.date} className="border-t align-top">
                    <td className="px-4 py-3 font-medium text-slate-900">{day.date}</td>
                    <td className="px-4 py-3 font-bold">{Math.round(day.overall_score)}%</td>
                    <td className="px-4 py-3">{day.overall_rating ?? "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {day.metrics.map((metric) => (
                          <span key={metric.metric_id} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">
                            {metric.metric_code}: {formatValue(metric.actual_value, metric.unit)} · {metric.source}
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
  );
}
