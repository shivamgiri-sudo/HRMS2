/**
 * Approved leave is the one thing a roster must never overwrite.
 *
 * Owner ruling 2026-08-21: an approved leave stands until a manager or branch WFM discards it. No
 * roster write — spreadsheet import, grid cell, or generator — may put a working shift on a day an
 * employee has approved leave for.
 *
 * This is the single shared implementation, so the rule cannot hold on one path and not another.
 * Before it existed the two paths people actually use (Excel import commit and the Roster Builder
 * grid) had no leave check at all, while the two generators did — so the rule was true in code and
 * false in practice.
 *
 * Three rules, all owner-decided:
 *
 *  1. FULL-day approved leave blocks the day outright.
 *
 *  2. HALF-day leave is rosterable. 806 approved requests carry total_days = 0.50 and there is no
 *     session/half column anywhere, so a half day is inferred from a single-date request with
 *     total_days <= 0.5. The employee can still work the other half, so this warns rather than
 *     blocks — the planner is told, and decides.
 *
 *  3. A NIGHT shift is blocked by leave on the day it ENDS, not only the day it starts. A shift
 *     starting Monday 21:00 and finishing Tuesday 06:00 is worked almost entirely on Tuesday, so
 *     leave on Tuesday means the employee is off from Monday night. Owner's words: "Tuesday's
 *     leave means next day off Monday."
 */
import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';

export type LeaveKind = 'FULL' | 'HALF';

/** employeeId -> 'YYYY-MM-DD' -> FULL | HALF */
export type LeaveMap = Map<string, Map<string, LeaveKind>>;

export interface LeaveVerdict {
  /** Hard refusal — a working shift must not be written. */
  blocked: boolean;
  /** Worth telling the planner, but not a refusal (half-day). */
  warning: boolean;
  /** Human-readable, safe to show the uploader. */
  reason: string | null;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return ymd(d);
}

/**
 * Approved leave for these employees across the window, expanded per day.
 *
 * Employee ids, not codes: leave_request.employee_id holds the employees.id UUID. Passing a
 * spreadsheet employee code here matches nothing — that exact mistake made the import's own leave
 * cross-check dead for its entire life.
 *
 * Throws rather than returning empty on failure. A leave guard that quietly returns "no leave" is
 * worse than no guard, because it looks like it ran.
 */
export async function loadApprovedLeave(
  employeeIds: string[],
  fromDate: string,
  toDate: string
): Promise<LeaveMap> {
  const map: LeaveMap = new Map();
  const ids = [...new Set(employeeIds.filter(Boolean))];
  if (ids.length === 0) return map;

  // Widen by a day at each end: a night shift on the last day is judged by the day after it, and
  // a night shift the day before the window can reach into it.
  const windowFrom = new Date(`${fromDate}T00:00:00`);
  windowFrom.setDate(windowFrom.getDate() - 1);
  const windowTo = new Date(`${toDate}T00:00:00`);
  windowTo.setDate(windowTo.getDate() + 1);

  const placeholders = ids.map(() => '?').join(',');
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT employee_id, from_date, to_date, total_days
       FROM leave_request
      WHERE employee_id IN (${placeholders})
        AND LOWER(status) IN ('approved','accepted')
        AND to_date   >= ?
        AND from_date <= ?`,
    [...ids, ymd(windowFrom), ymd(windowTo)]
  );

  for (const r of rows) {
    const empId = String(r.employee_id);
    const from = new Date(String(r.from_date).slice(0, 10) + 'T00:00:00');
    const to = new Date(String(r.to_date).slice(0, 10) + 'T00:00:00');
    const days = Number(r.total_days ?? 1);
    // A half day only makes sense on a single-date request. A 0.5 spread over a range is data we
    // cannot interpret, so it is treated as FULL — protecting the leave is the safe direction.
    const sameDay = from.getTime() === to.getTime();
    const kind: LeaveKind = sameDay && days > 0 && days <= 0.5 ? 'HALF' : 'FULL';

    if (!map.has(empId)) map.set(empId, new Map());
    const byDate = map.get(empId)!;
    for (const d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      const key = ymd(d);
      // FULL always wins over HALF if two requests overlap the same day.
      if (byDate.get(key) !== 'FULL') byDate.set(key, kind);
    }
  }
  return map;
}

/**
 * May this employee be given a working shift on this date?
 *
 * `isNightShift` decides whether the day AFTER is also consulted (rule 3). Non-working assignments
 * — week-off, leave, holiday — are never blocked: marking someone's leave day as Leave or WO is
 * correct, and blocking it would make a roster impossible to represent.
 */
export function checkLeaveConflict(
  leave: LeaveMap,
  employeeId: string,
  rosterDate: string,
  opts: { isNightShift?: boolean; assignmentType?: string | null } = {}
): LeaveVerdict {
  const clear: LeaveVerdict = { blocked: false, warning: false, reason: null };

  const type = String(opts.assignmentType ?? '').toUpperCase();
  if (type === 'WEEK_OFF' || type === 'LEAVE' || type === 'HOLIDAY' || type === 'UNASSIGNED') {
    return clear;
  }

  const byDate = leave.get(employeeId);
  if (!byDate) return clear;

  const onDay = byDate.get(rosterDate);
  if (onDay === 'FULL') {
    return {
      blocked: true,
      warning: false,
      reason: `Employee has approved leave on ${rosterDate}. A roster cannot override approved leave — the leave must be discarded by a manager or branch WFM first.`,
    };
  }

  if (opts.isNightShift) {
    const endsOn = nextDay(rosterDate);
    if (byDate.get(endsOn) === 'FULL') {
      return {
        blocked: true,
        warning: false,
        reason: `This night shift finishes on ${endsOn}, when the employee has approved leave. Leave on ${endsOn} means they are off from the night of ${rosterDate}.`,
      };
    }
  }

  if (onDay === 'HALF') {
    return {
      blocked: false,
      warning: true,
      reason: `Employee has approved HALF-day leave on ${rosterDate}. They can work the other half — check the shift timing covers it.`,
    };
  }

  return clear;
}
