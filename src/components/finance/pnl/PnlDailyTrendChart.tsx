import { useState } from "react";
import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Info, Table as TableIcon, LineChart as LineChartIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { usePnlDailyTrend, type DailyTrendSeriesMeta } from "@/hooks/usePnlDailyTrend";

/**
 * Revenue against cost, day by day.
 *
 * The presentation carries a claim about accuracy, so it is made explicit rather than implied:
 * measured series are drawn solid, modelled series dashed, and the legend says which is which in
 * words as well as in line style — colour and dash alone are not readable to everyone, and this
 * distinction matters more than the numbers themselves.
 *
 * The series can be toggled independently because the GRN line is genuinely spiky (one day can
 * carry a third of the month's vendor spend) and flattens everything else against the axis.
 * A table view is offered as the accessible equivalent of the chart, not as an afterthought.
 */

const COLOR = {
  revenue: "#0080FF",
  grnCost: "#DC2626",
  peopleCost: "#EA580C",
} as const;

function money(value: number) {
  if (Math.abs(value) >= 10000000) return `₹${(value / 10000000).toFixed(2)} Cr`;
  if (Math.abs(value) >= 100000) return `₹${(value / 100000).toFixed(1)} L`;
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

function dayLabel(date: string) {
  return date.slice(8, 10);
}

function BasisBadge({ basis }: { basis: DailyTrendSeriesMeta["basis"] }) {
  return basis === "actual" ? (
    <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
      Measured
    </Badge>
  ) : (
    <Badge variant="outline" className="border-amber-300 bg-amber-50 text-[10px] font-bold uppercase tracking-wide text-amber-700">
      Modelled
    </Badge>
  );
}

export function PnlDailyTrendChart({ period, branchId }: { period: string; branchId?: string }) {
  const { data, isLoading, isError } = usePnlDailyTrend(period, branchId);
  const [visible, setVisible] = useState({ revenue: true, grnCost: true, peopleCost: true });
  const [asTable, setAsTable] = useState(false);

  if (isLoading) return <Skeleton className="h-96 w-full rounded-2xl" />;
  if (isError || !data) return null;

  const chartData = data.points.map((p) => ({ ...p, day: dayLabel(p.date) }));
  const byKey = Object.fromEntries(data.series.map((s) => [s.key, s]));

  return (
    <Card className="rounded-2xl border border-white/60 bg-white/95 shadow-sm backdrop-blur-sm">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base font-bold text-gray-900">
            Revenue versus cost, day by day
          </CardTitle>
          <button
            type="button"
            onClick={() => setAsTable((v) => !v)}
            className="flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 transition-colors duration-200 hover:bg-slate-100"
          >
            {asTable ? <LineChartIcon className="h-3.5 w-3.5" /> : <TableIcon className="h-3.5 w-3.5" />}
            {asTable ? "Show chart" : "Show table"}
          </button>
        </div>
        <p className="text-xs text-slate-500">
          {data.period} · {data.daysObserved} of {data.daysInMonth} days observed
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {(["revenue", "grnCost", "peopleCost"] as const).map((key) => {
            const meta = byKey[key];
            const on = visible[key];
            return (
              <button
                key={key}
                type="button"
                onClick={() => setVisible((v) => ({ ...v, [key]: !v[key] }))}
                aria-pressed={on}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-all duration-200 ${
                  on ? "border-slate-300 bg-white text-slate-800" : "border-slate-200 bg-slate-50 text-slate-400"
                }`}
              >
                <svg width="22" height="8" aria-hidden="true">
                  <line
                    x1="0" y1="4" x2="22" y2="4"
                    stroke={on ? COLOR[key] : "#CBD5E1"}
                    strokeWidth="2.5"
                    strokeDasharray={meta?.basis === "estimated" ? "5 3" : undefined}
                  />
                </svg>
                {meta?.label}
                <span className="text-[10px] font-normal text-slate-500">
                  ({meta?.basis === "actual" ? "solid — measured" : "dashed — modelled"})
                </span>
              </button>
            );
          })}
        </div>

        {asTable ? (
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="py-2 pr-3 font-semibold uppercase tracking-wide">Date</th>
                  <th className="py-2 pr-3 text-right font-semibold uppercase tracking-wide">Revenue</th>
                  <th className="py-2 pr-3 text-right font-semibold uppercase tracking-wide">GRN cost</th>
                  <th className="py-2 pr-3 text-right font-semibold uppercase tracking-wide">People cost</th>
                  <th className="py-2 pr-3 text-right font-semibold uppercase tracking-wide">Headcount</th>
                  <th className="py-2 text-right font-semibold uppercase tracking-wide">Cum. OP %</th>
                </tr>
              </thead>
              <tbody>
                {data.points.map((p) => (
                  <tr key={p.date} className="border-b border-slate-100 last:border-0">
                    <td className="py-1.5 pr-3 font-medium text-gray-800">{p.date}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-slate-600">{money(p.revenue)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-slate-600">{money(p.grnCost)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-slate-600">{money(p.peopleCost)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-slate-600">{p.headcount}</td>
                    <td className={`py-1.5 text-right font-bold tabular-nums ${
                      (p.cumulativeOpPct ?? 0) < 0 ? "text-rose-700" : "text-emerald-700"}`}>
                      {p.cumulativeOpPct === null ? "—" : `${p.cumulativeOpPct}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 8, bottom: 5, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E9EEF5" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="#64748B" />
                <YAxis tickFormatter={(v) => money(Number(v))} tick={{ fontSize: 11 }} stroke="#64748B" width={70} />
                <Tooltip
                  formatter={(value: number, name: string) => [money(Number(value)), name]}
                  labelFormatter={(d) => `${data.period}-${d}`}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #CBD5E1" }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {visible.revenue && (
                  <Line type="monotone" dataKey="revenue" name="Revenue (modelled)"
                        stroke={COLOR.revenue} strokeWidth={2} strokeDasharray="5 3" dot={false} />
                )}
                {visible.grnCost && (
                  <Line type="monotone" dataKey="grnCost" name="GRN cost (measured)"
                        stroke={COLOR.grnCost} strokeWidth={2} dot={false} />
                )}
                {visible.peopleCost && (
                  <Line type="monotone" dataKey="peopleCost" name="People cost (modelled)"
                        stroke={COLOR.peopleCost} strokeWidth={2} strokeDasharray="5 3" dot={false} />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
            <Info className="h-3.5 w-3.5" aria-hidden="true" />
            How each line is produced
          </p>
          {data.series.map((s) => (
            <p key={s.key} className="flex flex-wrap items-start gap-2 text-[11px] leading-relaxed text-slate-600">
              <BasisBadge basis={s.basis} />
              <span className="font-semibold text-slate-800">{s.label}:</span>
              <span className="flex-1">{s.method}</span>
            </p>
          ))}
          <p className="border-t border-slate-200 pt-2 text-[11px] leading-relaxed text-slate-600">
            GRN cost here is dated by the supplier's bill date, while the P&amp;L Statement books it to
            an accounting period. The two will not add up to the same monthly figure, and that is
            expected — they answer different questions.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
