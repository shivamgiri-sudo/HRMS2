/** Model health over time: AUC line + observed 30-day exit rate of the Critical / High tiers. */
import { useMemo } from "react";
import { CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS_TICK, ChartCard, GRID_PROPS, SERIES, STATUS, TOOLTIP_STYLE } from "@/components/analytics/analytics-kit";
import { TIER_COLOR } from "./charts";
import type { HubModel } from "./types";

const short = (d: string) => { const t = new Date(`${d.slice(0, 10)}T00:00:00`); return Number.isNaN(t.getTime()) ? d : t.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }); };

export function ModelTrend({ history }: { history: HubModel["history"] }) {
  const data = useMemo(() => history.map(h => ({ ...h, label: short(h.date) })), [history]);
  const enough = data.length >= 2;
  return (
    <ChartCard
      title="Is the model staying healthy?"
      subtitle="Daily snapshots: AUC (left axis, 0.5 = coin flip) and the share of people in the Critical and High tiers who actually left within 30 days (right axis)."
    >
      {!enough ? (
        <p role="note" className="rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-4 py-6 text-center text-xs text-slate-500">Trend appears after a few days of snapshots.</p>
      ) : (
        <div role="img" aria-label={`Model health over ${data.length} snapshots. Latest AUC ${data[data.length - 1].auc?.toFixed(2) ?? "not available"}.`}>
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis yAxisId="a" domain={[0.4, 1]} tick={AXIS_TICK} tickLine={false} axisLine={false} width={36} tickFormatter={v => Number(v).toFixed(1)} />
              <YAxis yAxisId="r" orientation="right" tick={AXIS_TICK} tickLine={false} axisLine={false} width={40} unit="%" />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number | string, k: string) => [k === "auc" ? Number(v).toFixed(2) : `${Number(v).toFixed(1)}%`, k === "auc" ? "AUC" : k === "criticalRatePct" ? "Critical tier left (30d)" : k === "highRatePct" ? "High tier left (30d)" : "Base rate"]} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} formatter={(v: string) => (v === "auc" ? "AUC (left)" : v === "criticalRatePct" ? "Critical tier left (right)" : v === "highRatePct" ? "High tier left (right)" : "Base rate (right)")} />
              <ReferenceLine yAxisId="a" y={0.5} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: "coin flip", position: "insideBottomLeft", fontSize: 10, fill: "#94a3b8" }} />
              <Line yAxisId="a" type="monotone" dataKey="auc" stroke={SERIES[0]} strokeWidth={3} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
              <Line yAxisId="r" type="monotone" dataKey="criticalRatePct" stroke={TIER_COLOR.CRITICAL} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
              <Line yAxisId="r" type="monotone" dataKey="highRatePct" stroke={TIER_COLOR.HIGH} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
              <Line yAxisId="r" type="monotone" dataKey="baseRatePct" stroke={STATUS.neutral} strokeWidth={1.5} strokeDasharray="5 4" dot={false} connectNulls isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}
