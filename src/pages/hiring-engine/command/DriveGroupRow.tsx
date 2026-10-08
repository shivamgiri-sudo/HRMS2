/**
 * One drive group row: a requisition at a branch for one drive type. The header is a real button (aria-expanded / aria-controls,
 * Enter and Space native). Expanded it loads the day-wise table, two stacked charts and the extension history lazily.
 * `children` is the slot for the stream actions (Extend menu and dialogs); a function child receives the detail reload so a successful
 * change refreshes the trend and the extension history. This component itself never writes anything.
 */
import { useId, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Clock, History, Info, PlayCircle, RefreshCw } from "lucide-react";
import { TYPE_LABEL, sectionLabels } from "./driveCommandModel";
import { useIsDark } from "./chartTheme";
import { ShapeGlyph } from "./charts/TypePatterns";
import DriveTrendChart from "./DriveTrendChart";
import { useGroupDetail } from "./useGroupDetail";
import { DAY_COLUMNS, STATE_LABEL, collapsedCells, dayRows, eventLine, windowState, windowText, type WindowState } from "./driveGroupModel";
import type { DriveGroup, DriveTrend, StreamEvent } from "./driveCommandTypes";

const STATE_ICON: Record<WindowState, typeof Clock> = { upcoming: Clock, running: PlayCircle, ended: CheckCircle2 };
const RETRY = "inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border border-rose-400 bg-white px-3 text-xs font-semibold text-rose-800 transition-colors duration-150 hover:bg-rose-100 motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:bg-slate-900 dark:text-rose-200 dark:hover:bg-slate-800 sm:min-h-8";
const PULSE = "animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none dark:bg-slate-800";

export function TypeBadge({ type, compact }: { type: DriveGroup["sourceType"]; compact?: boolean }) {
  const dark = useIsDark();
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-2 py-0.5 text-xs font-semibold text-slate-800 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" title={TYPE_LABEL[type]}>
      <ShapeGlyph type={type} dark={dark} size={10} />
      <span className={compact ? "sr-only sm:not-sr-only" : undefined}>{TYPE_LABEL[type] ?? type}</span>
    </span>
  );
}

/** The day-wise table: one line per drive date across the whole window; today carries aria-current and the word "today". */
export function DayTable({ trend, today }: { trend: DriveTrend; today: string }) {
  const rows = dayRows(trend.points, today);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max border-collapse text-left text-xs text-slate-800 dark:text-slate-100">
        <caption className="mb-1 text-left text-xs text-slate-600 dark:text-slate-300">Day by day across the whole window; days still to come show wanted, lined up, invited and confirmed only</caption>
        <thead>
          <tr className="border-b border-slate-200 dark:border-slate-700">
            {DAY_COLUMNS.map((c, i) => <th key={c} scope="col" className={`px-2 py-1 font-semibold ${i === 0 ? "" : "text-right"}`}>{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.date} aria-current={r.isToday ? "date" : undefined} className={`border-b border-slate-100 last:border-0 dark:border-slate-800 ${r.isToday ? "bg-blue-50 font-semibold dark:bg-blue-950" : ""}`}>
              <th scope="row" className="whitespace-nowrap px-2 py-1 font-medium">
                {r.label}{r.isToday && <span className="ml-2 rounded border border-blue-700 px-1 text-[11px] font-bold text-blue-800 dark:border-blue-300 dark:text-blue-200">today</span>}
              </th>
              {r.cells.map((c, i) => <td key={i} className="px-2 py-1 text-right tabular-nums">{c}</td>)}
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={DAY_COLUMNS.length} className="px-2 py-3 text-center text-slate-600 dark:text-slate-300">No drive days in this window</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export function ExtensionHistory({ events, error, hasStreams }: { events: StreamEvent[]; error: string | null; hasStreams: boolean }) {
  if (!hasStreams) return null;
  return (
    <section aria-label="Extension history" className="space-y-1">
      <h4 className="flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-slate-100"><History className="h-3.5 w-3.5" aria-hidden /> Extension history</h4>
      {error && <p role="alert" className="text-xs text-rose-800 dark:text-rose-200">Could not load the history: {error}</p>}
      {!error && events.length === 0 && <p className="text-xs text-slate-600 dark:text-slate-300">No changes recorded yet</p>}
      {events.length > 0 && (
        <ul className="space-y-0.5 text-xs text-slate-800 dark:text-slate-100">
          {events.map((e) => <li key={e.id} className="break-words">{eventLine(e)}</li>)}
        </ul>
      )}
    </section>
  );
}

export type RowSlot = ReactNode | ((reloadDetail: () => void) => ReactNode);

function Detail({ group, today, children }: { group: DriveGroup; today: string; children?: RowSlot }) {
  const d = useGroupDetail(group, true);
  const slot = typeof children === "function" ? children(d.reload) : children;
  return <DetailView group={group} today={today} trend={d.trend} trendError={d.trendError} loading={d.loading} events={d.events} eventsError={d.eventsError} onRetry={d.reload}>{slot}</DetailView>;
}

export interface DetailViewProps {
  group: DriveGroup; today: string; trend: DriveTrend | null; trendError: string | null; loading: boolean;
  events: StreamEvent[]; eventsError: string | null; onRetry: () => void; children?: ReactNode;
}
/** Presentational body of an expanded row (static-markup tested). */
export function DetailView({ group, today, trend, trendError, loading, events, eventsError, onRetry, children }: DetailViewProps) {
  return (
    <div className="space-y-3 border-t border-slate-200 p-3 dark:border-slate-700" aria-busy={loading}>
      {loading && !trend && <div role="status" aria-label="Loading the day-wise trend" className={PULSE} style={{ height: 280 }} />}
      {trendError && !trend && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-700 dark:bg-rose-950 dark:text-rose-200">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">Could not load the trend: {trendError}</span>
          <button type="button" onClick={onRetry} className={RETRY}><RefreshCw className="h-3.5 w-3.5" aria-hidden /> Retry</button>
        </div>
      )}
      {trend?.partial && (
        <p role="status" className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          <Info className="h-4 w-4 shrink-0" aria-hidden /> Some numbers could not be loaded ({sectionLabels(trend.failedSections).join(", ") || "unknown"}) and show as zero
        </p>
      )}
      {trend && (<><DayTable trend={trend} today={today} /><DriveTrendChart points={trend.points} type={group.sourceType} today={today} /></>)}
      <ExtensionHistory events={events} error={eventsError} hasStreams={group.streamIds.length > 0} />
      {children}
    </div>
  );
}

export interface DriveGroupRowProps {
  group: DriveGroup; compact?: boolean; today: string;
  /** Test/preview hook: render expanded without loading (the live row expands on click). */
  initiallyOpen?: boolean;
  /** Slot for the stream actions, shown in the expanded body; a function receives the detail reload. */
  children?: RowSlot;
}

export default function DriveGroupRow({ group, compact = false, today, initiallyOpen = false, children }: DriveGroupRowProps) {
  const [open, setOpen] = useState(initiallyOpen);
  const bodyId = `group-${useId().replaceAll(":", "")}`;
  const state = windowState(group, today);
  const StateIcon = STATE_ICON[state];
  const cells = collapsedCells(group, today);
  return (
    <li className="min-w-0 rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      <button
        type="button" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 w-full cursor-pointer flex-col gap-2 rounded-lg px-3 py-2 text-left transition-colors duration-150 hover:bg-slate-50 motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-slate-800"
      >
        <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          {open ? <ChevronDown className="h-4 w-4 shrink-0 text-slate-600 dark:text-slate-300" aria-hidden /> : <ChevronRight className="h-4 w-4 shrink-0 text-slate-600 dark:text-slate-300" aria-hidden />}
          <span className="min-w-0 break-words text-sm font-bold text-slate-900 dark:text-slate-100">{group.requisition || "Requisition"}</span>
          <span className="min-w-0 break-words text-xs text-slate-700 dark:text-slate-200">{group.role}{group.role && group.branch ? " · " : ""}{group.branch}</span>
          <TypeBadge type={group.sourceType} compact={compact} />
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-800 dark:text-slate-100"><StateIcon className="h-3.5 w-3.5" aria-hidden /> {STATE_LABEL[state]}</span>
          <span className="text-xs text-slate-700 dark:text-slate-200">{windowText(group, today)}</span>
        </span>
        <span className={`grid gap-x-3 gap-y-1 pl-7 ${compact ? "grid-cols-4 sm:grid-cols-8" : "grid-cols-4 lg:grid-cols-8"}`}>
          {cells.map((c) => (
            <span key={c.label} className="flex min-w-0 flex-col">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">{c.label}</span>
              <span className="text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">{c.value}</span>
            </span>
          ))}
        </span>
      </button>
      <div id={bodyId} hidden={!open}>
        {open && <Detail group={group} today={today}>{children}</Detail>}
      </div>
    </li>
  );
}
