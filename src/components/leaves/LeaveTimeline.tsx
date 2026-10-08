import { Check, Minus, X } from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import { buildTimeline, type TimelineInput, type TimelineState } from "./leaveStatus";

const DOT: Record<TimelineState, string> = {
  done: "border-primary bg-primary text-primary-foreground",
  current: "border-amber-500 bg-amber-50 text-amber-700 ring-4 ring-amber-100",
  upcoming: "border-border bg-card text-muted-foreground",
  skipped: "border-border bg-muted text-muted-foreground",
  rejected: "border-red-600 bg-red-600 text-white",
};

/** The steps a leave request goes through, with who/when under each. */
export function LeaveTimeline(props: TimelineInput) {
  const steps = buildTimeline(props);
  return (
    <ol className="grid gap-3 sm:grid-flow-col sm:auto-cols-fr" aria-label="Request progress">
      {steps.map((step) => (
        <li key={step.key} className="flex items-start gap-2.5">
          <span className={cn("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-[10px] font-bold", DOT[step.state])}>
            {step.state === "done" ? <Check className="h-3.5 w-3.5" aria-hidden="true" />
              : step.state === "rejected" ? <X className="h-3.5 w-3.5" aria-hidden="true" />
              : step.state === "skipped" ? <Minus className="h-3.5 w-3.5" aria-hidden="true" />
              : <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />}
          </span>
          <div className="min-w-0">
            <p className={cn("text-xs font-semibold", step.state === "upcoming" || step.state === "skipped" ? "text-muted-foreground" : "text-foreground")}>
              {step.label}
              <span className="sr-only"> — {step.state}</span>
            </p>
            {(step.detail || step.at) && (
              <p className="text-[11px] leading-4 text-muted-foreground">
                {[step.detail, step.at ? formatDate(step.at) : null].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
