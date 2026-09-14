import { Line, LineChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { EmptyState } from "@/components/enterprise/EmptyState";
import { ErrorState } from "@/components/enterprise/ErrorState";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import type { PerformanceMetric, PerformanceTrendPoint } from "@/types/performanceHub";

const lineColours = [
  "var(--brand-600)",
  "var(--status-present)",
  "var(--status-halfday)",
  "var(--status-leave)",
];

function trendMetrics(trends: PerformanceTrendPoint[]): PerformanceMetric[] {
  const byCode = new Map<string, PerformanceMetric>();
  for (const point of trends) {
    for (const metric of point.metrics) {
      if (metric.unit === "percent" && !byCode.has(metric.metricCode)) {
        byCode.set(metric.metricCode, metric);
      }
    }
  }
  return [...byCode.values()]
    .sort((left, right) => left.displayOrder - right.displayOrder || left.label.localeCompare(right.label))
    .slice(0, 4);
}

export function PerformanceTrendPanel({
  trends,
  loading,
  error,
  onRetry,
}: {
  trends: PerformanceTrendPoint[] | undefined;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
}) {
  if (loading) {
    return <Skeleton className="h-[340px] rounded-[var(--r-lg)]" />;
  }
  if (error) {
    return (
      <ErrorState
        title="Performance trend unavailable"
        description={error.message}
        onRetry={onRetry}
      />
    );
  }
  if (!trends?.length) {
    return (
      <EmptyState
        title="No daily trend available"
        description="Daily KPI facts have not been calculated for the selected period."
      />
    );
  }

  const metrics = trendMetrics(trends);
  if (!metrics.length) {
    return (
      <EmptyState
        title="No percentage trend available"
        description="The selected process has performance facts, but none of its visible metrics use percentage units."
      />
    );
  }

  const chartConfig = Object.fromEntries(metrics.map((metric, index) => [
    metric.metricCode,
    { label: metric.label, color: lineColours[index % lineColours.length] },
  ])) satisfies ChartConfig;

  const data = trends.map((point) => ({
    date: point.date,
    ...Object.fromEntries(metrics.map((metric) => [
      metric.metricCode,
      point.metrics.find((item) => item.metricCode === metric.metricCode)?.value ?? null,
    ])),
  }));

  return (
    <section className="min-w-0 rounded-[var(--r-lg)] border border-[var(--border-hairline)] bg-[var(--surface-0)] p-4 shadow-[var(--shadow-xs)]">
      <h2 className="text-base font-semibold text-[var(--text-primary)]">Performance trend</h2>
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        Daily percentage metrics configured for the selected process and role
      </p>
      <ChartContainer config={chartConfig} className="mt-4 h-[280px] w-full">
        <LineChart data={data} accessibilityLayer margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border-hairline)" />
          <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={10} minTickGap={24} />
          <YAxis domain={[0, 100]} tickLine={false} axisLine={false} width={36} />
          <ChartTooltip content={<ChartTooltipContent />} />
          {metrics.map((metric) => (
            <Line
              key={metric.metricCode}
              type="monotone"
              dataKey={metric.metricCode}
              stroke={`var(--color-${metric.metricCode})`}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ChartContainer>
    </section>
  );
}
