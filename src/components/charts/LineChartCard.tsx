import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from "recharts";

interface LineConfig { key: string; color?: string; name?: string }

interface LineChartCardProps {
  title: string;
  data: Record<string, unknown>[];
  lines: LineConfig[];
  xKey?: string;
  height?: number;
  loading?: boolean;
  valueFormatter?: (v: number) => string;
}

const DEFAULT_COLORS = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6"];

export function LineChartCard({
  title, data, lines, xKey = "date",
  height = 220, loading, valueFormatter,
}: LineChartCardProps) {
  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
        <div className="mb-3 h-4 w-32 animate-pulse rounded bg-slate-100" />
        <div style={{ height }} className="animate-pulse rounded-xl bg-slate-50" />
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <p className="mb-3 text-sm font-semibold text-slate-700">{title}</p>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey={xKey} tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip
            formatter={valueFormatter ? (v: unknown) => [valueFormatter(v as number), ""] : undefined}
            contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
          />
          {lines.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
          {lines.map((l, i) => (
            <Line
              key={l.key}
              type="monotone"
              dataKey={l.key}
              name={l.name ?? l.key}
              stroke={l.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
