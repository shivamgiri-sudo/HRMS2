/**
 * PayrollChart — Recharts LineChart showing 30-day projected payroll cost trend.
 */
import { Loader, AlertTriangle, TrendingUp } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend,
} from "recharts";
import { usePayrollProjection } from "@/hooks/useManagementDashboard";

function inrShort(v: number) {
  if (v >= 10_000_000) return `₹${(v / 10_000_000).toFixed(1)}Cr`;
  if (v >= 100_000) return `₹${(v / 100_000).toFixed(1)}L`;
  if (v >= 1_000) return `₹${(v / 1_000).toFixed(0)}K`;
  return `₹${v}`;
}

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}

function CustomTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-lg text-xs">
      <p className="mb-1.5 font-black text-slate-700">{label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color }} className="font-semibold">
          {p.name}: {inrShort(p.value)}
        </p>
      ))}
    </div>
  );
}

export function PayrollChart() {
  const { data, isLoading, error } = usePayrollProjection();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800">
        <AlertTriangle className="h-4 w-4 flex-shrink-0" />
        Failed to load payroll projection: {error.message}
      </div>
    );
  }

  if (!data || !data.days?.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-400">
        <TrendingUp className="mb-3 h-10 w-10 opacity-30" />
        <p className="font-semibold">No payroll projection data available.</p>
      </div>
    );
  }

  // Format date labels: show DD-Mon
  const chartData = data.days.map((d) => ({
    ...d,
    label: new Date(d.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">30-Day Cost Forecast</p>
          <p className="mt-0.5 text-sm font-bold text-slate-600">
            Total Projected: <span className="text-slate-950">{inrShort(data.total_projected)}</span>
          </p>
        </div>
        <p className="text-xs text-slate-400">
          {data.period_start} → {data.period_end}
        </p>
      </div>

      {/* Line Chart — projected vs actual */}
      <div className="rounded-3xl border bg-white p-5 shadow-sm">
        <p className="mb-4 text-sm font-black text-slate-700">Cost Trend</p>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: "#94a3b8" }}
              interval="preserveStartEnd"
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tickFormatter={inrShort}
              tick={{ fontSize: 10, fill: "#94a3b8" }}
              tickLine={false}
              axisLine={false}
              width={52}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line
              type="monotone"
              dataKey="projected_cost"
              name="Projected"
              stroke="#6366f1"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
            <Line
              type="monotone"
              dataKey="actual_cost"
              name="Actual"
              stroke="#10b981"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Bar Chart — daily breakdown */}
      <div className="rounded-3xl border bg-white p-5 shadow-sm">
        <p className="mb-4 text-sm font-black text-slate-700">Daily Breakdown</p>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: "#94a3b8" }}
              interval="preserveStartEnd"
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tickFormatter={inrShort}
              tick={{ fontSize: 10, fill: "#94a3b8" }}
              tickLine={false}
              axisLine={false}
              width={52}
            />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="projected_cost" name="Projected" fill="#6366f1" radius={[4, 4, 0, 0]} maxBarSize={24} />
            <Bar dataKey="actual_cost" name="Actual" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={24} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
