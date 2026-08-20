/**
 * Roster view — "who is working what, this week", as a table.
 *
 * One row per employee with their dates across, carrying the context a WFM person needs to read
 * it without cross-referencing anything: reporting manager, process, branch and cost centre.
 *
 * Deliberately reads wfm_roster_assignment, the only table with real roster data (413,386 rows),
 * and resolves the employee attributes live from `employees` rather than from whatever was stamped
 * on the assignment — 333,762 assignment rows carry process_name NULL, so the assignment is not a
 * reliable place to read context from.
 */
import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';

export interface RosterViewFilters {
  fromDate: string;
  toDate: string;
  branchId?: string;
  processId?: string;
  costCentreId?: string;
  /** Free text over employee code and name. */
  search?: string;
  limit?: number;
  offset?: number;
}

export interface RosterViewRow {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  reportingManager: string | null;
  processName: string | null;
  branchName: string | null;
  costCentre: string | null;
  /** date (YYYY-MM-DD) -> what is planned that day */
  days: Record<string, string>;
}

/** Turn an assignment row into the single label a planner wants to see in a cell. */
function cellLabel(r: RowDataPacket): string {
  const type = String(r.assignment_type ?? '').toUpperCase();
  if (type === 'WEEK_OFF') return 'WO';
  if (type === 'LEAVE') return 'Leave';
  if (type === 'HOLIDAY') return 'Holiday';
  if (type === 'TRAINING') return 'Training';
  if (r.start_time && r.end_time) {
    return `${String(r.start_time).slice(0, 5)}-${String(r.end_time).slice(0, 5)}`;
  }
  if (r.shift_name) return String(r.shift_name);
  if (type && type !== 'UNASSIGNED') return type;
  return '—';
}

export async function getRosterView(
  filters: RosterViewFilters
): Promise<{ rows: RosterViewRow[]; dates: string[]; total: number }> {
  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500);
  const offset = Math.max(filters.offset ?? 0, 0);

  const where: string[] = ['ra.roster_date BETWEEN ? AND ?'];
  const params: unknown[] = [filters.fromDate, filters.toDate];
  if (filters.branchId) { where.push('e.branch_id = ?'); params.push(filters.branchId); }
  if (filters.processId) { where.push('e.process_id = ?'); params.push(filters.processId); }
  if (filters.costCentreId) { where.push('e.cost_centre_id = ?'); params.push(filters.costCentreId); }
  if (filters.search) {
    where.push('(e.employee_code LIKE ? OR e.full_name LIKE ?)');
    params.push(`%${filters.search}%`, `%${filters.search}%`);
  }
  const whereSql = where.join(' AND ');

  // Count distinct employees first so the page size means "employees", not "cells".
  const [countRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT e.id) AS n
       FROM wfm_roster_assignment ra
       JOIN employees e ON e.id = ra.employee_id
      WHERE ${whereSql}`,
    params
  );
  const total = Number(countRows[0]?.n ?? 0);

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id                AS employee_id,
            e.employee_code     AS employee_code,
            e.full_name         AS employee_name,
            mgr.full_name       AS reporting_manager,
            pm.process_name     AS process_name,
            b.branch_name       AS branch_name,
            cc.cost_centre_name AS cost_centre,
            DATE_FORMAT(ra.roster_date, '%Y-%m-%d') AS roster_date,
            ra.assignment_type,
            st.shift_name,
            st.start_time,
            st.end_time
       FROM wfm_roster_assignment ra
       JOIN employees e            ON e.id  = ra.employee_id
       LEFT JOIN employees mgr     ON mgr.id = e.reporting_manager_id
       LEFT JOIN process_master pm ON pm.id  = e.process_id
       LEFT JOIN branch_master b   ON b.id   = e.branch_id
       LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
       LEFT JOIN wfm_shift_template st ON st.id = ra.shift_template_id
      WHERE ${whereSql}
        AND e.id IN (
          SELECT id FROM (
            SELECT e2.id
              FROM wfm_roster_assignment ra2
              JOIN employees e2 ON e2.id = ra2.employee_id
             WHERE ${whereSql.replace(/\bra\./g, 'ra2.').replace(/\be\./g, 'e2.')}
             GROUP BY e2.id, e2.employee_code
             ORDER BY e2.employee_code
             -- Inlined, not bound: MySQL's prepared-statement protocol rejects placeholders in
             -- LIMIT/OFFSET (ER_WRONG_ARGUMENTS). Both are clamped integers above, never strings.
             LIMIT ${limit} OFFSET ${offset}
          ) paged
        )
      ORDER BY e.employee_code, ra.roster_date`,
    [...params, ...params]
  );

  const byEmployee = new Map<string, RosterViewRow>();
  const dates = new Set<string>();
  for (const r of rows) {
    const id = String(r.employee_id);
    if (!byEmployee.has(id)) {
      byEmployee.set(id, {
        employeeId: id,
        employeeCode: String(r.employee_code ?? ''),
        employeeName: String(r.employee_name ?? ''),
        reportingManager: r.reporting_manager ? String(r.reporting_manager) : null,
        processName: r.process_name ? String(r.process_name) : null,
        branchName: r.branch_name ? String(r.branch_name) : null,
        costCentre: r.cost_centre ? String(r.cost_centre) : null,
        days: {},
      });
    }
    const date = String(r.roster_date);
    dates.add(date);
    byEmployee.get(id)!.days[date] = cellLabel(r);
  }

  return { rows: [...byEmployee.values()], dates: [...dates].sort(), total };
}
