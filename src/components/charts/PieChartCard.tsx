import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

interface PieChartCardProps {
  title: string;
  data: { name: string; value: number }[];
  height?: number;
  loading?: boolean;
  colors?: string[];
  valueFormatter?: (v: number) => string;
}

const DEFAULT_COLORS = ["#3B82F6","#10B981","#F59E0B","#EF4444","#8B5CF6","#EC4899","#06B6D4","#84CC16"];

export function PieChartCard({
  title, data, height = 220, loading,
  colors = DEFAULT_COLORS, valueFormatter,
}: PieChartCardProps) {
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
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%"
            outerRadius={height / 2.8} innerRadius={height / 5.5} paddingAngle={2}>
            {data.map((_, i) => (
              <Cell key={i} fill={colors[i % colors.length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={valueFormatter ? (v: unknown) => [valueFormatter(v as number), ""] : undefined}
            contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
