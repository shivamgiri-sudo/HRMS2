import type { LucideIcon } from "lucide-react";
import { AlertTriangle, ArrowLeftRight, Briefcase, Circle, History, LogIn, LogOut, RotateCcw, TrendingUp } from "lucide-react";
import { SectionCard } from "./SectionCard";
import { fmtDate, humanize } from "./rejoinReviewFormat";
import type { SectionResult, TimelineSection } from "./rejoinTypes";

const KIND_ICON: Record<string, LucideIcon> = {
  joining: LogIn,
  job_change: Briefcase,
  promotion: TrendingUp,
  transfer: ArrowLeftRight,
  warning: AlertTriangle,
  exit: LogOut,
  rejoin_request: RotateCcw,
};

/** Every recorded event of the employee, newest first. Sources that failed are named, not silently dropped. */
export function TimelineSectionCard({ result }: { result: SectionResult<TimelineSection> }) {
  return (
    <SectionCard
      id="timeline"
      title="Timeline"
      icon={History}
      result={result}
      isEmpty={(d) => d.events.length === 0 && d.skipped.length === 0}
      emptyText="No events on record."
    >
      {(d) => {
        // The backend already sorts; re-sorting by the 'YYYY-MM-DD' string keeps newest-first a guarantee here.
        const events = [...d.events].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
        return (
          <>
            {d.skipped.length > 0 && (
              <p role="note" className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="break-words">This timeline may be incomplete (missing: {d.skipped.join(", ")}).</span>
              </p>
            )}
            {events.length === 0 ? (
              <p className="text-xs italic text-muted-foreground">No events on record.</p>
            ) : (
              <ol className="max-h-96 space-y-0 overflow-y-auto pr-1" aria-label="Employee timeline, newest first">
                {events.map((e, i) => {
                  const Icon = KIND_ICON[e.kind] ?? Circle;
                  return (
                    <li key={`${e.date}-${e.kind}-${i}`} className="relative flex gap-3 pb-3 last:pb-0">
                      <span className="flex flex-col items-center">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-muted">
                          <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                        </span>
                        {i < events.length - 1 && <span className="mt-1 w-px flex-1 bg-border" aria-hidden />}
                      </span>
                      <div className="min-w-0 pb-1">
                        <p className="text-[11px] text-muted-foreground">
                          <time dateTime={e.date}>{fmtDate(e.date)}</time> · {humanize(e.kind)}
                        </p>
                        <p className="break-words text-sm font-medium">{e.title}</p>
                        {e.detail && <p className="break-words text-xs text-muted-foreground">{humanize(e.detail)}</p>}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </>
        );
      }}
    </SectionCard>
  );
}
