import { TrendingUp, TrendingDown, Minus } from "lucide-react";

export interface MetricTileEnhancedProps {
  label: string;
  value: number | string | null;
  unit?: string;
  previousValue?: number | null;
  target?: number | null;
  variance?: number | null;
  variancePct?: number | null;
  trend?: "up" | "down" | "stable" | null;
  status?: "ok" | "warn" | "critical" | "unknown" | "good" | "warning" | null;
  higherIsBetter?: boolean;
  icon?: React.ReactNode;
  loading?: boolean;
  className?: string;
  animate?: boolean;
}

function trendIcon(trend?: string | null, higherIsBetter = true) {
  if (trend === "up") {
    return higherIsBetter
      ? <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
      : <TrendingUp className="h-3.5 w-3.5 text-red-500" />;
  }
  if (trend === "down") {
    return higherIsBetter
      ? <TrendingDown className="h-3.5 w-3.5 text-red-500" />
      : <TrendingDown className="h-3.5 w-3.5 text-emerald-500" />;
  }
  return <Minus className="h-3.5 w-3.5 text-slate-400" />;
}

function statusColors(status?: string | null) {
  if (status === "ok" || status === "good") return { bg: "bg-emerald-50 border-emerald-200", val: "text-emerald-700", bar: "bg-emerald-500" };
  if (status === "warn" || status === "warning") return { bg: "bg-amber-50 border-amber-200", val: "text-amber-700", bar: "bg-amber-500" };
  if (status === "critical") return { bg: "bg-red-50 border-red-200", val: "text-red-700", bar: "bg-red-500" };
  return { bg: "bg-slate-50 border-slate-200", val: "text-slate-700", bar: "bg-slate-400" };
}

function varianceBadge(variancePct?: number | null, higherIsBetter = true) {
  if (variancePct == null || isNaN(variancePct)) return null;
  const isPositive = variancePct >= 0;
  const isGood = higherIsBetter ? isPositive : !isPositive;
  const sign = isPositive ? "+" : "";
  const cls = isGood
    ? "bg-emerald-100 text-emerald-700 border-emerald-200"
    : "bg-red-100 text-red-700 border-red-200";
  return (
    <span className={`inline-flex rounded-full border px-1.5 py-0.5 text-[10px] font-bold ${cls}`}>
      {sign}{variancePct.toFixed(1)}% vs target
    </span>
  );
}

export function MetricTileEnhanced({
  label, value, unit = "", previousValue, target, variance, variancePct,
  trend, status, higherIsBetter = true, icon, loading, className = "",
}: MetricTileEnhancedProps) {
  const colors = statusColors(status);

  if (loading) {
    return (
      <div className={`rounded-2xl border ${colors.bg} p-4 shadow-sm animate-pulse ${className}`}>
        <div className="h-3 w-20 bg-slate-200 rounded mb-2" />
        <div className="h-7 w-16 bg-slate-200 rounded" />
      </div>
    );
  }

  const displayValue = value !== null && value !== undefined
    ? (typeof value === "number" ? value.toLocaleString("en-IN") : String(value))
    : "—";

  const achievementPct = target && target > 0 && typeof value === "number"
    ? Math.min(Math.round((value / target) * 100), 150)
    : null;

  return (
    <div className={`group relative overflow-hidden rounded-2xl border ${colors.bg} p-4 shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 ${className}`}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 truncate">{label}</p>
        </div>
        {icon && (
          <div className="flex-shrink-0 rounded-xl bg-white/60 p-2 shadow-sm">{icon}</div>
        )}
      </div>

      {/* Value row */}
      <div className="mt-2 flex items-end gap-2">
        <span className={`text-2xl font-black tracking-tight ${colors.val}`}>
          {displayValue}
          {unit && <span className="ml-0.5 text-sm font-semibold text-slate-400">{unit}</span>}
        </span>
        <div className="mb-0.5 flex items-center gap-1">
          {trendIcon(trend, higherIsBetter)}
        </div>
      </div>

      {/* Target progress bar */}
      {achievementPct !== null && (
        <div className="mt-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-slate-400 font-medium">vs target ({target?.toLocaleString("en-IN")})</span>
            <span className="text-[10px] font-bold text-slate-600">{achievementPct}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-slate-200 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${colors.bar}`}
              style={{ width: `${Math.min(achievementPct, 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Footer: variance badge + previous value */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {varianceBadge(variancePct, higherIsBetter)}
        {previousValue != null && (
          <span className="text-[10px] text-slate-400">
            vs {previousValue.toLocaleString("en-IN")} prev month
          </span>
        )}
      </div>
    </div>
  );
}
