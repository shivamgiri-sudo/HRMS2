import React from "react";
import { cn } from "@/lib/utils";
import { KpiMetricCard, KpiMetricCardProps } from "./KpiMetricCard";

export type KpiMetric = KpiMetricCardProps & { id?: string };

export interface KpiMetricGridProps {
  metrics: KpiMetric[];
  loading?: boolean;
  columns?: 2 | 3 | 4;
}

const COLUMN_CLASSES: Record<number, string> = {
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
  4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
};

const SKELETON_METRICS: KpiMetric[] = Array.from({ length: 6 }, (_, i) => ({
  id: `skeleton-${i}`,
  metric: "",
  value: null,
  unit: "",
  loading: true,
}));

export function KpiMetricGrid({
  metrics,
  loading = false,
  columns = 3,
}: KpiMetricGridProps) {
  const displayMetrics = loading ? SKELETON_METRICS : metrics;

  if (!loading && metrics.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-slate-400">
        <span className="text-sm">No metrics available.</span>
      </div>
    );
  }

  return (
    <div className={cn("grid gap-4", COLUMN_CLASSES[columns])}>
      {displayMetrics.map((metric, idx) => (
        <KpiMetricCard
          key={metric.id ?? idx}
          {...metric}
          loading={loading || metric.loading}
        />
      ))}
    </div>
  );
}
