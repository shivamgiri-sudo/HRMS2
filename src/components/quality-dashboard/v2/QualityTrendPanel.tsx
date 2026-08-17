import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import type { TrendPoint } from "./types";
import { Spinner, ErrBanner, PanelShell } from "./shared";

interface Props {
  data: TrendPoint[] | undefined;
  loading: boolean;
  error: boolean;
}

const GRAD_ID = "qdTrendGrad";

export function QualityTrendPanel({ data, loading, error }: Props) {
  const points = data ?? [];

  return (
    <PanelShell
      title="Quality Score Trend"
      subtitle="Average quality score over time — target 80%, watch line 50%"
      className="xl:col-span-2"
    >
      {loading ? (
        <Spinner size="sm" />
      ) : error ? (
        <ErrBanner msg="Failed to load trend data" />
      ) : points.length === 0 ? (
        <div className="flex h-[220px] items-center justify-center text-sm text-slate-400">
          No trend data for this period
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={points} margin={{ top: 8, right: 28, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={GRAD_ID} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#2563eb" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: "#94a3b8" }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fontSize: 11, fill: "#94a3b8" }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip
              formatter={(v: number) => [`${v}%`, "Avg Score"]}
              contentStyle={{
                borderRadius: "10px",
                border: "1px solid #e2e8f0",
                fontSize: 12,
                boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
              }}
            />
            <ReferenceLine
              y={80}
              stroke="#22c55e"
              strokeDasharray="6 3"
              strokeWidth={1.5}
              label={{ value: "80%", position: "right", fontSize: 10, fill: "#22c55e" }}
            />
            <ReferenceLine
              y={50}
              stroke="#ef4444"
              strokeDasharray="6 3"
              strokeWidth={1.5}
              label={{ value: "50%", position: "right", fontSize: 10, fill: "#ef4444" }}
            />
            <Area
              type="monotone"
              dataKey="avg_score"
              stroke="#2563eb"
              strokeWidth={2.5}
              fill={`url(#${GRAD_ID})`}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </PanelShell>
  );
}
