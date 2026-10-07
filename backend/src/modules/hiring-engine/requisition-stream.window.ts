// Pure working-day window math for requisition streams. IST is a fixed +05:30 offset (no DST);
// all dates are YYYY-MM-DD and computed on UTC dates. Sundays are skipped like nextWorkingDay
// (he-plan.service.ts) unless a stream adds them as an exception.

export interface StreamWindow {
  openFrom: string;
  openDays: number;
  add: string[];
  skip: string[];
}

export type WindowChange =
  | { kind: "extend"; days: number }
  | { kind: "extend_to"; date: string }
  | { kind: "add_day"; day: string }
  | { kind: "skip_day"; day: string }
  | { kind: "shorten"; date: string };

export type WindowError =
  | "invalid_date"
  | "invalid_days"
  | "too_long"
  | "before_today"
  | "before_start"
  | "not_in_window"
  | "empty_window"
  | "no_change";

export const MAX_CREATE_DAYS = 60;
export const MAX_OPEN_DAYS = 120;
const MAX_SCAN_DAYS = 400;

export const WINDOW_MESSAGES: Record<WindowError, string> = {
  invalid_date: "Dates must be YYYY-MM-DD",
  invalid_days: "Days must be a whole number from 1 to 60",
  too_long: "A stream can be open for at most 120 days",
  before_today: "The new last day cannot be before today",
  before_start: "That day is before the stream starts",
  not_in_window: "That day is not inside the window",
  empty_window: "That would leave no days in the window; close the stream instead",
  no_change: "Nothing to change",
};

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function istToday(now: Date = new Date()): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function isValidDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}

function utcMs(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

export function addDays(day: string, n: number): string {
  return new Date(utcMs(day) + n * DAY_MS).toISOString().slice(0, 10);
}

export function isSunday(day: string): boolean {
  return new Date(utcMs(day)).getUTCDay() === 0;
}

export function isPlannedDay(day: string, w: Pick<StreamWindow, "add" | "skip">): boolean {
  if (w.skip.includes(day)) return false;
  return !isSunday(day) || w.add.includes(day);
}

export function windowDays(w: StreamWindow): string[] {
  const out: string[] = [];
  for (let i = 0; i < MAX_SCAN_DAYS && out.length < w.openDays; i++) {
    const d = addDays(w.openFrom, i);
    if (isPlannedDay(d, w)) out.push(d);
  }
  return out;
}

export function windowEnd(w: StreamWindow): string {
  const days = windowDays(w);
  return days.length ? days[days.length - 1] : w.openFrom;
}

export function countPlannedDays(from: string, to: string, w: Pick<StreamWindow, "add" | "skip">): number {
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) if (isPlannedDay(d, w)) n++;
  return n;
}

export function coversDay(w: StreamWindow, day: string): boolean {
  return windowDays(w).includes(day);
}

export function windowStatus(
  w: StreamWindow,
  today: string,
): { from: string; to: string; dayIndex: number; days: number; state: "upcoming" | "running" | "ended" } {
  const days = windowDays(w);
  const from = days.length ? days[0] : w.openFrom;
  const to = days.length ? days[days.length - 1] : w.openFrom;
  const dayIndex = today < from ? 0 : countPlannedDays(from, today < to ? today : to, w);
  const state = today < from ? "upcoming" : today > to ? "ended" : "running";
  return { from, to, dayIndex, days: w.openDays, state };
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shortDate(day: string): string {
  const d = new Date(utcMs(day));
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function windowLabel(w: StreamWindow, today: string): string {
  const s = windowStatus(w, today);
  if (s.state === "running") return `day ${s.dayIndex} of ${s.days}, ends ${shortDate(s.to)}`;
  if (s.state === "upcoming") return `starts ${shortDate(s.from)}, ${s.days} ${s.days === 1 ? "day" : "days"}`;
  return `ended ${shortDate(s.to)}`;
}

type ChangeResult = { ok: true; next: StreamWindow } | { ok: false; error: WindowError; message: string };

const fail = (error: WindowError): ChangeResult => ({ ok: false, error, message: WINDOW_MESSAGES[error] });

/** Last planned day on or before `date`, not before `floor`; null when none. */
function lastPlannedOnOrBefore(date: string, floor: string, w: Pick<StreamWindow, "add" | "skip">): string | null {
  for (let d = date; d >= floor; d = addDays(d, -1)) if (isPlannedDay(d, w)) return d;
  return null;
}

/** Keeps openFrom, sets the end to `newEnd`, recomputes openDays and runs the shared limit checks. */
function finish(w: StreamWindow, add: string[], skip: string[], newEnd: string, today: string): ChangeResult {
  const span = (utcMs(newEnd) - utcMs(w.openFrom)) / DAY_MS;
  if (span > MAX_SCAN_DAYS) return fail("too_long");
  const openDays = countPlannedDays(w.openFrom, newEnd, { add, skip });
  if (openDays > MAX_OPEN_DAYS) return fail("too_long");
  if (newEnd < today) return fail("before_today");
  return { ok: true, next: { openFrom: w.openFrom, openDays, add, skip } };
}

export function applyWindowChange(w: StreamWindow, c: WindowChange, today: string): ChangeResult {
  const end = windowEnd(w);
  switch (c.kind) {
    case "extend": {
      if (!Number.isInteger(c.days) || c.days < 1 || c.days > MAX_CREATE_DAYS) return fail("invalid_days");
      if (w.openDays + c.days > MAX_OPEN_DAYS) return fail("too_long");
      const next: StreamWindow = { ...w, openDays: w.openDays + c.days };
      return finish(w, w.add, w.skip, windowEnd(next), today);
    }
    case "extend_to":
    case "shorten": {
      if (!isValidDate(c.date)) return fail("invalid_date");
      if (c.date < today) return fail("before_today");
      if (c.kind === "shorten" && c.date >= end) return fail("no_change");
      const newEnd = lastPlannedOnOrBefore(c.date, w.openFrom, w);
      if (!newEnd) return fail(c.kind === "shorten" ? "empty_window" : "before_start");
      if (newEnd === end) return fail("no_change");
      return finish(w, w.add, w.skip, newEnd, today);
    }
    case "add_day": {
      if (!isValidDate(c.day)) return fail("invalid_date");
      if (c.day < today) return fail("before_today");
      if (c.day < w.openFrom) return fail("before_start");
      if (c.day <= end && isPlannedDay(c.day, w)) return fail("no_change");
      const skip = w.skip.filter((d) => d !== c.day);
      const add = isSunday(c.day) && !w.add.includes(c.day) ? [...w.add, c.day].sort() : w.add;
      return finish(w, add, skip, c.day > end ? c.day : end, today);
    }
    case "skip_day": {
      if (!isValidDate(c.day)) return fail("invalid_date");
      if (c.day < today) return fail("before_today");
      if (c.day < w.openFrom || c.day > end || !isPlannedDay(c.day, w)) return fail("not_in_window");
      const add = w.add.filter((d) => d !== c.day);
      const skip = isSunday(c.day) || w.skip.includes(c.day) ? w.skip : [...w.skip, c.day].sort();
      const newEnd = lastPlannedOnOrBefore(end, w.openFrom, { add, skip });
      if (!newEnd) return fail("empty_window");
      return finish(w, add, skip, newEnd, today);
    }
  }
}
