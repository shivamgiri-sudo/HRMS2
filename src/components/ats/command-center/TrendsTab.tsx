import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import {
  AXIS_TICK,
  ChartCard,
  ChartSkeleton,
  CoverageNote,
  EmptyState,
  GRID_PROPS,
  SERIES,
  TOOLTIP_STYLE,
  num,
  pct,
  ratio,
} from "@/components/analytics/analytics-kit";

type AnyRow = Record<string, unknown>;

interface TrendsTabProps {
  processTable: AnyRow[];
  sourceTable: AnyRow[];
  slotTable: AnyRow[];
  loading?: boolean;
}

const N = (v: unknown) => Number(v || 0);
const S = (v: unknown) => String(v ?? "");
const CHART_GROUPS = 8;

function mins(v: unknown) {
  const m = Math.round(N(v));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

export function TrendsTab({ processTable, sourceTable, slotTable, loading }: TrendsTabProps) {
  if (loading) {
    return (
      <div className="space-y-4">
        <ChartSkeleton height={280} />
        <ChartSkeleton height={220} />
      </div>
    );
  }

  const processRows = processTable || [];
  const head = processRows.slice(0, CHART_GROUPS);
  const tail = processRows.slice(CHART_GROUPS);
  const processChartData = head.map((p) => ({
    // Axis labels are truncated for layout only — the tooltip carries the full name,
    // so a process is never silently misidentified by a clipped label.
    name: S(p.Name).length > 16 ? `${S(p.Name).slice(0, 15)}…` : S(p.Name),
    fullName: S(p.Name),
    Arrivals: N(p.TotalArrival),
    Selected: N(p.Selection),
    Rejected: N(p.Rejection),
  }));

  const sourceTotal = (sourceTable || []).reduce((sum, r) => sum + N(r.TotalArrival), 0);
  const slotTotal = (slotTable || []).reduce((sum, r) => sum + N(r.TotalArrival), 0);

  return (
    <div className="space-y-4">
      <ChartCard
        title="By Process"
        subtitle="Arrivals and outcomes for the highest-volume processes."
        footer={
          <CoverageNote
            shownGroups={head.length}
            distinctGroups={processRows.length}
            shownRecords={head.reduce((sum, p) => sum + N(p.TotalArrival), 0)}
            otherGroups={tail.length}
            otherRecords={tail.reduce((sum, p) => sum + N(p.TotalArrival), 0)}
            unit="arrivals"
          />
        }
      >
        {processChartData.length === 0 ? (
          <EmptyState label="No process data for these filters" height={260} />
        ) : (
          <ResponsiveContainer width="100%" height={290}>
            <BarChart data={processChartData} margin={{ top: 8, right: 8, bottom: 28, left: 0 }}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis
                dataKey="name"
                tick={{ ...AXIS_TICK, fontSize: 10 }}
                angle={-22}
                textAnchor="end"
                height={56}
                interval={0}
                axisLine={false}
                tickLine={false}
              />
              <YAxis tick={AXIS_TICK} allowDecimals={false} axisLine={false} tickLine={false} width={44} />
              <Tooltip
                cursor={{ fill: "#f1f5f9" }}
                contentStyle={TOOLTIP_STYLE}
                formatter={(value: number, name: string) => [num(value), name]}
                labelFormatter={(label, payload) => {
                  const row: any = payload?.[0]?.payload;
                  if (!row) return label;
                  const rate = ratio(row.Selected, row.Arrivals);
                  return `${row.fullName}${rate !== null ? ` — ${pct(rate)} selection rate` : ""}`;
                }}
              />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
              <Bar dataKey="Arrivals" fill={SERIES[0]} radius={[3, 3, 0, 0]} barSize={16} />
              <Bar dataKey="Selected" fill={SERIES[5]} radius={[3, 3, 0, 0]} barSize={16} />
              <Bar dataKey="Rejected" fill={SERIES[1]} radius={[3, 3, 0, 0]} barSize={16} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title="By Source Channel"
          subtitle="Which channels bring candidates in, and how many convert."
          action={
            <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-600">
              {num((sourceTable || []).length)} channels
            </span>
          }
        >
          {(sourceTable || []).length === 0 ? (
            <EmptyState label="No source data" height={160} />
          ) : (
            <div className="max-h-[320px] overflow-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[420px] text-xs">
                <thead className="sticky top-0 z-10 bg-slate-50">
                  <tr className="border-b border-slate-200 text-slate-600">
                    <th className="px-3 py-2 text-left font-semibold">Source</th>
                    <th className="px-3 py-2 text-right font-semibold">Arrival</th>
                    <th className="px-3 py-2 text-right font-semibold">Share</th>
                    <th className="px-3 py-2 text-right font-semibold">Selected</th>
                    <th className="px-3 py-2 text-right font-semibold">Sel %</th>
                  </tr>
                </thead>
                <tbody>
                  {(sourceTable || []).map((row, i) => (
                    <tr key={`${S(row.Name)}-${i}`} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                      <td className="px-3 py-2 font-medium text-slate-800">{S(row.Name) || "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">{num(N(row.TotalArrival))}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                        {pct(ratio(N(row.TotalArrival), sourceTotal) ?? 0)}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-emerald-700">
                        {num(N(row.Selection))}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-blue-700">{pct(N(row.SelectionRate))}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-50 font-bold text-slate-900">
                    <td className="px-3 py-2">Total</td>
                    <td className="px-3 py-2 text-right tabular-nums">{num(sourceTotal)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">100.0%</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {num((sourceTable || []).reduce((sum, r) => sum + N(r.Selection), 0))}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {pct(
                        ratio(
                          (sourceTable || []).reduce((sum, r) => sum + N(r.Selection), 0),
                          sourceTotal
                        ) ?? 0
                      )}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </ChartCard>

        <ChartCard
          title="By Time Slot"
          subtitle="When candidates arrive, and where the waiting builds up."
          action={
            <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-600">
              {num((slotTable || []).length)} slots
            </span>
          }
        >
          {(slotTable || []).length === 0 ? (
            <EmptyState label="No slot data" height={160} />
          ) : (
            <div className="max-h-[320px] overflow-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[460px] text-xs">
                <thead className="sticky top-0 z-10 bg-slate-50">
                  <tr className="border-b border-slate-200 text-slate-600">
                    <th className="px-3 py-2 text-left font-semibold">Slot</th>
                    <th className="px-3 py-2 text-right font-semibold">Arrival</th>
                    <th className="px-3 py-2 text-right font-semibold">Share</th>
                    <th className="px-3 py-2 text-right font-semibold">Selected</th>
                    <th className="px-3 py-2 text-right font-semibold">SLA Breach</th>
                    <th className="px-3 py-2 text-right font-semibold">Avg Wait</th>
                  </tr>
                </thead>
                <tbody>
                  {(slotTable || []).map((row, i) => (
                    <tr key={`${S(row.Name)}-${i}`} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                      <td className="px-3 py-2 font-medium text-slate-800">{S(row.Name) || "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">{num(N(row.TotalArrival))}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                        {pct(ratio(N(row.TotalArrival), slotTotal) ?? 0)}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-emerald-700">
                        {num(N(row.Selection))}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-amber-700">{num(N(row.SlaBreach))}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-600">{mins(row.AvgWaitMinutes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
