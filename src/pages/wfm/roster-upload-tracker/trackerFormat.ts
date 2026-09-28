import type { TrackerCell, UploadStatus } from "./trackerTypes";

const IST = "Asia/Kolkata";

export interface StatusMeta {
  label: string;
  glyph: string;
  /** Cell chip: fill, border and text. */
  cell: string;
  /** Small pill in headers, drawers and the legend. */
  pill: string;
  /** Legend swatch. */
  swatch: string;
  meaning: string;
}

// Green / orange / red are the owner's colour code; partial gets its own hatched indigo and
// "due" a dashed grey so neither can be mistaken for the three deadline outcomes.
export const STATUS_META: Record<UploadStatus, StatusMeta> = {
  uploaded: {
    label: "Uploaded",
    glyph: "✓",
    cell: "bg-emerald-100 border-emerald-300 text-emerald-800",
    pill: "bg-emerald-100 border-emerald-300 text-emerald-800",
    swatch: "bg-emerald-100 border-emerald-300",
    meaning: "fully uploaded by Sunday 18:00",
  },
  delayed: {
    label: "Delayed",
    glyph: "◷",
    cell: "bg-orange-100 border-orange-300 text-orange-800",
    pill: "bg-orange-100 border-orange-300 text-orange-800",
    swatch: "bg-orange-100 border-orange-300",
    meaning: "fully uploaded, but after the deadline",
  },
  partial: {
    label: "Partial",
    glyph: "◐",
    cell:
      "bg-indigo-50 border-indigo-300 text-indigo-800 bg-[repeating-linear-gradient(135deg,transparent_0_6px,rgba(99,102,241,0.14)_6px_8px)]",
    pill: "bg-indigo-50 border-indigo-300 text-indigo-800",
    swatch: "bg-indigo-50 border-indigo-300 bg-[repeating-linear-gradient(135deg,transparent_0_3px,rgba(99,102,241,0.3)_3px_5px)]",
    meaning: "only some employees are in an uploaded roster",
  },
  missing: {
    label: "Missing",
    glyph: "✕",
    cell: "bg-red-100 border-red-300 text-red-800",
    pill: "bg-red-100 border-red-300 text-red-800",
    swatch: "bg-red-100 border-red-300",
    meaning: "deadline passed, nothing uploaded",
  },
  due: {
    label: "Due",
    glyph: "○",
    cell: "bg-slate-50 border-slate-300 border-dashed text-slate-600",
    pill: "bg-slate-100 border-slate-300 text-slate-700",
    swatch: "bg-slate-50 border-slate-300 border-dashed",
    meaning: "deadline not reached yet",
  },
};

const DAY_TIME: Intl.DateTimeFormatOptions = { timeZone: IST, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false };

/** "Sat 11:20" in IST. */
export function formatDayTime(ms: number): string {
  return new Intl.DateTimeFormat("en-GB", DAY_TIME).format(ms).replace(",", "");
}

/** "21/09/2026 18:00" in IST (DD/MM/YYYY HH:mm, the platform's date format). */
export function formatDateTime(ms: number): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: IST, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(ms);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")}`;
}

/** "21 Sep" from a YYYY-MM-DD string, without a timezone shift. */
export function formatShortDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
}

export function formatDuration(hours: number): string {
  if (hours < 24) return `${Math.round(hours)} h`;
  const days = Math.floor(hours / 24);
  const rest = Math.round(hours - days * 24);
  return rest ? `${days} d ${rest} h` : `${days} d`;
}

/** Second line of a grid cell: when it landed, how late, or how long is left. */
export function cellCaption(cell: TrackerCell): string {
  switch (cell.status) {
    case "uploaded":
      return cell.uploadedAtMs ? formatDayTime(cell.uploadedAtMs) : "On time";
    case "delayed":
      return `+${formatDuration(cell.hoursLate ?? 0)} late`;
    case "partial":
      return cell.hoursLate !== null ? `${formatDuration(cell.hoursLate)} overdue` : `${cell.hoursToDeadline !== null ? `due in ${formatDuration(cell.hoursToDeadline)}` : ""}`;
    case "missing":
      return `${formatDuration(cell.hoursLate ?? 0)} overdue`;
    case "due":
      return cell.hoursToDeadline !== null ? `due in ${formatDuration(cell.hoursToDeadline)}` : "";
  }
}

export function coverageLabel(cell: TrackerCell): string {
  return `${cell.covered}/${cell.expected}`;
}
