import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import {
  AXIS_TICK,
  ChartCard,
  ChartSkeleton,
  EmptyState,
  GRID_PROPS,
  SERIES,
  TOOLTIP_STYLE,
  num,
  pct,
  ratio,
} from "@/components/analytics/analytics-kit";

type AnyRow = Record<string, unknown>;

interface DashboardTabProps {
  dashboardRows: AnyRow[];
  branchTable: AnyRow[];
  loading?: boolean;
}

const N = (v: unknown) => Number(v || 0);
const S = (v: unknown) => String(v ?? "");

function mins(v: unknown) {
  const m = Math.round(N(v));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

export function DashboardTab({ dashboardRows, branchTable, loading }: DashboardTabProps) {
  if (loading) {
    return (
      <div className="space-y-4">
        <ChartSkeleton height={260} />
        <ChartSkeleton height={220} />
      </div>
    );
  }

  const chartData = (dashboardRows || []).map((row) => ({
    period: S(row.Date),
    Arrivals: N(row["Total Arrival"]),
    Selected: N(row.Selection),
    Rejected: N(row.Rejection),
    "SLA Breach": N(row["SLA Breach"]),
  }));

  const branchTotal = (branchTable || []).reduce((sum, r) => sum + N(r.TotalArrival), 0);

  return (
    <div className="space-y-4">
      <ChartCard
        title="Period Breakdown"
        subtitle="Arrivals, outcomes and SLA breaches for each reporting window (FTD / WTD / MTD)."
      >
        {chartData.length === 0 ? (
          <EmptyState label="No period data for these filters" height={240} />
        ) : (
          <ResponsiveContainer width="100%" height={270}>
            <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="period" tick={AXIS_TICK} axisLine={false} tickLine={false} />
              <YAxis tick={AXIS_TICK} allowDecimals={false} axisLine={false} tickLine={false} width={44} />
              <Tooltip
                cursor={{ fill: "#f1f5f9" }}
                contentStyle={TOOLTIP_STYLE}
                formatter={(value: number, name: string) => [num(value), name]}
                labelFormatter={(label, payload) => {
                  const row: any = payload?.[0]?.payload;
                  const rate = ratio(row?.Selected ?? 0, row?.Arrivals ?? 0);
                  return `${label}${rate !== null ? ` — ${pct(rate)} selection rate` : ""}`;
                }}
              />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
              <Bar dataKey="Arrivals" fill={SERIES[0]} radius={[3, 3, 0, 0]} barSize={26} />
              <Bar dataKey="Selected" fill={SERIES[5]} radius={[3, 3, 0, 0]} barSize={26} />
              <Bar dataKey="Rejected" fill={SERIES[1]} radius={[3, 3, 0, 0]} barSize={26} />
              <Bar dataKey="SLA Breach" fill={SERIES[3]} radius={[3, 3, 0, 0]} barSize={26} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <ChartCard title="Detailed Period View" subtitle="The figures behind the chart above, with rates made explicit.">
        {(dashboardRows || []).length === 0 ? (
          <EmptyState label="No dashboard data" height={140} />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[680px] text-xs">
              <thead className="bg-slate-50">
                <tr className="border-b border-slate-200 text-slate-600">
                  <th className="px-3 py-2 text-left font-semibold">Period</th>
                  <th className="px-3 py-2 text-right font-semibold">Arrival</th>
                  <th className="px-3 py-2 text-right font-semibold">Selected</th>
                  <th className="px-3 py-2 text-right font-semibold">Sel %</th>
                  <th className="px-3 py-2 text-right font-semibold">Rejected</th>
                  <th className="px-3 py-2 text-right font-semibold">Pending</th>
                  <th className="px-3 py-2 text-right font-semibold">SLA Breach</th>
                  <th className="px-3 py-2 text-right font-semibold">Avg Wait</th>
                </tr>
              </thead>
              <tbody>
                {(dashboardRows || []).map((row, i) => {
                  const arrival = N(row["Total Arrival"]);
                  return (
                    <tr key={`${S(row.Date)}-${i}`} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                      <td className="px-3 py-2 font-semibold text-slate-900">{S(row.Date) || "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">{num(arrival)}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-emerald-700">
                        {num(N(row.Selection))}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                        {pct(ratio(N(row.Selection), arrival) ?? 0)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-orange-700">{num(N(row.Rejection))}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-600">{num(N(row.Pending))}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-amber-700">{num(N(row["SLA Breach"]))}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-600">{mins(row["Avg Time"])}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </ChartCard>

      <ChartCard
        title="Branch Summary"
        subtitle="Every branch in scope — the reconciliation view for branch-level questions."
        action={
          <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-600">
            {num((branchTable || []).length)} branches · {num(branchTotal)} arrivals
          </span>
        }
      >
        {(branchTable || []).length === 0 ? (
          <EmptyState label="No branch data" height={140} />
        ) : (
          <div className="max-h-[420px] overflow-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[620px] text-xs">
              <thead className="sticky top-0 z-10 bg-slate-50">
                <tr className="border-b border-slate-200 text-slate-600">
                  <th className="px-3 py-2 text-left font-semibold">Branch</th>
                  <th className="px-3 py-2 text-right font-semibold">Arrival</th>
                  <th className="px-3 py-2 text-right font-semibold">Share</th>
                  <th className="px-3 py-2 text-right font-semibold">Selected</th>
                  <th className="px-3 py-2 text-right font-semibold">Waiting</th>
                  <th className="px-3 py-2 text-right font-semibold">SLA Breach</th>
                  <th className="px-3 py-2 text-right font-semibold">Sel %</th>
                </tr>
              </thead>
              <tbody>
                {(branchTable || []).map((row, i) => (
                  <tr key={`${S(row.Name)}-${i}`} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                    <td className="px-3 py-2 font-medium text-slate-800">{S(row.Name) || "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">{num(N(row.TotalArrival))}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                      {pct(ratio(N(row.TotalArrival), branchTotal) ?? 0)}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-emerald-700">
                      {num(N(row.Selection))}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">{num(N(row.Waiting))}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-amber-700">{num(N(row.SlaBreach))}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-blue-700">
                      {pct(N(row.SelectionRate))}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50 font-bold text-slate-900">
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2 text-right tabular-nums">{num(branchTotal)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">100.0%</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {num((branchTable || []).reduce((sum, r) => sum + N(r.Selection), 0))}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {num((branchTable || []).reduce((sum, r) => sum + N(r.Waiting), 0))}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {num((branchTable || []).reduce((sum, r) => sum + N(r.SlaBreach), 0))}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {pct(
                      ratio(
                        (branchTable || []).reduce((sum, r) => sum + N(r.Selection), 0),
                        branchTotal
                      ) ?? 0
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </ChartCard>
    </div>
  );
}
