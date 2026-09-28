/**
 * Pure helpers for the Team Roster page: date formatting (DD/MM/YYYY), the closed set of cell
 * choices, labels for stored and proposed cells, status badges, and API error unpacking.
 */

export type CellType = "SHIFT" | "WEEK_OFF" | "TRAINING" | "UNSCHEDULED";

/** The closed set a manager may pick for a cell (besides a shift of the employee's own process). */
export const NON_SHIFT_CHOICES: Array<{ value: Exclude<CellType, "SHIFT">; label: string; short: string }> = [
  { value: "WEEK_OFF", label: "Week off", short: "WO" },
  { value: "TRAINING", label: "Training", short: "TRN" },
  { value: "UNSCHEDULED", label: "Unscheduled", short: "UNS" },
];

export type ShiftGroup = "Templates" | "In use" | "Shift master";
/** A shift a manager may pick for an employee of a process (merged server-side, de-duplicated by start/end). */
export interface ShiftOption {
  key: string; start: string; end: string; night: boolean; label: string; code: string | null; name: string | null;
  group: ShiftGroup; sources: string[]; useCount: number; templateId: string | null; shiftMasterId: string | null;
}
export interface TemplateProcess { processId: string; processName: string | null; options: ShiftOption[] }

/** shiftKey = 'HH:MM-HH:MM', the identity of a ShiftOption. */
export interface CellChoice { type: CellType; shiftKey: string | null }

export const SHIFT_GROUP_ORDER: ShiftGroup[] = ["Templates", "In use", "Shift master"];

export const shiftKeyOf = (start: string | null | undefined, end: string | null | undefined) =>
  start && end ? `${start.slice(0, 5)}-${end.slice(0, 5)}` : null;

export function splitShiftKey(key: string): { start: string; end: string } {
  const [start, end] = key.split("-");
  return { start, end };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 'YYYY-MM-DD' -> 'DD/MM/YYYY'. */
export function formatDmy(ymd: string | null | undefined): string {
  if (!ymd) return "None";
  const [y, m, d] = ymd.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : "None";
}

/** 'YYYY-MM-DD HH:mm:ss' -> 'DD/MM/YYYY HH:mm'. */
export function formatDmyTime(stamp: string | null | undefined): string {
  if (!stamp) return "None";
  return `${formatDmy(stamp)} ${stamp.slice(11, 16)}`.trim();
}

const utc = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

export function addDaysYmd(ymd: string, days: number): string {
  const t = new Date(utc(ymd) + days * 86_400_000);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** 0 = Sunday .. 6 = Saturday. */
export function weekdayNumber(ymd: string): number {
  return new Date(utc(ymd)).getUTCDay();
}

export function weekdayShort(ymd: string): string {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(utc(ymd)).getUTCDay()];
}

export function spanDays(from: string, to: string): number {
  return Math.round((utc(to) - utc(from)) / 86_400_000) + 1;
}

export type RangePreset = "next-7" | "this-week" | "next-week" | "next-14" | "next-30";

export const RANGE_PRESETS: Array<{ value: RangePreset; label: string }> = [
  { value: "next-7", label: "Next 7 days" },
  { value: "this-week", label: "This week" },
  { value: "next-week", label: "Next week" },
  { value: "next-14", label: "Next 14 days" },
  { value: "next-30", label: "Next 30 days" },
];

/** Monday-to-Sunday windows are clipped so they never start before today (past days cannot be edited). */
export function presetRange(preset: RangePreset, today: string): { from: string; to: string } {
  const dow = new Date(utc(today)).getUTCDay();
  const monday = addDaysYmd(today, -((dow + 6) % 7));
  switch (preset) {
    case "next-7": return { from: today, to: addDaysYmd(today, 6) };
    case "this-week": return { from: today, to: addDaysYmd(monday, 6) };
    case "next-week": return { from: addDaysYmd(monday, 7), to: addDaysYmd(monday, 13) };
    case "next-14": return { from: today, to: addDaysYmd(today, 13) };
    default: return { from: today, to: addDaysYmd(today, 29) };
  }
}

export const cellKey = (employeeId: string, date: string) => `${employeeId}|${date}`;

// ── choices ─────────────────────────────────────────────────────────────────

export const choiceValue = (c: CellChoice | null) => (!c ? "" : c.type === "SHIFT" ? `SHIFT:${c.shiftKey}` : c.type);

export function parseChoice(value: string): CellChoice | null {
  if (!value) return null;
  if (value.startsWith("SHIFT:")) return { type: "SHIFT", shiftKey: value.slice(6) };
  return NON_SHIFT_CHOICES.some((c) => c.value === value) ? { type: value as CellType, shiftKey: null } : null;
}

export const shiftOptionLabel = (o: ShiftOption) => o.label;

const times = (start: string | null, end: string | null) => (start && end ? `${start.slice(0, 5)}-${end.slice(0, 5)}` : "");

export function choiceLabel(c: CellChoice, options: ShiftOption[]): { short: string; long: string } {
  if (c.type === "SHIFT") {
    const o = options.find((x) => x.key === c.shiftKey);
    if (o) return { short: o.code || `${o.start}-${o.end}`, long: o.label };
    return c.shiftKey ? { short: c.shiftKey, long: c.shiftKey.replace("-", "–") } : { short: "Shift", long: "Shift" };
  }
  const meta = NON_SHIFT_CHOICES.find((x) => x.value === c.type);
  return { short: meta?.short ?? c.type, long: meta?.label ?? c.type };
}

export interface StoredCell {
  type: string | null; isWeekOff: boolean; shiftCode: string | null; shiftName: string | null; start: string | null; end: string | null;
}

/** What is already on the roster, for display in a read-only cell. */
export function storedLabel(a: StoredCell): { short: string; long: string } {
  const type = a.isWeekOff ? "WEEK_OFF" : (a.type ?? "").toUpperCase();
  if (type === "SHIFT" || (!type && (a.start || a.shiftCode))) {
    const range = times(a.start, a.end);
    return { short: a.shiftCode || range || "Shift", long: [a.shiftName || a.shiftCode, range].filter(Boolean).join(" ") || "Shift" };
  }
  const named: Record<string, { short: string; long: string }> = {
    WEEK_OFF: { short: "WO", long: "Week off" }, TRAINING: { short: "TRN", long: "Training" }, UNSCHEDULED: { short: "UNS", long: "Unscheduled" },
    LEAVE: { short: "L", long: "Leave" }, HOLIDAY: { short: "H", long: "Holiday" }, ABSENT: { short: "A", long: "Absent" },
    HALF_DAY: { short: "½", long: "Half day" }, UNASSIGNED: { short: "-", long: "Unassigned" },
  };
  return named[type] ?? { short: type || "-", long: type || "Unassigned" };
}

// ── status ──────────────────────────────────────────────────────────────────

export const STATUS_META: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-slate-100 text-slate-700" },
  pending_manager: { label: "Awaiting manager", className: "bg-amber-100 text-amber-800" },
  pending_wfm: { label: "Awaiting WFM", className: "bg-blue-100 text-blue-800" },
  applied: { label: "Applied", className: "bg-emerald-100 text-emerald-800" },
  partially_applied: { label: "Partly applied", className: "bg-orange-100 text-orange-800" },
  rejected: { label: "Rejected", className: "bg-red-100 text-red-800" },
  cancelled: { label: "Cancelled", className: "bg-slate-100 text-slate-500" },
};

export const LINE_STATUS_META: Record<string, { label: string; className: string }> = {
  pending: { label: "Pending", className: "bg-slate-100 text-slate-700" },
  applied: { label: "Applied", className: "bg-emerald-100 text-emerald-800" },
  skipped: { label: "Skipped", className: "bg-orange-100 text-orange-800" },
  failed: { label: "Failed", className: "bg-red-100 text-red-800" },
};

/** The status filter offered on My Submissions (closed set, never free text). */
export const SUBMISSION_STATUS_FILTERS = ["pending_manager", "pending_wfm", "applied", "partially_applied", "rejected", "cancelled"] as const;

export const AUDIT_ACTION_LABEL: Record<string, string> = {
  submitted: "Submitted", manager_approved: "Manager approved", manager_rejected: "Manager rejected", wfm_approved: "WFM approved",
  wfm_rejected: "WFM rejected", applied: "Applied to roster", partially_applied: "Partly applied to roster", cancelled: "Cancelled",
  copied_to_draft: "Copied back to a draft",
};

// ── errors ──────────────────────────────────────────────────────────────────

export interface ProblemDetail { employeeId?: string; employeeName?: string; date?: string; message: string }

export interface ApiFailure { message: string; code: string | null; details: ProblemDetail[] }

export function unpackError(err: unknown): ApiFailure {
  const e = err as { message?: string; payload?: { code?: string; message?: string; details?: unknown } } | null;
  const details = Array.isArray(e?.payload?.details) ? (e!.payload!.details as ProblemDetail[]).filter((d) => d && typeof d.message === "string") : [];
  return { message: e?.payload?.message || e?.message || "Something went wrong", code: e?.payload?.code ?? null, details };
}

// ── attendance preview ──────────────────────────────────────────────────────

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** 'YYYY-MM' -> 'Sep 2026'. */
export const monthLabel = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
};

/** The current month and the eleven before it, newest first. Never a future month. */
export function monthOptions(today: string, count = 12): Array<{ value: string; label: string }> {
  const [y, m] = today.split("-").map(Number);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    const value = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
    return { value, label: monthLabel(value) };
  });
}

/** Register colours, same palette as AttendanceRegisterExport.tsx (codes P/A/HD/L/OD/H). */
export const ATTENDANCE_CELL_CLASS: Record<string, string> = {
  P: "bg-green-100 text-green-900 font-bold",
  A: "bg-red-100 text-red-800 font-semibold",
  HD: "bg-amber-100 text-amber-900 font-semibold",
  L: "bg-blue-100 text-blue-800 font-semibold",
  H: "bg-slate-200 text-slate-700",
  OD: "bg-purple-100 text-purple-900 font-semibold",
};
export const attendanceCellClass = (code: string) => ATTENDANCE_CELL_CLASS[code?.toUpperCase()] ?? "text-slate-300";

/** Totals shown after the day columns, in the register's own order (Present, Absent, OD, HD, Leave, Holiday, Week-off). */
export const ATTENDANCE_TOTAL_COLUMNS = [
  { key: "present", label: "P" }, { key: "absent", label: "A" }, { key: "onDuty", label: "OD" }, { key: "halfDay", label: "HD" },
  { key: "leave", label: "L" }, { key: "holiday", label: "H" }, { key: "weekOff", label: "WO" }, { key: "totalWorkingDays", label: "Working days" },
] as const;
