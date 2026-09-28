/**
 * Team Roster - suggestions for blank cells. Read-only: nothing is written here. The page stages the
 * suggestions as ordinary draft edits, so the normal validation, approval and locking still apply.
 *
 *   usual          each person's most common shift and their usual week-off weekday(s) over the
 *                  previous USUAL_WINDOW_DAYS days
 *   copy_last_week the same cell exactly seven days earlier
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { requireTeam } from "./team-roster.service.js";
import {
  MAX_RANGE_DAYS,
  TeamRosterError,
  effectiveType,
  eachDate,
  isValidYmd,
  placeholders,
  rowsOf,
  spanDays,
  type Actor,
} from "./team-roster-types.js";

export const USUAL_WINDOW_DAYS = 28;
export const MIN_WEEKOFF_OCCURRENCES = 2;
export const MAX_WEEKOFF_DAYS = 2;
export const MAX_EMPLOYEES_PER_CALL = 200;
const DAY_MS = 86_400_000;

export type AutofillMode = "usual" | "copy_last_week";
export type SuggestionType = "SHIFT" | "WEEK_OFF" | "TRAINING" | "UNSCHEDULED";

export interface HistoryCell {
  date: string;
  type: string;
  start: string | null;
  end: string | null;
}
export interface Suggestion {
  employeeId: string;
  date: string;
  type: SuggestionType;
  shiftStart: string | null;
  shiftEnd: string | null;
}

const CARRYABLE = new Set<string>([
  "SHIFT",
  "WEEK_OFF",
  "TRAINING",
  "UNSCHEDULED",
]);
const utc = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
export const shiftDate = (ymd: string, days: number) =>
  new Date(utc(ymd) + days * DAY_MS).toISOString().slice(0, 10);
const weekday = (ymd: string) => new Date(utc(ymd)).getUTCDay();

/** Most common shift and the weekday(s) that were week-off at least MIN_WEEKOFF_OCCURRENCES times. */
export function usualPattern(history: HistoryCell[]): {
  shift: { start: string; end: string } | null;
  weekOffDays: number[];
} {
  const shifts = new Map<string, number>();
  const offs = new Map<number, number>();
  for (const h of history) {
    if (h.type === "WEEK_OFF")
      offs.set(weekday(h.date), (offs.get(weekday(h.date)) ?? 0) + 1);
    else if (h.type === "SHIFT" && h.start && h.end)
      shifts.set(
        `${h.start}|${h.end}`,
        (shifts.get(`${h.start}|${h.end}`) ?? 0) + 1,
      );
  }
  const top = [...shifts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )[0];
  const [start, end] = top ? top[0].split("|") : [null, null];
  const weekOffDays = [...offs.entries()]
    .filter(([, n]) => n >= MIN_WEEKOFF_OCCURRENCES)
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, MAX_WEEKOFF_DAYS)
    .map(([d]) => d);
  return { shift: start && end ? { start, end } : null, weekOffDays };
}

export function suggestUsual(
  employeeId: string,
  dates: string[],
  history: HistoryCell[],
): Suggestion[] {
  const { shift, weekOffDays } = usualPattern(history);
  const out: Suggestion[] = [];
  for (const date of dates) {
    if (weekOffDays.includes(weekday(date)))
      out.push({
        employeeId,
        date,
        type: "WEEK_OFF",
        shiftStart: null,
        shiftEnd: null,
      });
    else if (shift)
      out.push({
        employeeId,
        date,
        type: "SHIFT",
        shiftStart: shift.start,
        shiftEnd: shift.end,
      });
  }
  return out;
}

export function suggestCopyLastWeek(
  employeeId: string,
  dates: string[],
  history: HistoryCell[],
): Suggestion[] {
  const byDate = new Map(history.map((h) => [h.date, h]));
  const out: Suggestion[] = [];
  for (const date of dates) {
    const src = byDate.get(shiftDate(date, -7));
    if (!src || !CARRYABLE.has(src.type)) continue;
    if (src.type === "SHIFT") {
      if (src.start && src.end)
        out.push({
          employeeId,
          date,
          type: "SHIFT",
          shiftStart: src.start,
          shiftEnd: src.end,
        });
    } else {
      out.push({
        employeeId,
        date,
        type: src.type as SuggestionType,
        shiftStart: null,
        shiftEnd: null,
      });
    }
  }
  return out;
}

const hhmm = (t: unknown) =>
  t == null || t === "" ? null : String(t).slice(0, 5);

export async function getAutofillSuggestions(
  actor: Actor,
  q: { from: string; to: string; mode: AutofillMode; employeeIds: string[] },
): Promise<{ suggestions: Suggestion[]; employeesWithoutHistory: number }> {
  if (!isValidYmd(q.from) || !isValidYmd(q.to) || q.to < q.from)
    throw new TeamRosterError(
      400,
      "from and to must be valid dates, to not before from.",
      "BAD_RANGE",
    );
  if (spanDays(q.from, q.to) > MAX_RANGE_DAYS)
    throw new TeamRosterError(
      400,
      `A range can span at most ${MAX_RANGE_DAYS} days.`,
      "RANGE_TOO_LONG",
    );

  const { teamIds } = await requireTeam(actor);
  const team = new Set(teamIds);
  const ids = [...new Set(q.employeeIds)]
    .filter((id) => team.has(id))
    .slice(0, MAX_EMPLOYEES_PER_CALL);
  if (!ids.length) return { suggestions: [], employeesWithoutHistory: 0 };

  const dates = eachDate(q.from, q.to);
  const historyFrom =
    q.mode === "copy_last_week"
      ? shiftDate(q.from, -7)
      : shiftDate(q.from, -USUAL_WINDOW_DAYS);
  const historyTo =
    q.mode === "copy_last_week" ? shiftDate(q.to, -7) : shiftDate(q.from, -1);
  const rows = rowsOf<RowDataPacket>(
    await db.execute(
      `SELECT employee_id, DATE_FORMAT(roster_date, '%Y-%m-%d') AS d, assignment_type, is_week_off,
            shift_start_time, shift_end_time, shift_template_id
       FROM wfm_roster_assignment
      WHERE employee_id IN (${placeholders(ids.length)}) AND roster_date BETWEEN ? AND ?`,
      [...ids, historyFrom, historyTo],
    ),
  );
  const byEmployee = new Map<string, HistoryCell[]>(ids.map((id) => [id, []]));
  for (const r of rows) {
    byEmployee.get(String(r.employee_id))?.push({
      date: String(r.d),
      type: effectiveType(r as Record<string, unknown>),
      start: hhmm(r.shift_start_time),
      end: hhmm(r.shift_end_time),
    });
  }

  const suggestions: Suggestion[] = [];
  let withoutHistory = 0;
  for (const id of ids) {
    const history = byEmployee.get(id) ?? [];
    const found =
      q.mode === "copy_last_week"
        ? suggestCopyLastWeek(id, dates, history)
        : suggestUsual(id, dates, history);
    if (!found.length) withoutHistory += 1;
    suggestions.push(...found);
  }
  return { suggestions, employeesWithoutHistory: withoutHistory };
}
