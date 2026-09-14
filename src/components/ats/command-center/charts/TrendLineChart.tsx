import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Area, AreaChart } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { format, parseISO } from "date-fns";

interface TimeSeriesDataPoint {
  date: string;
  arrivals: number;
  selections: number;
  rejections: number;
  pending: number;
}

interface TrendLineChartProps {
  data: TimeSeriesDataPoint[];
  loading?: boolean;
  className?: string;
  title?: string;
  description?: string;
  showArea?: boolean;
}

export function TrendLineChart({
  data,
  loading,
  className,
  title = "Recruitment Trends",
  description = "Daily arrivals, selections, and rejections",
  showArea = false,
}: TrendLineChartProps) {
  if (loading) {
    return (
      <Card className={className}>
        <CardHeader>
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-64 mt-1" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[300px] w-full" />
        </CardContent>
      </Card>
    );
  }

  const formattedData = data.map(point => ({
    ...point,
    formattedDate: format(parseISO(point.date), "MMM dd"),
  }));

  const CustomTooltip = ({
    active,
    payload,
    label,
  }: {
    active?: boolean;
    payload?: { dataKey: string; value: number; color: string; name: string }[];
    label?: string;
  }) => {
    if (active && payload && payload.length) {
      return (
        <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
          <p className="mb-2 font-semibold text-slate-900">{label}</p>
          {payload.map((entry) => (
            <div key={entry.dataKey} className="flex items-center gap-2 text-sm">
              <div
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              <span className="text-slate-600">{entry.name}:</span>
              <span className="font-bold text-slate-900">
                {entry.value.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  const ChartComponent = showArea ? AreaChart : LineChart;

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-lg font-bold text-slate-900">{title}</CardTitle>
        <p className="text-sm text-slate-500">{description}</p>
      </CardHeader>
      <CardContent>
        {formattedData.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <ChartComponent data={formattedData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis
                dataKey="formattedDate"
                stroke="#64748B"
                fontSize={12}
                tickLine={false}
              />
              <YAxis
                stroke="#64748B"
                fontSize={12}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                wrapperStyle={{ paddingTop: "20px" }}
                iconType="circle"
                formatter={(value) => (
                  <span className="text-sm font-medium text-slate-700">{value}</span>
                )}
              />
              {showArea ? (
                <>
                  <defs>
                    <linearGradient id="colorArrivals" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#1E40AF" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#1E40AF" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorSelections" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorRejections" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#EF4444" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#EF4444" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area
                    type="monotone"
                    dataKey="arrivals"
                    stroke="#1E40AF"
                    strokeWidth={2}
                    fill="url(#colorArrivals)"
                    name="Arrivals"
                  />
                  <Area
                    type="monotone"
                    dataKey="selections"
                    stroke="#10B981"
                    strokeWidth={2}
                    fill="url(#colorSelections)"
                    name="Selections"
                  />
                  <Area
                    type="monotone"
                    dataKey="rejections"
                    stroke="#EF4444"
                    strokeWidth={2}
                    fill="url(#colorRejections)"
                    name="Rejections"
                  />
                </>
              ) : (
                <>
                  <Line
                    type="monotone"
                    dataKey="arrivals"
                    stroke="#1E40AF"
                    strokeWidth={2}
                    dot={{ fill: "#1E40AF", r: 3 }}
                    activeDot={{ r: 5 }}
                    name="Arrivals"
                  />
                  <Line
                    type="monotone"
                    dataKey="selections"
                    stroke="#10B981"
                    strokeWidth={2}
                    dot={{ fill: "#10B981", r: 3 }}
                    activeDot={{ r: 5 }}
                    name="Selections"
                  />
                  <Line
                    type="monotone"
                    dataKey="rejections"
                    stroke="#EF4444"
                    strokeWidth={2}
                    dot={{ fill: "#EF4444", r: 3 }}
                    activeDot={{ r: 5 }}
                    name="Rejections"
                  />
                </>
              )}
            </ChartComponent>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-[300px] items-center justify-center text-slate-500">
            No trend data available
          </div>
        )}
      </CardContent>
    </Card>
  );
}
