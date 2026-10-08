/**
 * Shared SQL fragments for the Trends & Publish panel, so the daily trend, the process table,
 * the member table and every drawer count a rostered day identically.
 *
 * Aliases: ra = wfm_roster_assignment, e = employees, att = attendance_daily_record,
 * bal = biometric_attendance_log.
 */
import { lobCondition, type LobFilter } from "../../shared/lobFilter.js";

/**
 * Excludes the synthetic 2026-06-11 cohort (412k rows, all four provenance columns NULL) while
 * keeping manually created assignments. Same guard as roster-analytics.routes.ts / compliance.
 */
export const REAL_ROSTER =
  "NOT (ra.import_batch_id IS NULL AND ra.cycle_id IS NULL AND ra.assignment_type IS NULL AND ra.shift_template_id IS NULL)";

const OFF = "(UPPER(COALESCE(ra.assignment_type,'')) IN ('WEEK_OFF','HOLIDAY') OR COALESCE(ra.is_week_off,0) = 1)";
const RLEAVE = "UPPER(COALESCE(ra.assignment_type,'')) = 'LEAVE'";
const PUNCH = "(att.clock_in_time IS NOT NULL OR bal.first_punch_in IS NOT NULL)";
const ALEAVE = `(NOT ${PUNCH} AND COALESCE(att.attendance_status,'') = 'leave_approved')`;
const WORK = `(NOT ${OFF} AND NOT (${RLEAVE}))`;

/**
 * Column list producing scheduled / present / absent / on_leave / late_count.
 *  - assignment_type NULL is a working day (NOT IN would silently drop it).
 *  - Week-off / holiday rows never enter the denominator.
 *  - A working day with no punch but an approved-leave attendance record is LEAVE (planned),
 *    not an absence — attendance and roster are fed separately and disagree on this.
 *  - Late only counts on days the person actually punched in.
 */
export const COUNT_COLUMNS = `
  SUM(CASE WHEN NOT ${OFF} THEN 1 ELSE 0 END) AS scheduled,
  SUM(CASE WHEN ${WORK} AND ${PUNCH} THEN 1 ELSE 0 END) AS present,
  SUM(CASE WHEN ${WORK} AND NOT ${PUNCH} AND NOT ${ALEAVE} THEN 1 ELSE 0 END) AS absent,
  SUM(CASE WHEN NOT ${OFF} AND ((${RLEAVE}) OR (${WORK} AND ${ALEAVE})) THEN 1 ELSE 0 END) AS on_leave,
  SUM(CASE WHEN ${WORK} AND ${PUNCH} AND att.late_mark = 1 THEN 1 ELSE 0 END) AS late_count`;

export const ATT_JOINS = `
  LEFT JOIN attendance_daily_record att ON att.employee_id = ra.employee_id AND att.record_date = ra.roster_date
  LEFT JOIN biometric_attendance_log bal ON bal.employee_id = ra.employee_id AND bal.punch_date = ra.roster_date`;

export const ABSENT_PREDICATE = `(${WORK} AND NOT ${PUNCH} AND NOT ${ALEAVE})`;

export interface ScopeFilters {
  branchId?: string;
  processId?: string;
  lob?: LobFilter;
}

/** ` AND e.branch_id = ? ...` fragment (leading space, empty when unfiltered) + params. */
export function scopeSql(f: ScopeFilters): { sql: string; params: unknown[] } {
  let sql = "";
  const params: unknown[] = [];
  if (f.branchId) { sql += " AND e.branch_id = ?"; params.push(f.branchId); }
  if (f.processId) { sql += " AND e.process_id = ?"; params.push(f.processId); }
  const lobC = f.lob ? lobCondition(f.lob) : null;
  if (lobC) { sql += ` AND ${lobC.sql}`; params.push(...lobC.params); }
  return { sql, params };
}
