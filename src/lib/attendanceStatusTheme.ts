/**
 * One place that says what an attendance day looks like.
 *
 * Five status→colour maps exist in this codebase and they disagree: AttendanceCalendar
 * (absent = red), Attendance.tsx (absent = slate), TeamAttendanceTab (absent = rose,
 * half_day = blue), AttendanceTab (holiday = blue, leave = purple) and
 * ADRAttendanceCalendar. The same day is a different colour depending on which screen
 * you opened, which makes colour useless as a signal.
 *
 * This module is the definition for the team month grid. It is deliberately NOT
 * retro-fitted to the existing five — that is a separate change with its own
 * regression surface. New surfaces should import from here.
 *
 * Palette follows AttendanceCalendar.tsx:229-261, the most complete of the five.
 *
 * Every state carries a LETTER as well as a colour. Colour alone fails anyone with a
 * colour vision deficiency, and this grid is read at a glance to decide someone's pay.
 */

/** Raw `attendance_daily_record.attendance_status` values, plus our two derived states. */
export type AttendanceCellState =
  | "present"
  | "half_day"
  | "absent"
  | "leave_approved"
  | "week_off"
  | "week_off_worked"
  | "holiday"
  | "regularized"
  | "needs_attention"
  | "missing";

export interface CellTheme {
  /** Shown inside the cell. Two characters at most — the column is ~26px wide. */
  letter: string;
  /** Full name, for the tooltip, the legend and screen readers. */
  label: string;
  /** Cell background + text. */
  cell: string;
  /** Solid dot for the legend. */
  dot: string;
  /** Counts toward paid days — drives the "absenteeism" and "attention" filters. */
  paid: number;
}

export const ATTENDANCE_CELL_THEME: Record<AttendanceCellState, CellTheme> = {
  present: {
    letter: "P", label: "Present", paid: 1,
    cell: "bg-emerald-50 text-emerald-800 hover:bg-emerald-100",
    dot: "bg-emerald-500",
  },
  half_day: {
    letter: "HD", label: "Half day", paid: 0.5,
    cell: "bg-amber-50 text-amber-800 hover:bg-amber-100",
    dot: "bg-amber-500",
  },
  absent: {
    letter: "A", label: "Absent", paid: 0,
    cell: "bg-red-50 text-red-800 hover:bg-red-100",
    dot: "bg-red-500",
  },
  leave_approved: {
    letter: "L", label: "Leave (approved)", paid: 1,
    cell: "bg-blue-50 text-blue-800 hover:bg-blue-100",
    dot: "bg-blue-500",
  },
  week_off: {
    letter: "W", label: "Week off", paid: 0,
    cell: "bg-slate-50 text-slate-500 hover:bg-slate-100",
    dot: "bg-slate-400",
  },
  week_off_worked: {
    letter: "W+", label: "Week off worked", paid: 1,
    cell: "bg-teal-50 text-teal-800 hover:bg-teal-100",
    dot: "bg-teal-500",
  },
  holiday: {
    letter: "H", label: "Holiday", paid: 0,
    cell: "bg-purple-50 text-purple-800 hover:bg-purple-100",
    dot: "bg-purple-500",
  },
  regularized: {
    // Keeps the emerald of a paid day; the indigo bar is added by the cell component,
    // because "this was corrected" is a property OF a day, not a replacement for it.
    letter: "R", label: "Regularized", paid: 1,
    cell: "bg-emerald-50 text-emerald-800 hover:bg-emerald-100",
    dot: "bg-indigo-500",
  },
  needs_attention: {
    // Loudest state on the grid on purpose: these are exactly the days that block
    // payroll from calculating, so a quiet grid means a closable month.
    letter: "M", label: "Needs attention", paid: 0,
    cell: "bg-orange-100 text-orange-900 ring-1 ring-inset ring-orange-300 hover:bg-orange-200",
    dot: "bg-orange-500",
  },
  missing: {
    // No attendance_daily_record row at all. This is PARTIAL_ATTENDANCE_DAYS_MISSING,
    // the single biggest payroll blocker, and it renders as an empty cell everywhere
    // else in the product — which is why nobody sees it until payroll refuses to run.
    letter: "·", label: "No record", paid: 0,
    cell: "bg-orange-50 text-orange-700 ring-1 ring-inset ring-orange-200 border-dashed hover:bg-orange-100",
    dot: "bg-orange-300",
  },
};

/**
 * Which state a cell should render as.
 *
 * Order matters. A day that was regularized is shown as regularized even though its
 * status is now 'present' — the correction is the thing a manager is checking for.
 * A day needing attention outranks everything else, because it is the only state
 * that requires action.
 */
export function resolveCellState(cell: {
  status?: string | null;
  hasRecord?: boolean;
  regularized?: boolean;
  needsAttention?: boolean;
}): AttendanceCellState {
  if (cell.hasRecord === false) return "missing";
  if (cell.needsAttention) return "needs_attention";
  if (cell.regularized) return "regularized";
  const s = String(cell.status ?? "");
  if (s in ATTENDANCE_CELL_THEME) return s as AttendanceCellState;
  return "missing";
}

export function themeFor(state: AttendanceCellState): CellTheme {
  return ATTENDANCE_CELL_THEME[state] ?? ATTENDANCE_CELL_THEME.missing;
}

/** Legend order — reading order for a manager, not alphabetical. */
export const LEGEND_ORDER: AttendanceCellState[] = [
  "present",
  "regularized",
  "half_day",
  "leave_approved",
  "absent",
  "needs_attention",
  "missing",
  "week_off",
  "holiday",
];
