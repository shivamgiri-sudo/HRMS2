/**
 * Client copy of the stream working-day window maths (backend/src/modules/hiring-engine/requisition-stream.window.ts is the source
 * of truth; the frontend cannot import backend code). Used only to preview a change and pre-validate it: the server re-checks
 * everything and its returned stream replaces the row. Sundays are skipped unless the stream adds them. Dates are YYYY-MM-DD on UTC.
 */
import { addDaysIso, isIsoDay } from "./driveCommandModel";

export interface ClientWindow { openFrom: string; openDays: number; add: string[]; skip: string[] }
export type ClientWindowChange =
  | { kind: "extend"; days: number }
  | { kind: "extend_to"; date: string }
  | { kind: "add_day"; day: string }
  | { kind: "skip_day"; day: string }
  | { kind: "shorten"; date: string };
export type ClientWindowError = "invalid_date" | "invalid_days" | "too_long" | "before_today" | "before_start" | "not_in_window" | "empty_window" | "no_change";

export const MAX_CREATE_DAYS = 60;
export const MAX_OPEN_DAYS = 120;
const MAX_SCAN_DAYS = 400;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Same words as the server's WINDOW_MESSAGES. */
export const WINDOW_MESSAGES: Record<ClientWindowError, string> = {
  invalid_date: "Dates must be YYYY-MM-DD",
  invalid_days: "Days must be a whole number from 1 to 60",
  too_long: "A stream can be open for at most 120 days",
  before_today: "The new last day cannot be before today",
  before_start: "That day is before the stream starts",
  not_in_window: "That day is not inside the window",
  empty_window: "That would leave no days in the window; close the stream instead",
  no_change: "Nothing to change",
};

const utcMs = (day: string): number => Date.parse(`${day}T00:00:00Z`);
export const isSundayIso = (day: string): boolean => new Date(utcMs(day)).getUTCDay() === 0;

export function isPlannedDay(day: string, w: Pick<ClientWindow, "add" | "skip">): boolean {
  if (w.skip.includes(day)) return false;
  return !isSundayIso(day) || w.add.includes(day);
}

export function windowDays(w: ClientWindow): string[] {
  const out: string[] = [];
  for (let i = 0; i < MAX_SCAN_DAYS && out.length < w.openDays; i++) {
    const d = addDaysIso(w.openFrom, i);
    if (isPlannedDay(d, w)) out.push(d);
  }
  return out;
}

export function windowEnd(w: ClientWindow): string {
  const days = windowDays(w);
  return days.length ? days[days.length - 1] : w.openFrom;
}

function countPlannedDays(from: string, to: string, w: Pick<ClientWindow, "add" | "skip">): number {
  let n = 0;
  for (let d = from; d <= to; d = addDaysIso(d, 1)) if (isPlannedDay(d, w)) n++;
  return n;
}

function lastPlannedOnOrBefore(date: string, floor: string, w: Pick<ClientWindow, "add" | "skip">): string | null {
  for (let d = date; d >= floor; d = addDaysIso(d, -1)) if (isPlannedDay(d, w)) return d;
  return null;
}

export type ClientChangeResult = { ok: true; next: ClientWindow; end: string } | { ok: false; error: ClientWindowError; message: string };
const fail = (error: ClientWindowError): ClientChangeResult => ({ ok: false, error, message: WINDOW_MESSAGES[error] });

function finish(w: ClientWindow, add: string[], skip: string[], newEnd: string, today: string): ClientChangeResult {
  if ((utcMs(newEnd) - utcMs(w.openFrom)) / DAY_MS > MAX_SCAN_DAYS) return fail("too_long");
  const openDays = countPlannedDays(w.openFrom, newEnd, { add, skip });
  if (openDays > MAX_OPEN_DAYS) return fail("too_long");
  if (newEnd < today) return fail("before_today");
  const next = { openFrom: w.openFrom, openDays, add, skip };
  return { ok: true, next, end: windowEnd(next) };
}

/** Mirror of the server's applyWindowChange (same rules, same order of checks). */
export function previewWindowChange(w: ClientWindow, c: ClientWindowChange, today: string): ClientChangeResult {
  const end = windowEnd(w);
  switch (c.kind) {
    case "extend": {
      if (!Number.isInteger(c.days) || c.days < 1 || c.days > MAX_CREATE_DAYS) return fail("invalid_days");
      if (w.openDays + c.days > MAX_OPEN_DAYS) return fail("too_long");
      return finish(w, w.add, w.skip, windowEnd({ ...w, openDays: w.openDays + c.days }), today);
    }
    case "extend_to":
    case "shorten": {
      if (!isIsoDay(c.date)) return fail("invalid_date");
      if (c.date < today) return fail("before_today");
      if (c.kind === "shorten" && c.date >= end) return fail("no_change");
      const newEnd = lastPlannedOnOrBefore(c.date, w.openFrom, w);
      if (!newEnd) return fail(c.kind === "shorten" ? "empty_window" : "before_start");
      if (newEnd === end) return fail("no_change");
      return finish(w, w.add, w.skip, newEnd, today);
    }
    case "add_day": {
      if (!isIsoDay(c.day)) return fail("invalid_date");
      if (c.day < today) return fail("before_today");
      if (c.day < w.openFrom) return fail("before_start");
      if (c.day <= end && isPlannedDay(c.day, w)) return fail("no_change");
      const skip = w.skip.filter((d) => d !== c.day);
      const add = isSundayIso(c.day) && !w.add.includes(c.day) ? [...w.add, c.day].sort() : w.add;
      return finish(w, add, skip, c.day > end ? c.day : end, today);
    }
    case "skip_day": {
      if (!isIsoDay(c.day)) return fail("invalid_date");
      if (c.day < today) return fail("before_today");
      if (c.day < w.openFrom || c.day > end || !isPlannedDay(c.day, w)) return fail("not_in_window");
      const add = w.add.filter((d) => d !== c.day);
      const skip = isSundayIso(c.day) || w.skip.includes(c.day) ? w.skip : [...w.skip, c.day].sort();
      const newEnd = lastPlannedOnOrBefore(end, w.openFrom, { add, skip });
      if (!newEnd) return fail("empty_window");
      return finish(w, add, skip, newEnd, today);
    }
  }
}
