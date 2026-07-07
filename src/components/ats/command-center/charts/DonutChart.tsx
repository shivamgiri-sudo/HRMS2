import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface DonutDataPoint {
  name: string;
  value: number;
  percentage?: number;
}

interface DonutChartProps {
  data: DonutDataPoint[];
  loading?: boolean;
  className?: string;
  title?: string;
  description?: string;
  colors?: string[];
}

const DEFAULT_COLORS = [
  "#1E40AF", // Deep blue
  "#3B82F6", // Blue
  "#60A5FA", // Light blue
  "#93C5FD", // Lighter blue
  "#DBEAFE", // Lightest blue
  "#D97706", // Amber
  "#F59E0B", // Orange
  "#EF4444", // Red
  "#10B981", // Green
  "#8B5CF6", // Purple
];

export function DonutChart({
  data,
  loading,
  className,
  title = "Distribution",
  description,
  colors = DEFAULT_COLORS,
}: DonutChartProps) {
  if (loading) {
    return (
      <Card className={className}>
        <CardHeader>
          <Skeleton className="h-6 w-40" />
          {description && <Skeleton className="h-4 w-64 mt-1" />}
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[300px] w-full" />
        </CardContent>
      </Card>
    );
  }

  const CustomTooltip = ({
    active,
    payload,
  }: {
    active?: boolean;
    payload?: { name: string; value: number; payload: DonutDataPoint }[];
  }) => {
    if (active && payload && payload.length) {
      const data = payload[0];
      return (
        <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
          <p className="font-semibold text-slate-900">{data.name}</p>
          <p className="text-sm text-slate-600">
            Count: <span className="font-bold">{data.value.toLocaleString()}</span>
          </p>
          {data.payload.percentage !== undefined && (
            <p className="text-sm text-slate-600">
              Percentage: <span className="font-bold">{data.payload.percentage}%</span>
            </p>
          )}
        </div>
      );
    }
    return null;
  };

  const CustomLabel = ({
    cx,
    cy,
    midAngle,
    innerRadius,
    outerRadius,
    percent,
  }: {
    cx: number;
    cy: number;
    midAngle: number;
    innerRadius: number;
    outerRadius: number;
    percent: number;
  }) => {
    const RADIAN = Math.PI / 180;
    const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);

    if (percent < 0.05) return null; // Don't show labels for small slices

    return (
      <text
        x={x}
        y={y}
        fill="white"
        textAnchor={x > cx ? "start" : "end"}
        dominantBaseline="central"
        className="text-xs font-bold"
      >
        {`${(percent * 100).toFixed(0)}%`}
      </text>
    );
  };

  const totalValue = data.reduce((sum, item) => sum + item.value, 0);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-lg font-bold text-slate-900">{title}</CardTitle>
        {description && <p className="text-sm text-slate-500">{description}</p>}
      </CardHeader>
      <CardContent>
        {data.length > 0 ? (
          <div className="flex flex-col lg:flex-row items-center gap-4">
            <div className="w-full lg:w-1/2">
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={data}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={CustomLabel}
                    outerRadius={100}
                    innerRadius={60}
                    fill="#8884d8"
                    dataKey="value"
                    animationDuration={800}
                  >
                    {data.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="text-center mt-2">
                <p className="text-2xl font-bold text-slate-900">{totalValue.toLocaleString()}</p>
                <p className="text-sm text-slate-500">Total</p>
              </div>
            </div>
            <div className="w-full lg:w-1/2 space-y-2">
              {data.map((item, index) => (
                <div
                  key={item.name}
                  className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 p-2"
                >
                  <div className="flex items-center gap-2">
                    <div
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: colors[index % colors.length] }}
                    />
                    <span className="text-sm text-slate-700">{item.name}</span>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-slate-900">
                      {item.value.toLocaleString()}
                    </p>
                    {item.percentage !== undefined && (
                      <p className="text-xs text-slate-500">{item.percentage}%</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex h-[300px] items-center justify-center text-slate-500">
            No data available
          </div>
        )}
      </CardContent>
    </Card>
  );
}
