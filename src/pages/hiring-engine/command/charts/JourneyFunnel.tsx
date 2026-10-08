/** One drive's full journey as a list: the bar is decoration; counts, conversions and drop-off are text (the table repeats them). */
import { TrendingDown } from "lucide-react";
import type { DriveAnalytics, SourceType } from "../driveCommandTypes";
import ChartFrame, { Note } from "./ChartFrame";
import { JOURNEY_LABEL, driveJourney } from "./journeyModel";

export default function JourneyFunnel({ analytics, type, title }: { analytics: DriveAnalytics; type: SourceType; title?: string }) {
  const j = driveJourney(analytics, type);
  const top = Math.max(1, ...j.rows.map((r) => r.count));
  const bd = j.biggestDrop;
  return (
    <ChartFrame title={title ?? `${j.label} journey`} subtitle="People at each stage, the share that moved on from the stage before and from the start, and how many were lost."
      table={j.table} empty={j.empty} emptyText={`No ${j.label} people in this range`} aria={j.aria} kind="grid"
      note={j.notes.length > 0 || bd ? (
        <div className="space-y-1" data-journey-notes={type}>
          {bd && (
            <p className="flex items-start gap-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100">
              <TrendingDown className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>Largest loss: {JOURNEY_LABEL[bd.from]} to {JOURNEY_LABEL[bd.to]}, {bd.lost} people</span>
            </p>
          )}
          {j.notes.map((n) => <Note key={n}>{n}</Note>)}
        </div>
      ) : undefined}>
      <ol className="space-y-2" aria-label={`${j.label} journey stages`}>
        {j.rows.map((r, i) => {
          const worst = !!bd && bd.to === r.key;
          return (
            <li key={r.key} data-journey-stage={`${type}-${r.key}`} className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_auto] items-center gap-2 text-xs text-slate-800 dark:text-slate-100">
              <span className="break-words font-semibold">{r.label}</span>
              <span className="h-3 min-w-0 rounded bg-slate-100 dark:bg-slate-800" aria-hidden>
                <span className={`block h-3 rounded ${worst ? "bg-amber-500 dark:bg-amber-400" : "bg-blue-600 dark:bg-blue-400"}`} style={{ width: `${Math.round((r.count / top) * 100)}%` }} />
              </span>
              <span className="text-right tabular-nums">
                <strong>{r.countText}</strong>
                {i > 0 && <span className="text-slate-600 dark:text-slate-300"> ({r.fromPrevText} of previous{r.dropOff ? `, ${r.dropOffText} lost` : ""})</span>}
                {worst && <span className="sr-only"> largest loss</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </ChartFrame>
  );
}
