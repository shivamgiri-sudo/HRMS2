import { BarChart as RechartsBarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface BarChartDataPoint {
  name: string;
  [key: string]: string | number;
}

interface BarChartProps {
  data: BarChartDataPoint[];
  bars: {
    dataKey: string;
    name: string;
    color: string;
  }[];
  loading?: boolean;
  className?: string;
  title?: string;
  description?: string;
  horizontal?: boolean;
  stacked?: boolean;
}

export function BarChartComponent({
  data,
  bars,
  loading,
  className,
  title = "Bar Chart",
  description,
  horizontal = false,
  stacked = false,
}: BarChartProps) {
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
                {typeof entry.value === 'number' ? entry.value.toLocaleString() : entry.value}
              </span>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-lg font-bold text-slate-900">{title}</CardTitle>
        {description && <p className="text-sm text-slate-500">{description}</p>}
      </CardHeader>
      <CardContent>
        {data.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <RechartsBarChart
              data={data}
              layout={horizontal ? "vertical" : "horizontal"}
              margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              {horizontal ? (
                <>
                  <XAxis
                    type="number"
                    stroke="#64748B"
                    fontSize={12}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    stroke="#64748B"
                    fontSize={12}
                    tickLine={false}
                    width={100}
                  />
                </>
              ) : (
                <>
                  <XAxis
                    dataKey="name"
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
                </>
              )}
              <Tooltip content={<CustomTooltip />} />
              <Legend
                wrapperStyle={{ paddingTop: "20px" }}
                iconType="circle"
                formatter={(value) => (
                  <span className="text-sm font-medium text-slate-700">{value}</span>
                )}
              />
              {bars.map((bar) => (
                <Bar
                  key={bar.dataKey}
                  dataKey={bar.dataKey}
                  name={bar.name}
                  fill={bar.color}
                  radius={[4, 4, 0, 0]}
                  animationDuration={800}
                  stackId={stacked ? "stack" : undefined}
                />
              ))}
            </RechartsBarChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-[300px] items-center justify-center text-slate-500">
            No data available
          </div>
        )}
      </CardContent>
    </Card>
  );
}
