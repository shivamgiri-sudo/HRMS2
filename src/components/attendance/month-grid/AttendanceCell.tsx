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

const MINUTES = (m?: number) =>
  !m ? "—" : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;

const SOURCE_LABEL: Record<string, string> = {
  dialler: "APR / dialler",
  biometric: "Biometric punch",
};

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

      <TooltipContent side="top" className="max-w-[16rem] space-y-1 text-xs">
        <p className="font-semibold text-slate-100">{dateLabel} · {theme.label}</p>

        {!day.hasRecord ? (
          <p className="text-orange-300">
            No attendance record exists for this day. Payroll will not run for the month
            until every employee has a record for every day.
          </p>
        ) : (
          <>
            <p className="text-slate-300">
              In {day.clockIn ?? "—"} · Out {day.clockOut ?? "—"} · Worked {MINUTES(day.minutes)}
            </p>
            <p className="text-slate-300">
              LWP {Number(day.lwp ?? 0).toFixed(2)}
              {day.lateMark ? ` · Late by ${day.lateBy ?? 0}m` : ""}
            </p>
            <p className="text-slate-400">
              Source: {SOURCE_LABEL[String(day.source)] ?? day.source ?? "—"}
              {day.sourceSystem ? ` (${day.sourceSystem})` : ""}
            </p>
            {day.regularized && <p className="text-indigo-300">Corrected by an approved regularization.</p>}
            {day.overridden && <p className="text-indigo-300">Manually overridden.</p>}
            {day.locked && <p className="text-slate-400">Locked for payroll.</p>}
            {day.sourceMismatch && (
              <p className="text-sky-300">
                APR and biometric disagreed on this day. The status above is what payroll
                will use — no action needed unless it looks wrong.
              </p>
            )}
            {day.note && <p className="text-slate-400">“{day.note}”</p>}
          </>
        )}

        {day.needsAttention && day.hasRecord && (
          <p className="text-orange-300">
            This day has no usable attendance decision yet and will block payroll.
          </p>
        )}
        {day.pendingRegularizationId && (
          <p className="text-amber-300">A regularization request is awaiting approval.</p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
