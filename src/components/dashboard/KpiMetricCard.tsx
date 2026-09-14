import React from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, Minus, ExternalLink } from "lucide-react";

export interface KpiMetricCardProps {
  metric: string;
  value: number | string | null;
  unit: string;
  previousValue?: number | string;
  target?: number | string;
  trend?: "up" | "down" | "flat";
  status?: "good" | "bad" | "neutral";
  higherIsBetter?: boolean;
  loading?: boolean;
  onClick?: () => void;
  drilldownAvailable?: boolean;
}

function resolveTrendColor(
  trend: "up" | "down" | "flat" | undefined,
  status: "good" | "bad" | "neutral" | undefined,
  higherIsBetter: boolean
): string {
  if (!trend || trend === "flat") return "text-slate-500";
  if (status === "good") return "text-emerald-600";
  if (status === "bad") return "text-red-500";
  // derive from trend + higherIsBetter
  if (trend === "up") return higherIsBetter ? "text-emerald-600" : "text-red-500";
  return higherIsBetter ? "text-red-500" : "text-emerald-600";
}

function TrendIcon({ trend }: { trend?: "up" | "down" | "flat" }) {
  if (trend === "up") return <TrendingUp className="h-4 w-4" />;
  if (trend === "down") return <TrendingDown className="h-4 w-4" />;
  return <Minus className="h-4 w-4" />;
}

function statusBadgeVariant(status?: "good" | "bad" | "neutral") {
  if (status === "good") return "bg-emerald-50 text-emerald-700 border-emerald-100";
  if (status === "bad") return "bg-red-50 text-red-700 border-red-100";
  return "bg-amber-50 text-amber-700 border-amber-100";
}

function statusLabel(status?: "good" | "bad" | "neutral") {
  if (status === "good") return "On Track";
  if (status === "bad") return "Off Track";
  return "Neutral";
}

export function KpiMetricCard({
  metric,
  value,
  unit,
  previousValue,
  target,
  trend,
  status,
  higherIsBetter = true,
  loading = false,
  onClick,
  drilldownAvailable = false,
}: KpiMetricCardProps) {
  const trendColor = resolveTrendColor(trend, status, higherIsBetter);

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.04)] flex flex-col gap-2 transition-all duration-200",
        "before:absolute before:inset-x-0 before:top-0 before:h-1",
        status === "good" && "before:bg-emerald-400",
        status === "bad" && "before:bg-red-400",
        status === "neutral" && "before:bg-amber-400",
        !status && "before:bg-blue-400",
        onClick && "cursor-pointer hover:-translate-y-0.5 hover:shadow-[0_18px_40px_rgba(15,23,42,0.08)]"
      )}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => e.key === "Enter" && onClick() : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-bold text-slate-600 uppercase tracking-wide leading-tight">
          {metric}
        </span>
        {status && (
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold shrink-0",
              statusBadgeVariant(status)
            )}
          >
            {statusLabel(status)}
          </span>
        )}
      </div>

      <div className="flex items-end gap-1.5 pt-1">
        <span className="text-3xl font-black tracking-tight text-slate-950 leading-none">
          {value !== null && value !== undefined ? value : "—"}
        </span>
        {unit && (
          <span className="text-sm font-bold text-slate-400 mb-0.5">{unit}</span>
        )}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        {trend && (
          <span className={cn("flex items-center gap-1 text-xs font-medium", trendColor)}>
            <TrendIcon trend={trend} />
            {previousValue !== undefined && (
              <span>
                from {previousValue}
                {unit}
              </span>
            )}
          </span>
        )}
        {target !== undefined && (
          <span className="text-xs text-slate-400">
            Target: {target}
            {unit}
          </span>
        )}
      </div>

      {drilldownAvailable && onClick && (
        <button
          className="mt-1 flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-bold w-fit"
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
        >
          <ExternalLink className="h-3 w-3" />
          View Details
        </button>
      )}
    </div>
  );
}
