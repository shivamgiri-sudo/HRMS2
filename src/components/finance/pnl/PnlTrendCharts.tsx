import { useState } from "react";
import {
  Area, AreaChart, Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { usePnlTrend, type PnlTrendFilters, type PnlTrendMonth } from "@/hooks/usePnlTrend";

/**
 * Revenue/cost/margin trend, headcount-vs-revenue trend, and (when the data supports it) a
 * year-over-year cumulative profit trend.
 *
 * DEFAULT VIEW = trailing 12 real calendar months from today, always. Two eras are combined:
 * `company` (mas_hrms, live, currently 2026-04 onward) and `companyHistory` (legacy db_bill,
 * 2018-01 through 2026-03 where both revenue and cost are real — see pnl-trend-history.service.ts).
 * Whichever of the trailing 12 calendar months predate mas_hrms's own live data are backfilled from
 * that db_bill series; every point carries `source` so the chart can render db_bill months with a
 * dashed/lighter treatment and the live months solid, and the caveat banner below only fires when
 * the visible window actually contains a db_bill month.
 *
 * The full multi-year history (2018–present) and the year-over-year cumulative-profit chart are
 * still one click away, never removed — see the "Show full history" toggle — but they are not what
 * loads first. A CEO opening this panel used to see an 8-year, 100+ point company timeline before
 * ever seeing "last month vs this month", which is not what "trend" means to a monthly business
 * review.
 */

function lastNPeriods(n: number, from = new Date()): string[] {
  const periods: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() - i, 1));
    periods.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return periods;
}

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

const YOY_LINE_COLORS = ["hsl(212 74% 41%)", "#059669", "#DC2626", "#8b5cf6", "#c026d3", "#b45309", "#0891b2", "#64748b"];

export function PnlTrendCharts({ filters }: { filters?: PnlTrendFilters }) {
  const { data, isLoading, isError, refetch } = usePnlTrend(filters);
  const [showFullHistory, setShowFullHistory] = useState(false);

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
      <div className="rounded-none border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
        No month has enough real billing rows yet to chart a trend.
      </div>
    );
  }

  const history: PnlTrendMonth[] = data.companyHistory ?? [];
  const combined: PnlTrendMonth[] = [...history, ...data.company].sort((a, b) => a.period.localeCompare(b.period));
  const byPeriod = new Map(combined.map((m) => [m.period, m]));

  // Default view: exactly the trailing 12 real calendar months from today, live mas_hrms months
  // where they exist, backfilled with real db_bill months for whichever predate mas_hrms's own
  // live data. A period with no data on either side (a true gap) renders as a zero point rather
  // than being dropped, so the axis always reads as 12 real consecutive calendar months.
  const trailing12Periods = lastNPeriods(12);
  const trailing12: (PnlTrendMonth & { monthLabel: string })[] = trailing12Periods.map((period) => {
    const m = byPeriod.get(period);
    return {
      period,
      revenue: m?.revenue ?? 0,
      cost: m?.cost ?? 0,
      margin: m?.margin ?? 0,
      headcount: m?.headcount ?? 0,
      source: m?.source,
      monthLabel: monthLabel(period),
    };
  });
  const trailing12HasDbBill = trailing12.some((m) => m.source === "db_bill");
  const trailing12LiveStart = trailing12.find((m) => m.source === "mas_hrms")?.period ?? null;
  const trailing12RealCount = trailing12.filter((m) => m.source).length;

  const chartData = combined.map((m) => ({ ...m, monthLabel: monthLabel(m.period) }));
  const span = spanLabel(data.realMonths);
  const hasHistory = history.length > 0;
  const yoy = data.yoy ?? [];
  const showYoy = yoy.length >= 2;

  return (
    <div className="space-y-4">
      {trailing12HasDbBill && (
        <div className="rounded-none border border-border bg-muted/50 px-4 py-3 text-xs text-muted-foreground">
          <span className="font-bold uppercase tracking-wide text-foreground">Historical data note — </span>
          {trailing12LiveStart
            ? `Months before ${monthLabel(trailing12LiveStart)} in this 12-month view come from the legacy db_bill system; `
            : "This 12-month view is entirely from the legacy db_bill system; "}
          revenue and cost definitions may differ slightly from the current live (mas_hrms) system. Company-wide
          totals only — a reliable per-process breakdown isn't possible for this era (see {data.historyDataStatus?.caveat}).
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="rounded-none border border-border shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-extrabold uppercase tracking-wide text-foreground">
              Revenue, cost &amp; margin trend
            </CardTitle>
            <p className="text-xs text-muted-foreground tabular-nums">
              {monthLabel(trailing12Periods[0])}–{monthLabel(trailing12Periods[trailing12Periods.length - 1])} ·
              trailing 12 months ({trailing12RealCount} with real data){trailing12HasDbBill ? ", mixed mas_hrms + legacy db_bill" : ""} · Company-wide, all processes combined.
            </p>
          </CardHeader>
          <CardContent>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={trailing12} margin={{ top: 5, right: 8, bottom: 5, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(214 32% 89%)" />
                  <XAxis dataKey="monthLabel" tick={{ fontSize: 11 }} stroke="hsl(215 20% 35%)" />
                  <YAxis tickFormatter={(v) => money(Number(v))} tick={{ fontSize: 11 }} stroke="hsl(215 20% 35%)" width={70} />
                  <Tooltip
                    formatter={(value: number, name: string) => [money(Number(value)), name]}
                    labelFormatter={(label, payload) => {
                      const src = (payload?.[0]?.payload as { source?: string } | undefined)?.source;
                      return `${label}${src === "db_bill" ? " (legacy db_bill)" : src ? "" : " (no data)"}`;
                    }}
                    contentStyle={{ fontSize: 12 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {trailing12LiveStart && (
                    <ReferenceLine
                      x={monthLabel(trailing12LiveStart)}
                      stroke="hsl(215 20% 60%)"
                      strokeDasharray="4 4"
                      label={{ value: "live data starts", fontSize: 10, fill: "hsl(215 20% 35%)", position: "insideTopRight" }}
                    />
                  )}
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    name="Revenue"
                    stroke="hsl(212 74% 41%)"
                    fill="hsl(212 74% 41% / 0.13)"
                    strokeWidth={2}
                  />
                  <Area type="monotone" dataKey="cost" name="Cost" stroke="#DC2626" fill="#DC262622" strokeWidth={2} />
                  <Line type="monotone" dataKey="margin" name="Margin" stroke="hsl(222 47% 11%)" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-none border border-border shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-extrabold uppercase tracking-wide text-foreground">
              Headcount vs revenue trend
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {monthLabel(trailing12Periods[0])}–{monthLabel(trailing12Periods[trailing12Periods.length - 1])} · headcount
              is distinct employees paid (salary_prep_line for live months, salary_data for legacy months).
            </p>
          </CardHeader>
          <CardContent>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={trailing12} margin={{ top: 5, right: 8, bottom: 5, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(214 32% 89%)" />
                  <XAxis dataKey="monthLabel" tick={{ fontSize: 11 }} stroke="hsl(215 20% 35%)" />
                  <YAxis yAxisId="left" tickFormatter={(v) => money(Number(v))} tick={{ fontSize: 11 }} stroke="hsl(215 20% 35%)" width={70} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} stroke="hsl(215 20% 35%)" width={50} />
                  <Tooltip
                    formatter={(value: number, name: string) => [name === "Headcount" ? value : money(Number(value)), name]}
                    contentStyle={{ fontSize: 12 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="right" dataKey="headcount" name="Headcount" fill="hsl(215 20% 65% / 0.35)" stroke="hsl(222 47% 11%)" />
                  <Line yAxisId="left" type="monotone" dataKey="revenue" name="Revenue" stroke="hsl(212 74% 41%)" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Longer history stays reachable, never removed — just not what loads first. */}
      <div className="border border-border">
        <button
          type="button"
          onClick={() => setShowFullHistory((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-2.5 text-left text-xs font-extrabold uppercase tracking-wide text-foreground hover:bg-muted"
        >
          <span>
            {showFullHistory ? "Hide" : "Show"} full history{hasHistory ? ` (${monthLabel(combined[0].period)}–${monthLabel(combined[combined.length - 1].period)})` : ""}
            {showYoy ? " & year-over-year profit" : ""}
          </span>
          <span className="text-muted-foreground">{showFullHistory ? "▲" : "▼"}</span>
        </button>
        {showFullHistory && (
          <div className="space-y-4 border-t border-border p-4">
            <p className="text-xs text-muted-foreground tabular-nums">
              {hasHistory
                ? `${monthLabel(combined[0].period)}–${monthLabel(combined[combined.length - 1].period)} (${combined.length} months, ${history.length} legacy + ${data.company.length} live)`
                : `${span} · ${data.realMonths.length} real month${data.realMonths.length === 1 ? "" : "s"} of invoicing data`}
            </p>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 5, right: 8, bottom: 5, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(214 32% 89%)" />
                  <XAxis dataKey="monthLabel" tick={{ fontSize: 10 }} stroke="hsl(215 20% 35%)" interval="preserveStartEnd" />
                  <YAxis tickFormatter={(v) => money(Number(v))} tick={{ fontSize: 11 }} stroke="hsl(215 20% 35%)" width={70} />
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
                      stroke="hsl(215 20% 60%)"
                      strokeDasharray="4 4"
                      label={{ value: "live data starts", fontSize: 10, fill: "hsl(215 20% 35%)", position: "insideTopRight" }}
                    />
                  )}
                  <Area type="monotone" dataKey="revenue" name="Revenue" stroke="hsl(212 74% 41%)" fill="hsl(212 74% 41% / 0.13)" strokeWidth={2} />
                  <Area type="monotone" dataKey="cost" name="Cost" stroke="#DC2626" fill="#DC262622" strokeWidth={2} />
                  <Line type="monotone" dataKey="margin" name="Margin" stroke="hsl(222 47% 11%)" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            {showYoy && <PnlYoyChart yoy={yoy} />}
            {data.processHistoryRevenue && data.processHistoryRevenue.length > 0 && (
              <PnlProcessHistoryRevenueTable processes={data.processHistoryRevenue} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Per-process historical REVENUE, from db_bill's tbl_invoice.cost_process (see
 * pnl-trend-history.service.ts's getDbBillHistoryByProcess doc comment for the match evidence).
 * Revenue only — no cost/margin, because db_bill has no per-process cost attribution pre-2026-04.
 */
function PnlProcessHistoryRevenueTable({
  processes,
}: {
  processes: NonNullable<ReturnType<typeof usePnlTrend>["data"]>["processHistoryRevenue"];
}) {
  const rows = processes
    .map((p) => ({
      processName: p.processName,
      total: p.months.reduce((sum, m) => sum + m.revenue, 0),
      firstPeriod: p.months[0]?.period,
      lastPeriod: p.months[p.months.length - 1]?.period,
      monthCount: p.months.length,
    }))
    .sort((a, b) => b.total - a.total);

  return (
    <Card className="rounded-none border border-border shadow-none">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-extrabold uppercase tracking-wide text-foreground">
          Per-process historical revenue (legacy db_bill)
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Revenue only, matched from tbl_invoice.cost_process — no cost/margin for this era (db_bill has no
          per-process cost attribution before mas_hrms goes live). Not a full P&amp;L; a revenue-only view of
          which processes billed what, historically.
        </p>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full min-w-[560px] text-xs">
          <thead className="border-b-2 border-border bg-muted text-left text-[10px] font-extrabold uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Process</th>
              <th className="px-3 py-2 text-right">Total revenue</th>
              <th className="px-3 py-2 text-right">Months with data</th>
              <th className="px-3 py-2 text-right">Range</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={row.processName}>
                <td className="px-3 py-2 font-semibold text-foreground">{row.processName}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(row.total)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.monthCount}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {row.firstPeriod ? `${monthLabel(row.firstPeriod)}–${monthLabel(row.lastPeriod!)}` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
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
    <Card className="rounded-none border border-border shadow-none">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-extrabold uppercase tracking-wide text-foreground">
          Year-over-year cumulative profit
        </CardTitle>
        <p className="text-xs text-muted-foreground tabular-nums">
          Cumulative margin (revenue − cost) by calendar month, one line per year, {yoy[0]?.year}–{yoy[yoy.length - 1]?.year}.
          Dashed = year not yet complete (fewer than 12 real months on record).
        </p>
      </CardHeader>
      <CardContent>
        <div className="h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 5, right: 8, bottom: 5, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(214 32% 89%)" />
              <XAxis dataKey="monthLabel" tick={{ fontSize: 11 }} stroke="hsl(215 20% 35%)" />
              <YAxis tickFormatter={(v) => money(Number(v))} tick={{ fontSize: 11 }} stroke="hsl(215 20% 35%)" width={70} />
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
