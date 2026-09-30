import { ArrowDownRight, ArrowUpRight, ChevronRight, Minus } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { OpsSparkline } from "./OpsSparkline";
import { TONE_TEXT, deltaOf, formatMetric, toneFor, type MetricValues, type OpsMetricDef, type OpsRecordDomain, type Tone, type TrendPoint } from "./opsTypes";

/** KPI id -> daily series available from /trend, so those tiles get a sparkline. */
const SPARK_KEY: Record<string, keyof TrendPoint> = {
  attendance_pct: "attendancePct", shrinkage_pct: "shrinkagePct", absent_pct: "absentPct", late_pct: "latePct", exits: "exits", joiners: "joiners",
};
const SPARK_COLOR: Record<Tone, string> = { good: "#059669", warn: "#d97706", bad: "#e11d48", neutral: "#2563eb" };
const ACCENT: Record<Tone, string> = { good: "before:bg-emerald-500", warn: "before:bg-amber-500", bad: "before:bg-rose-500", neutral: "before:bg-primary/40" };

interface Props {
  ids: string[];
  defs: Map<string, OpsMetricDef>;
  current: MetricValues | undefined;
  previous: MetricValues | undefined;
  trend?: TrendPoint[];
  loading: boolean;
  onOpenRecords: (domain: OpsRecordDomain) => void;
}

/** Headline tiles: value, tone accent, change vs previous period, sparkline where a daily series exists, formula on hover. */
export function OpsKpiStrip({ ids, defs, current, previous, trend, loading, onOpenRecords }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6">
      {ids.map((id) => {
        const def = defs.get(id);
        if (!def) return null;
        const value = current?.[id];
        const delta = deltaOf(value, previous?.[id], def.direction);
        const tone = toneFor(def, value);
        const sparkKey = SPARK_KEY[id];
        const series = sparkKey && trend ? trend.map((t) => (t[sparkKey] as number | null)) : null;
        const clickable = !!def.records;
        const body = (
          <div className={cn(
            "relative h-full overflow-hidden rounded-xl border bg-card p-4 pl-5 text-left shadow-sm transition-all duration-200 before:absolute before:inset-y-0 before:left-0 before:w-1",
            ACCENT[tone], clickable && "hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md motion-reduce:hover:translate-y-0",
          )}>
            <div className="flex items-start justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{def.label}</p>
              {clickable && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" aria-hidden />}
            </div>
            {loading && value === undefined ? (
              <div className="mt-2 h-9 w-24 animate-pulse rounded bg-muted" />
            ) : (
              <p className={cn("mt-1 text-[1.7rem] font-semibold leading-tight tabular-nums", TONE_TEXT[tone])}>{formatMetric(value, def.unit)}</p>
            )}
            <p className={cn("mt-1 flex items-center gap-1 text-xs", delta ? TONE_TEXT[delta.tone] : "text-muted-foreground")}>
              {delta ? (
                <>
                  {delta.diff === 0 ? <Minus className="h-3 w-3" /> : delta.diff > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                  {delta.diff > 0 ? "+" : ""}{formatMetric(delta.diff, def.unit === "pct" ? "pct" : "count")} vs previous period
                </>
              ) : (
                <span>no prior-period figure</span>
              )}
            </p>
            {series && <OpsSparkline values={series} color={SPARK_COLOR[tone]} className="mt-2 text-muted-foreground" />}
          </div>
        );
        return (
          <Tooltip key={id}>
            <TooltipTrigger asChild>
              {clickable ? (
                <button type="button" className="h-full rounded-xl text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" onClick={() => onOpenRecords(def.records!)} aria-label={`${def.label}: ${formatMetric(value, def.unit)}. Open the list of people`}>{body}</button>
              ) : (
                <div className="h-full">{body}</div>
              )}
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs leading-relaxed">{def.formula}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
