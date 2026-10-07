/**
 * Pure calculation helpers for roster-intelligence (Live Monitoring). No DB, no clock reads
 * except through the injectable `now`, so boundary cases are unit-testable.
 */
import { timeToMinutesLocal } from "./shift-due.util.js";

// Accepts 'HH:MM[:SS]' (shift times) AND 'YYYY-MM-DD HH:MM:SS' (clock_in_time is a DATETIME and the
// pool runs with dateStrings:true). The old split(':') turned '2026-09-30 09' into NaN, so every
// late-arrival comparison was false and nobody was ever flagged late.
export function timeToMinutes(t: string): number {
  const m = /(\d{1,2}):(\d{2})(?::\d{2})?\s*$/.exec(String(t).trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

/** (planned - present) / planned as a whole percent; 0 when nothing is planned. Never NaN/negative. */
export function shrinkagePct(planned: number, present: number): number {
  if (!(planned > 0)) return 0;
  return Math.max(0, Math.round(((planned - present) / planned) * 100));
}

export function isOvernightShift(
  start: string | null | undefined,
  end: string | null | undefined,
): boolean {
  if (!start || !end) return false;
  return timeToMinutesLocal(String(end)) < timeToMinutesLocal(String(start));
}

function atLocal(rosterDate: string, hhmm: string, addDays = 0): Date {
  const [y, m, d] = rosterDate.split("-").map(Number);
  const mins = timeToMinutesLocal(hhmm);
  return new Date(
    y,
    (m ?? 1) - 1,
    (d ?? 1) + addDays,
    Math.floor(mins / 60),
    mins % 60,
    0,
    0,
  );
}

/** Real elapsed minutes since the shift started on its roster date (negative = not started). */
export function minutesSinceShiftStart(
  rosterDate: string,
  shiftStart: string,
  now: Date = new Date(),
): number {
  return Math.floor(
    (now.getTime() - atLocal(rosterDate, shiftStart).getTime()) / 60000,
  );
}

/** True once the shift's scheduled end (next day for overnight shifts) has passed. */
export function hasShiftEnded(
  rosterDate: string,
  shiftStart: string | null | undefined,
  shiftEnd: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!shiftEnd) return true; // no end on record: nothing to wait for
  const addDays = shiftStart && isOvernightShift(shiftStart, shiftEnd) ? 1 : 0;
  return (
    now.getTime() >= atLocal(rosterDate, String(shiftEnd), addDays).getTime()
  );
}

/**
 * A short worked-hours figure only means "incomplete shift" once the person has clocked out or
 * the shift is over. While a present employee is still on shift, low worked% is just progress.
 */
export function canJudgeIncomplete(
  hasClockOut: boolean,
  rosterDate: string,
  shiftStart: string | null | undefined,
  shiftEnd: string | null | undefined,
  now: Date = new Date(),
): boolean {
  return hasClockOut || hasShiftEnded(rosterDate, shiftStart, shiftEnd, now);
}
