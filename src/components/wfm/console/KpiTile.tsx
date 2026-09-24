import * as React from "react";
import { cn } from "@/lib/utils";

export type KpiTone = "neutral" | "blue" | "green" | "amber" | "red" | "violet";

const TONE: Record<KpiTone, { value: string; icon: string }> = {
  neutral: { value: "text-slate-900", icon: "bg-slate-100 text-slate-700" },
  blue: { value: "text-blue-800", icon: "bg-blue-50 text-blue-800" },
  green: { value: "text-emerald-800", icon: "bg-emerald-50 text-emerald-800" },
  amber: { value: "text-amber-800", icon: "bg-amber-50 text-amber-800" },
  red: { value: "text-red-800", icon: "bg-red-50 text-red-800" },
  violet: { value: "text-violet-800", icon: "bg-violet-50 text-violet-800" },
};

export interface KpiTileProps {
  label: string;
  value: React.ReactNode;
  /** Small supporting line under the label. */
  sub?: React.ReactNode;
  /** Signed delta shown top-right; positive is treated as "worse" only when `deltaBad` is set. */
  delta?: number;
  deltaBad?: "up" | "down";
  tone?: KpiTone;
  icon?: React.ElementType;
  /** Small element (e.g. a live pulse) placed top-right. */
  adornment?: React.ReactNode;
  onClick?: () => void;
  className?: string;
}

/** Compact KPI tile for the data-dense console panels. */
export function KpiTile({
  label, value, sub, delta, deltaBad, tone = "neutral", icon: Icon, adornment, onClick, className,
}: KpiTileProps) {
  const t = TONE[tone];
  const bad = delta !== undefined && deltaBad !== undefined && (deltaBad === "up" ? delta > 0 : delta < 0);
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        {Icon ? (
          <span className={cn("flex h-8 w-8 items-center justify-center rounded-md", t.icon)}>
            <Icon className="h-4 w-4" aria-hidden />
          </span>
        ) : <span />}
        <span className="flex items-center gap-2">
          {adornment}
          {delta !== undefined && (
            <span className={cn("text-xs font-semibold", bad ? "text-red-700" : "text-emerald-700")}>
              {delta > 0 ? "+" : ""}{delta}%
            </span>
          )}
        </span>
      </div>
      <p className={cn("mt-2 text-2xl font-bold leading-none tabular-nums", t.value)}>{value}</p>
      <p className="mt-1 text-xs font-semibold text-slate-700">{label}</p>
      {sub != null && <p className="mt-0.5 text-xs text-slate-600">{sub}</p>}
    </>
  );
  const base = "rounded-lg border border-border bg-card p-3 text-left shadow-sm";
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(base, "cursor-pointer transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none", className)}
      >
        {body}
      </button>
    );
  }
  return <div className={cn(base, className)}>{body}</div>;
}

export default KpiTile;

/** Map the legacy per-panel tone names (slate/teal/purple…) onto KpiTile tones. */
export function toKpiTone(tone: string | undefined): KpiTone {
  switch (tone) {
    case "blue": case "teal": return "blue";
    case "green": return "green";
    case "amber": return "amber";
    case "red": return "red";
    case "violet": case "purple": return "violet";
    default: return "neutral";
  }
}
