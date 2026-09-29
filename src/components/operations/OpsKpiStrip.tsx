import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { TONE_TEXT, deltaOf, formatMetric, toneFor, type MetricValues, type OpsMetricDef, type OpsRecordDomain } from "./opsTypes";

interface Props {
  ids: string[];
  defs: Map<string, OpsMetricDef>;
  current: MetricValues | undefined;
  previous: MetricValues | undefined;
  loading: boolean;
  onOpenRecords: (domain: OpsRecordDomain) => void;
}

/** Headline tiles. A tile with a drill-through list is a button; hover shows the exact formula. */
export function OpsKpiStrip({ ids, defs, current, previous, loading, onOpenRecords }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-8">
      {ids.map((id) => {
        const def = defs.get(id);
        if (!def) return null;
        const value = current?.[id];
        const delta = deltaOf(value, previous?.[id], def.direction);
        const tone = toneFor(def, value);
        const clickable = !!def.records;
        const body = (
          <div className={cn("h-full rounded-xl border bg-card p-4 text-left transition", clickable && "hover:border-primary/50 hover:shadow-sm")}>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{def.label}</p>
            {loading && value === undefined ? (
              <div className="mt-2 h-8 w-20 animate-pulse rounded bg-muted" />
            ) : (
              <p className={cn("mt-1 text-2xl font-semibold tabular-nums", TONE_TEXT[tone])}>{formatMetric(value, def.unit)}</p>
            )}
            <p className={cn("mt-1 flex items-center gap-1 text-xs", delta ? TONE_TEXT[delta.tone] : "text-muted-foreground")}>
              {delta ? (
                <>
                  {delta.diff === 0 ? <Minus className="h-3 w-3" /> : delta.diff > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                  {delta.diff > 0 ? "+" : ""}{formatMetric(delta.diff, def.unit === "pct" ? "pct" : "count")} vs prev period
                </>
              ) : (
                "no prior-period data"
              )}
            </p>
          </div>
        );
        return (
          <Tooltip key={id}>
            <TooltipTrigger asChild>
              {clickable ? (
                <button type="button" className="h-full text-left" onClick={() => onOpenRecords(def.records!)} aria-label={`${def.label}: open list`}>{body}</button>
              ) : (
                <div className="h-full">{body}</div>
              )}
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">{def.formula}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
