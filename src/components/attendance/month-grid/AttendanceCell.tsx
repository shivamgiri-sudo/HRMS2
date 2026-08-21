import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { resolveCellState, themeFor } from "@/lib/attendanceStatusTheme";
import type { TeamMonthDay } from "@/hooks/useTeamAttendanceMonth";
import { cn } from "@/lib/utils";

/**
 * One day for one employee.
 *
 * Carries a letter as well as a colour: this grid is read at a glance to decide
 * someone's pay, and colour alone is unreadable to anyone with a colour vision
 * deficiency.
 *
 * No TooltipProvider here — the grid mounts exactly one around all ~30,000 cells.
 * One per cell is the documented anti-pattern and would be ruinous at this count.
 */

export function AttendanceCell({
  day,
  weekend,
  isToday,
  onSelect,
  selected,
  width,
}: {
  day: TeamMonthDay;
  weekend: boolean;
  isToday: boolean;
  onSelect?: (day: TeamMonthDay) => void;
  selected?: boolean;
  /** Fixed px width. Passed in so the cell and its header cannot drift apart, and
   *  because table-layout:auto otherwise collapses 31 narrow columns to fit. */
  width: number;
}) {
  // Outside the employment window or still in the future: render an inert cell so the
  // row stays aligned, but never colour it as a gap. Chasing a row that must not exist
  // is the fastest way to lose a manager's trust in the whole grid.
  if (!day.applicable) {
    return (
      <td
        style={{ minWidth: width, width, maxWidth: width }}
        className={cn(
          "h-7 border border-slate-100 p-0 text-center align-middle",
          weekend ? "bg-slate-100/60" : "bg-slate-50/40",
        )}
        aria-hidden="true"
      />
    );
  }

  const state = resolveCellState({
    status: day.status,
    hasRecord: day.hasRecord,
    regularized: day.regularized,
    needsAttention: day.needsAttention,
  });
  const theme = themeFor(state);
  const dateLabel = new Date(day.d + "T00:00:00").toLocaleDateString("en-IN", {
    weekday: "short", day: "numeric", month: "short",
  });

  return (
    <Tooltip delayDuration={80}>
      <TooltipTrigger asChild>
        <td
          onClick={() => onSelect?.(day)}
          style={{ minWidth: width, width, maxWidth: width }}
          className={cn(
            "relative h-7 cursor-pointer border border-slate-100 p-0 text-center align-middle",
            "text-[10px] font-semibold leading-none transition-colors duration-150",
            theme.cell,
            isToday && "outline outline-1 outline-offset-[-1px] outline-sky-500",
            selected && "ring-2 ring-inset ring-slate-900",
          )}
          aria-label={`${dateLabel}: ${theme.label}`}
        >
          {/* Regularized keeps its paid-day colour; the bar says it was corrected. */}
          {day.regularized && (
            <span className="absolute inset-y-0 left-0 w-[3px] bg-indigo-500" aria-hidden="true" />
          )}
          {theme.letter}
          {day.lateMark && (
            <span className="absolute right-0 top-0 h-1.5 w-1.5 rounded-bl bg-amber-500" aria-hidden="true" />
          )}
          {/* The sources disagreed. Worth seeing, but the day HAS a decision and
              payroll will pay it — so a hairline, not an alarm. */}
          {day.sourceMismatch && !day.needsAttention && (
            <span className="absolute inset-x-0 bottom-0 h-[2px] bg-sky-400/70" aria-hidden="true" />
          )}
        </td>
      </TooltipTrigger>

      {/* Deliberately a glance, not a report: a click now opens the full Day Detail panel
          with every field this used to cram in here (LWP, source, late-by, mismatch note,
          raw status_change_reason) plus real actions. Piling all of that into a hover
          popover was the "not very clear / not user friendly" complaint — a wall of
          same-size text with a raw machine-written audit string sitting next to a plain
          sentence, no visual hierarchy. This says only what's worth knowing before you
          decide whether to click at all. */}
      <TooltipContent side="top" className="max-w-[14rem] space-y-1.5">
        <p className="text-sm font-semibold leading-tight text-slate-100">{dateLabel}</p>
        <p className="text-xs font-medium text-slate-300">{theme.label}</p>

        {!day.hasRecord ? (
          <p className="text-xs text-orange-300">No record — blocks payroll.</p>
        ) : (
          <p className="text-xs text-slate-400">
            In {day.clockIn ?? "—"} · Out {day.clockOut ?? "—"}
          </p>
        )}
        {day.needsAttention && day.hasRecord && (
          <p className="text-xs font-medium text-orange-300">Blocks payroll</p>
        )}
        {day.pendingRegularizationId && (
          <p className="text-xs font-medium text-amber-300">Correction pending</p>
        )}

        <p className="border-t border-slate-700 pt-1 text-[11px] text-slate-500">Click for full details</p>
      </TooltipContent>
    </Tooltip>
  );
}
