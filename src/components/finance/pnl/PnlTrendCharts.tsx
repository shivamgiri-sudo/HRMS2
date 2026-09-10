import {
  Area, AreaChart, Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { usePnlTrend, type PnlTrendFilters, type PnlTrendMonth } from "@/hooks/usePnlTrend";

/**
 * Revenue/cost/margin trend, headcount-vs-revenue trend, and (when the data supports it) a
 * year-over-year cumulative profit trend, over the months that actually carry real data.
 *
 * Two eras are combined here: `company` (mas_hrms, live, currently 5 months from 2026-04) and
 * `companyHistory` (legacy db_bill, 2018-01 onward where both revenue and cost are real — see
 * pnl-trend-history.service.ts). Every point carries `source` so the chart can render db_bill
 * months with a lighter/dashed treatment and the live months solid. The subtitle is always built
 * from the real data actually present, never a fixed window — see pnl-trend.service.ts for why.
 */

function money(value: number) {
  if (Math.abs(value) >= 10000000) return `₹${(value / 10000000).toFixed(2)} Cr`;
  if (Math.abs(value) >= 100000) return `₹${(value / 100000).toFixed(1)} L`;
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

function monthLabel(period: string) {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" });
}

function spanLabel(realMonths: string[]) {
  if (realMonths.length === 0) return "No real months yet";
  if (realMonths.length === 1) return monthLabel(realMonths[0]);
  return `${monthLabel(realMonths[0])}–${monthLabel(realMonths[realMonths.length - 1])}`;
}

const MONTH_ABBR = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const YOY_LINE_COLORS = ["#ec3013", "#0080FF", "#1f9d55", "#8b5cf6", "#c026d3", "#b45309", "#0891b2", "#64748b"];

export function PnlTrendCharts({ filters }: { filters?: PnlTrendFilters }) {
  const { data, isLoading, isError, refetch } = usePnlTrend(filters);

  if (isLoading) return <Skeleton className="h-96 w-full rounded-none" />;
  if (isError) {
    return (
      <p className="rounded-none border border-rose-200 bg-rose-50 px-4 py-6 text-center text-sm text-rose-600">
        Could not load the revenue/cost/margin trend.{" "}
        <button type="button" className="underline" onClick={() => void refetch()}>Retry</button>
      </p>
    );
  }
  if (!data || data.realMonths.length === 0) {
    return (
      <div className="rounded-none border border-[#d7d3d3] bg-white px-4 py-6 text-center text-sm text-[#605d5d]">
        No month has enough real billing rows yet to chart a trend.
      </div>
    );
  }

  const history: PnlTrendMonth[] = data.companyHistory ?? [];
  const combined: PnlTrendMonth[] = [...history, ...data.company].sort((a, b) => a.period.localeCompare(b.period));
  const chartData = combined.map((m) => ({ ...m, monthLabel: monthLabel(m.period) }));
  const span = spanLabel(data.realMonths);
  const hasHistory = history.length > 0;
  const boundaryLabel = hasHistory ? monthLabel(data.company[0]?.period ?? "") : null;
  const yoy = data.yoy ?? [];
  const showYoy = yoy.length >= 2;

  return (
    <div className="space-y-4">
      {hasHistory && (
        <div className="rounded-none border border-[#d7d3d3] bg-[#faf8f7] px-4 py-3 text-xs text-[#605d5d]">
          <span className="font-bold uppercase tracking-wide text-[#201e1d]">Historical data note — </span>
          Months before {boundaryLabel} come from the legacy db_bill system (
          {monthLabel(history[0].period)}–{monthLabel(history[history.length - 1].period)}); revenue and cost
          definitions may differ slightly from the current live (mas_hrms) system. Company-wide totals only — a
          reliable per-process breakdown isn't possible for this era (see {data.historyDataStatus?.caveat}).
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="rounded-none border border-[#d7d3d3] shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-extrabold uppercase tracking-wide text-[#201e1d]">
              Revenue, cost &amp; margin trend
            </CardTitle>
            <p className="text-xs text-[#7d7979] tabular-nums">
              {hasHistory
                ? `${monthLabel(combined[0].period)}–${monthLabel(combined[combined.length - 1].period)} (${combined.length} months, ${history.length} legacy + ${data.company.length} live)`
                : `${span} · ${data.realMonths.length} real month${data.realMonths.length === 1 ? "" : "s"} of invoicing data`}{" "}
              · Company-wide, all processes combined.
            </p>
          </CardHeader>
          <CardContent>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 5, right: 8, bottom: 5, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eae7e7" />
                  <XAxis dataKey="monthLabel" tick={{ fontSize: 11 }} stroke="#605d5d" />
                  <YAxis tickFormatter={(v) => money(Number(v))} tick={{ fontSize: 11 }} stroke="#605d5d" width={70} />
                  <Tooltip
                    formatter={(value: number, name: string) => [money(Number(value)), name]}
                    labelFormatter={(label, payload) => {
                      const src = (payload?.[0]?.payload as { source?: string } | undefined)?.source;
                      return `${label}${src === "db_bill" ? " (legacy db_bill)" : ""}`;
                    }}
                    contentStyle={{ fontSize: 12 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {hasHistory && (
                    <ReferenceLine
                      x={monthLabel(data.company[0]?.period ?? "")}
                      stroke="#a3a3a3"
                      strokeDasharray="4 4"
                      label={{ value: "live data starts", fontSize: 10, fill: "#7d7979", position: "insideTopRight" }}
                    />
                  )}
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    name="Revenue"
                    stroke="#0080FF"
                    fill="#0080FF22"
                    strokeWidth={2}
                    strokeDasharray={undefined}
                  />
                  <Area type="monotone" dataKey="cost" name="Cost" stroke="#ec3013" fill="#ec301322" strokeWidth={2} />
                  <Line type="monotone" dataKey="margin" name="Margin" stroke="#201e1d" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-none border border-[#d7d3d3] shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-extrabold uppercase tracking-wide text-[#201e1d]">
              Headcount vs revenue trend
            </CardTitle>
            <p className="text-xs text-[#7d7979]">
              {span} · headcount is distinct employees paid (salary_prep_line for live months, salary_data for
              legacy months).
            </p>
          </CardHeader>
          <CardContent>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 5, right: 8, bottom: 5, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eae7e7" />
                  <XAxis dataKey="monthLabel" tick={{ fontSize: 11 }} stroke="#605d5d" />
                  <YAxis yAxisId="left" tickFormatter={(v) => money(Number(v))} tick={{ fontSize: 11 }} stroke="#605d5d" width={70} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} stroke="#605d5d" width={50} />
                  <Tooltip
                    formatter={(value: number, name: string) => [name === "Headcount" ? value : money(Number(value)), name]}
                    contentStyle={{ fontSize: 12 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="right" dataKey="headcount" name="Headcount" fill="#20201e33" stroke="#201e1d" />
                  <Line yAxisId="left" type="monotone" dataKey="revenue" name="Revenue" stroke="#0080FF" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {showYoy && <PnlYoyChart yoy={yoy} />}
    </div>
  );
}

function PnlYoyChart({ yoy }: { yoy: NonNullable<ReturnType<typeof usePnlTrend>["data"]>["yoy"] }) {
  // Reshape into one row per calendar month (1-12), one column per year, for a multi-line chart.
  const rows = Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    const row: Record<string, number | string> = { month, monthLabel: MONTH_ABBR[month] };
    for (const y of yoy) {
      const point = y.points.find((p) => p.month === month);
      if (point) row[String(y.year)] = point.cumulativeMargin;
    }
    return row;
  });

  return (
    <Card className="rounded-none border border-[#d7d3d3] shadow-none">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-extrabold uppercase tracking-wide text-[#201e1d]">
          Year-over-year cumulative profit
        </CardTitle>
        <p className="text-xs text-[#7d7979] tabular-nums">
          Cumulative margin (revenue − cost) by calendar month, one line per year, {yoy[0]?.year}–{yoy[yoy.length - 1]?.year}.
          Dashed = year not yet complete (fewer than 12 real months on record).
        </p>
      </CardHeader>
      <CardContent>
        <div className="h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 5, right: 8, bottom: 5, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eae7e7" />
              <XAxis dataKey="monthLabel" tick={{ fontSize: 11 }} stroke="#605d5d" />
              <YAxis tickFormatter={(v) => money(Number(v))} tick={{ fontSize: 11 }} stroke="#605d5d" width={70} />
              <Tooltip formatter={(value: number, name: string) => [money(Number(value)), name]} contentStyle={{ fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {yoy.map((y, i) => (
                <Line
                  key={y.year}
                  type="monotone"
                  dataKey={String(y.year)}
                  name={`${y.year}${y.complete ? "" : " (partial)"}`}
                  stroke={YOY_LINE_COLORS[i % YOY_LINE_COLORS.length]}
                  strokeWidth={2}
                  strokeDasharray={y.complete ? undefined : "5 3"}
                  dot={false}
                  connectNulls
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
