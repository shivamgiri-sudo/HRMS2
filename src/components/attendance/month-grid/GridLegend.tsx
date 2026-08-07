import { LEGEND_ORDER, themeFor } from "@/lib/attendanceStatusTheme";

/**
 * The key to the grid.
 *
 * Both existing attendance legends in this codebase are inline JSX inside their
 * calendars, which is why the five colour maps drifted apart unnoticed — nothing
 * rendered them side by side. This one reads from the same module the cells do, so a
 * colour cannot change without the legend following it.
 */
export function GridLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-slate-600">
      {LEGEND_ORDER.map((state) => {
        const theme = themeFor(state);
        return (
          <span key={state} className="inline-flex items-center gap-1.5">
            <span className={`inline-block h-2 w-2 rounded-full ${theme.dot}`} aria-hidden="true" />
            <span className="font-mono font-semibold text-slate-700">{theme.letter}</span>
            <span>{theme.label}</span>
          </span>
        );
      })}
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-2 w-[3px] bg-indigo-500" aria-hidden="true" />
        <span>Regularized marker</span>
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-1.5 w-1.5 rounded-bl bg-amber-500" aria-hidden="true" />
        <span>Late mark</span>
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-[2px] w-2.5 bg-sky-400/70" aria-hidden="true" />
        <span>Sources disagreed (no action needed)</span>
      </span>
    </div>
  );
}
