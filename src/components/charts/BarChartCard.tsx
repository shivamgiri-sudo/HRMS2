import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from "recharts";

interface BarChartCardProps {
  title: string;
  data: Record<string, unknown>[];
  dataKey: string;
  nameKey?: string;
  color?: string;
  height?: number;
  loading?: boolean;
  valueFormatter?: (v: number) => string;
  colors?: string[];
}

export function BarChartCard({
  title, data, dataKey, nameKey = "name", color = "#3B82F6",
  height = 220, loading, valueFormatter, colors,
}: BarChartCardProps) {
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
        <BarChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey={nameKey} tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip
            formatter={valueFormatter ? (v: unknown) => [valueFormatter(v as number), dataKey] : undefined}
            contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
          />
          <Bar dataKey={dataKey} radius={[4, 4, 0, 0]} fill={color}>
            {colors && data.map((_: unknown, i: number) => (
              <Cell key={i} fill={colors[i % colors.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
