import React from "react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

export interface AgingBucket {
  label: string;
  count: number;
  color?: string;
}

export interface AgingBucketCardProps {
  buckets: AgingBucket[];
  title: string;
  loading?: boolean;
}

const DEFAULT_COLORS = [
  "#16a34a", // green
  "#d97706", // amber
  "#f97316", // orange
  "#dc2626", // red
  "#7c3aed", // violet
];

export function AgingBucketCard({
  buckets,
  title,
  loading = false,
}: AgingBucketCardProps) {
  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
        <Skeleton className="h-4 w-40" />
        {[...Array(4)].map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-3 w-20 shrink-0" />
            <Skeleton className="h-5 flex-1 rounded" />
            <Skeleton className="h-3 w-8 shrink-0" />
          </div>
        ))}
      </div>
    );
  }

  if (!buckets || buckets.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">{title}</p>
        <p className="text-sm text-slate-400 py-4 text-center">No data available.</p>
      </div>
    );
  }

  const maxCount = Math.max(...buckets.map((b) => b.count), 1);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-4">{title}</p>

      <div className="space-y-2.5">
        {buckets.map((bucket, i) => {
          const widthPct = (bucket.count / maxCount) * 100;
          const color = bucket.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length];

          return (
            <div key={i} className="flex items-center gap-3 group">
              <span className="text-xs text-slate-600 w-24 shrink-0 truncate" title={bucket.label}>
                {bucket.label}
              </span>
              <div className="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden relative">
                <div
                  className="h-5 rounded-full transition-all duration-500"
                  style={{
                    width: bucket.count === 0 ? "2px" : `${Math.max(widthPct, 2)}%`,
                    backgroundColor: color,
                  }}
                />
              </div>
              <span
                className="text-xs font-semibold w-8 text-right shrink-0"
                style={{ color }}
              >
                {bucket.count}
              </span>
            </div>
          );
        })}
      </div>

      {/* Total */}
      <div className="mt-3 pt-3 border-t border-slate-100 flex justify-between text-xs text-slate-500">
        <span>Total</span>
        <span className="font-semibold text-slate-700">
          {buckets.reduce((sum, b) => sum + b.count, 0)}
        </span>
      </div>
    </div>
  );
}
