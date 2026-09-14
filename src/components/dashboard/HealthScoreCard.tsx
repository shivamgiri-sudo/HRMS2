import React from "react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

export interface HealthBreakdownItem {
  name: string;
  value: number;
  weight?: number;
}

export interface HealthScoreCardProps {
  score: number;
  label: string;
  breakdown?: HealthBreakdownItem[];
  loading?: boolean;
}

function ringColor(score: number): string {
  if (score >= 80) return "#16a34a"; // green-600
  if (score >= 60) return "#d97706"; // amber-600
  return "#dc2626"; // red-600
}

function ringTextColor(score: number): string {
  if (score >= 80) return "text-emerald-700";
  if (score >= 60) return "text-amber-600";
  return "text-red-600";
}

function scoreCategoryLabel(score: number): string {
  if (score >= 80) return "Healthy";
  if (score >= 60) return "Moderate";
  return "At Risk";
}

function BreakdownBar({ item }: { item: HealthBreakdownItem }) {
  const pct = Math.min(100, Math.max(0, item.value));
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-600 w-28 truncate shrink-0">{item.name}</span>
      <div className="flex-1 bg-slate-100 rounded-full h-1.5 overflow-hidden">
        <div
          className="h-1.5 rounded-full transition-all"
          style={{
            width: `${pct}%`,
            backgroundColor: ringColor(pct),
          }}
        />
      </div>
      <span className="text-xs font-medium text-slate-700 w-8 text-right shrink-0">{item.value}</span>
      {item.weight !== undefined && (
        <span className="text-xs text-slate-400 w-10 text-right shrink-0">×{item.weight}</span>
      )}
    </div>
  );
}

export function HealthScoreCard({
  score,
  label,
  breakdown,
  loading = false,
}: HealthScoreCardProps) {
  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-28 w-28 rounded-full mx-auto" />
        <div className="space-y-2">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-3/4" />
        </div>
      </div>
    );
  }

  const clampedScore = Math.min(100, Math.max(0, Math.round(score)));
  const color = ringColor(clampedScore);
  const textColor = ringTextColor(clampedScore);
  // conic-gradient: fill from 0 to score%
  const gradientPct = (clampedScore / 100) * 360;
  const ringStyle: React.CSSProperties = {
    background: `conic-gradient(${color} ${gradientPct}deg, #e2e8f0 ${gradientPct}deg)`,
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-4">{label}</p>

      {/* Ring */}
      <div className="flex justify-center mb-4">
        <div
          className="relative h-28 w-28 rounded-full flex items-center justify-center"
          style={ringStyle}
        >
          {/* Inner white circle */}
          <div className="absolute inset-2 rounded-full bg-white flex flex-col items-center justify-center">
            <span className={cn("text-2xl font-bold leading-none", textColor)}>
              {clampedScore}
            </span>
            <span className="text-xs text-slate-400 mt-0.5">/100</span>
          </div>
        </div>
      </div>

      {/* Category label */}
      <p className={cn("text-center text-sm font-semibold mb-4", textColor)}>
        {scoreCategoryLabel(clampedScore)}
      </p>

      {/* Breakdown */}
      {breakdown && breakdown.length > 0 && (
        <div className="border-t border-slate-100 pt-3 space-y-2">
          {breakdown.map((item, i) => (
            <BreakdownBar key={i} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
