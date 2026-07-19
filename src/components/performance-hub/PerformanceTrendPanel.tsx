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
import type { PerformanceTrendPoint } from "@/types/performanceHub";

const chartConfig = {
  quality: { label: "Quality %", color: "var(--brand-600)" },
  adherence: { label: "Adherence %", color: "var(--status-present)" },
  conversion: { label: "Conversion %", color: "var(--status-halfday)" },
} satisfies ChartConfig;

function value(point: PerformanceTrendPoint, code: string): number | null {
  return point.metrics.find((metric) => metric.metricCode === code)?.value ?? null;
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

  const data = trends.map((point) => ({
    date: point.date,
    quality: value(point, "QUALITY_SCORE"),
    adherence: value(point, "ADHERENCE"),
    conversion: value(point, "CONVERSION_RATE"),
  }));

  return (
    <section className="min-w-0 rounded-[var(--r-lg)] border border-[var(--border-hairline)] bg-[var(--surface-0)] p-4 shadow-[var(--shadow-xs)]">
      <h2 className="text-base font-semibold text-[var(--text-primary)]">Performance trend</h2>
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        Daily KPI percentages within the selected scope
      </p>
      <ChartContainer config={chartConfig} className="mt-4 h-[280px] w-full">
        <LineChart data={data} accessibilityLayer margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border-hairline)" />
          <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={10} minTickGap={24} />
          <YAxis domain={[0, 100]} tickLine={false} axisLine={false} width={36} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Line type="monotone" dataKey="quality" stroke="var(--color-quality)" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
          <Line type="monotone" dataKey="adherence" stroke="var(--color-adherence)" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
          <Line type="monotone" dataKey="conversion" stroke="var(--color-conversion)" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
        </LineChart>
      </ChartContainer>
    </section>
  );
}
